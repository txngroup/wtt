// Algorand side of the Wormhole Token Bridge: find Wormhole-wrapped assets and build sendTransfer groups.
// Mirrors @wormhole-foundation/sdk-algorand-tokenbridge's transfer() for wrapped assets, using algosdk v3 only.
import algosdk from 'algosdk'
import { ALGORAND, chainName, hex } from './wormhole.ts'
import { storageLsig } from './algorand-redeem.ts'

export const ALGOD_URL = 'https://mainnet-api.algonode.cloud'
export const algod = new algosdk.Algodv2('', ALGOD_URL, '')
const enc = (s: string) => new TextEncoder().encode(s)
const u64 = (n: bigint | number) => algosdk.bigIntToBytes(n, 8)

export type WrappedAsset = {
  assetId: bigint
  unitName: string
  name: string
  decimals: number
  amount: bigint // base units held
  creator: string // the bridge's storage account for this asset
  originChain: number
  originAddress: Uint8Array // 32 bytes
}

// Concatenated local-state blob of a token-bridge storage account (keys are 1-byte indexes, "meta" excluded).
async function storageBlob(address: string): Promise<Uint8Array> {
  const info = await algod.accountApplicationInformation(address, ALGORAND.tokenBridgeAppId).do()
  const kvs = info.appLocalState?.keyValue ?? []
  const parts = kvs
    .filter((kv) => !(kv.key.length === 4 && new TextDecoder().decode(kv.key) === 'meta'))
    .map((kv) => ({ i: kv.key[0], v: kv.value.bytes }))
    .sort((a, b) => a.i - b.i)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.v.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p.v, o)
    o += p.v.length
  }
  return out
}

// Wormhole-wrapped assets with a non-zero balance in an account.
// One algod call lists every holding with its asset params. The bridge creates each wrapped ASA from a storage
// account, with itself as manager and the creator as reserve, so only those candidates cost a second call. That call
// reads the origin from the creator's local state, and the ASA counts only if the storage address derived from that
// origin is the creator (the same check the bridge relies on).
export async function listWrappedAssets(address: string): Promise<WrappedAsset[]> {
  const holdings = []
  let next: string | undefined
  do {
    const req = algod.accountAssetsInformation(address).limit(1000)
    const page = await (next ? req.next(next) : req).do()
    holdings.push(...(page.assetHoldings ?? []))
    next = page.nextToken || undefined
  } while (next)
  const candidates = holdings.filter(
    ({ assetHolding: h, assetParams: p }) =>
      h.amount > 0n && p?.manager === ALGORAND.tokenBridgeAddress && p.reserve === p.creator,
  )
  const found = await Promise.all(
    candidates.map(async ({ assetHolding: h, assetParams: p }): Promise<WrappedAsset | undefined> => {
      const blob = await storageBlob(p!.creator)
      if (blob.length < 94 || algosdk.bytesToBigInt(blob.slice(0, 8)) !== h.assetId) return undefined
      const originAddress = blob.slice(60, 92)
      const originChain = (blob[92] << 8) | blob[93]
      const storage = storageLsig(ALGORAND.tokenBridgeAppId, BigInt(originChain), originAddress)
      if (storage.address().toString() !== p!.creator) return undefined
      return {
        assetId: h.assetId,
        unitName: p!.unitName ?? '',
        name: p!.name ?? '',
        decimals: p!.decimals,
        amount: h.amount,
        creator: p!.creator,
        originChain,
        originAddress,
      }
    }),
  )
  return found.filter((a) => a !== undefined)
}

// Unsigned, grouped transfer: [message fee payment if any], nop, asset transfer to the bridge, sendTransfer.
export async function buildTransfer(p: {
  sender: string
  asset: WrappedAsset
  amount: bigint
  toChain: number
  to: Uint8Array // 32-byte recipient (EVM address left-padded, or Solana token account)
}): Promise<algosdk.Transaction[]> {
  if (p.to.length !== 32) throw new Error('recipient must be 32 bytes')
  if (p.amount <= 0n || p.amount > p.asset.amount) throw new Error('invalid amount')
  const emitter = await algod.accountApplicationInformation(ALGORAND.emitterStorage, ALGORAND.coreAppId).do()
  if (!emitter.appLocalState) throw new Error('token bridge emitter storage is not initialised')
  const core = await algod.getApplicationByID(ALGORAND.coreAppId).do()
  const msgFee = core.params?.globalState?.find((kv) => new TextDecoder().decode(kv.key) === 'MessageFee')?.value.uint ?? 0n
  const sp = await algod.getTransactionParams().do()
  const fee = (n: number) => ({ ...sp, flatFee: true, fee: BigInt(n) })
  const txns: algosdk.Transaction[] = []
  if (msgFee > 0n) {
    txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: p.sender, receiver: ALGORAND.tokenBridgeAddress, amount: msgFee, suggestedParams: fee(1000) }))
  }
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({ sender: p.sender, appIndex: ALGORAND.tokenBridgeAppId, appArgs: [enc('nop')], suggestedParams: fee(1000) }),
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: p.sender,
      receiver: p.asset.creator,
      amount: p.amount,
      assetIndex: p.asset.assetId,
      suggestedParams: fee(1000),
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: p.sender,
      appIndex: ALGORAND.tokenBridgeAppId,
      appArgs: [enc('sendTransfer'), u64(p.asset.assetId), u64(p.amount), p.to, u64(p.toChain), u64(0)],
      foreignApps: [ALGORAND.coreAppId],
      foreignAssets: [p.asset.assetId],
      accounts: [ALGORAND.emitterStorage, p.asset.creator, p.asset.creator],
      suggestedParams: fee(2000),
    }),
  )
  algosdk.assignGroupID(txns)
  return txns
}

// Decode a built group back from its own bytes, so the UI shows exactly what will be signed.
export function describeTransfer(txns: algosdk.Transaction[]) {
  const st = txns.find((t) => t.applicationCall && new TextDecoder().decode(t.applicationCall.appArgs[0]) === 'sendTransfer')
  if (!st?.applicationCall) throw new Error('no sendTransfer call in group')
  const a = st.applicationCall.appArgs
  const toChain = Number(algosdk.bytesToBigInt(a[4]))
  return {
    assetId: algosdk.bytesToBigInt(a[1]),
    amount: algosdk.bytesToBigInt(a[2]),
    to: a[3],
    toHex: hex(a[3]),
    toChain,
    toChainName: chainName(toChain),
    relayerFee: algosdk.bytesToBigInt(a[5]),
    lastValid: st.lastValid,
    sendTransferTxid: st.txID(),
    sender: st.sender.toString(),
  }
}

// Simulate a group with empty signatures, using the sender's current auth address (handles rekeyed accounts).
export async function simulateUnsigned(txns: algosdk.Transaction[]) {
  const sender = txns[0].sender.toString()
  const acct = await algod.accountInformation(sender).exclude('all').do()
  const sgnr = acct.authAddr
  const req = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [
      new algosdk.modelsv2.SimulateRequestTransactionGroup({
        txns: txns.map((txn) => new algosdk.SignedTransaction({ txn, sgnr })),
      }),
    ],
    allowEmptySignatures: true,
  })
  const res = await algod.simulateTransactions(req).do()
  return res.txnGroups[0].failureMessage
}

export async function simulateSigned(signed: Uint8Array[]) {
  const res = await algod.simulateRawTransactions(signed).do()
  return res.txnGroups[0].failureMessage
}

// Submit a signed group and return the Wormhole sequence emitted by its sendTransfer call.
export async function submit(signed: Uint8Array[], sendTransferTxid: string) {
  await algod.sendRawTransaction(signed).do()
  await algosdk.waitForConfirmation(algod, sendTransferTxid, 10)
  return algod.pendingTransactionInformation(sendTransferTxid).do()
}
