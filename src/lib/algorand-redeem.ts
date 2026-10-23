// Redeem a token-bridge VAA on Algorand. Port of @wormhole-foundation/sdk-algorand-core submitVAAHeader and
// sdk-algorand-tokenbridge redeem (6.1.5), using algosdk v3. Checked against the SDK in test/compare-algorand-redeem.mjs.
import algosdk from 'algosdk'
import { algod } from './algorand.ts'
import { ALGORAND, type Vaa } from './wormhole.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const MAX_BITS = 8 * 127 * 15 // bits of sequence-tracking state per storage account
const SEED_AMT = 1_002_000n // funds a new storage account's minimum balance
const MAX_SIGS_PER_TXN = 6

// The core contract's signature-verification logic signature (address EZATROXX...).
const ALGO_VERIFY = new Uint8Array([
  6, 32, 4, 1, 0, 32, 20, 38, 1, 0, 49, 32, 50, 3, 18, 68, 49, 1, 35, 18, 68, 49, 16, 129, 6, 18, 68, 54, 26, 1, 54, 26,
  3, 54, 26, 2, 136, 0, 3, 68, 34, 67, 53, 2, 53, 1, 53, 0, 40, 53, 240, 40, 53, 241, 52, 0, 21, 53, 5, 35, 53, 3, 35,
  53, 4, 52, 3, 52, 5, 12, 65, 0, 68, 52, 1, 52, 0, 52, 3, 129, 65, 8, 34, 88, 23, 52, 0, 52, 3, 34, 8, 36, 88, 52, 0,
  52, 3, 129, 33, 8, 36, 88, 7, 0, 53, 241, 53, 240, 52, 2, 52, 4, 37, 88, 52, 240, 52, 241, 80, 2, 87, 12, 20, 18, 68,
  52, 3, 129, 66, 8, 53, 3, 52, 4, 37, 8, 53, 4, 66, 255, 180, 34, 137,
])
export const algoVerifyLsig = () => new algosdk.LogicSigAccount(ALGO_VERIFY)

const varint = (n: bigint) => {
  const out: number[] = []
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80)
    n >>= 7n
  }
  out.push(Number(n))
  return Uint8Array.from(out)
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16))
const varBytes = (b: Uint8Array) => concat(varint(BigInt(b.length)), b)

// Storage logic signature template: one account per (app, idx, address) holding bridge state in its local state.
export function storageLsig(appId: bigint, idx: bigint, address: Uint8Array) {
  const appAddress = algosdk.getApplicationAddress(appId).publicKey
  const program = concat(
    fromHex('0620010181'), varint(idx),
    fromHex('4880'), varBytes(address),
    fromHex('483110810612443119221244311881'), varint(appId),
    fromHex('1244312080'), varBytes(appAddress),
    fromHex('124431018100124431093203124431153203124422'),
  )
  return new algosdk.LogicSigAccount(program)
}

const u16 = (n: number) => Uint8Array.of(n >> 8, n & 0xff)
const messageStorage = (v: Vaa) =>
  storageLsig(ALGORAND.tokenBridgeAppId, v.sequence / BigInt(MAX_BITS), concat(u16(v.emitterChain), v.emitterAddress))
const guardianStorage = (index: number) => storageLsig(ALGORAND.coreAppId, BigInt(index), enc('guardian'))
const wrappedAssetStorage = (tokenChain: number, tokenAddress: Uint8Array) =>
  storageLsig(ALGORAND.tokenBridgeAppId, BigInt(tokenChain), tokenAddress)
const nativeAssetStorage = (assetId: bigint) => storageLsig(ALGORAND.tokenBridgeAppId, assetId, enc('native'))

async function localState(address: string, appId: bigint) {
  try {
    const info = await algod.accountApplicationInformation(address, appId).do()
    return info.appLocalState
  } catch {
    return undefined
  }
}

// Concatenation of a storage account's local state values ordered by their 1-byte keys ("meta" excluded).
async function storageBlob(address: string, appId: bigint) {
  const st = await localState(address, appId)
  const parts = (st?.keyValue ?? [])
    .filter((kv) => !(kv.key.length === 4 && new TextDecoder().decode(kv.key) === 'meta'))
    .map((kv) => ({ i: kv.key[0], v: kv.value.bytes }))
    .sort((a, b) => a.i - b.i)
  return concat(...parts.map((p) => p.v))
}

// The Algorand ASA a token arrives as: the native asset id, or the bridge's wrapped ASA (undefined if never attested).
export async function algorandAssetForToken(tokenChain: number, tokenAddress: Uint8Array): Promise<{ assetId: bigint; storage: algosdk.LogicSigAccount } | undefined> {
  if (tokenChain === ALGORAND.chainId) {
    const assetId = algosdk.bytesToBigInt(tokenAddress)
    return { assetId, storage: nativeAssetStorage(assetId) }
  }
  const storage = wrappedAssetStorage(tokenChain, tokenAddress)
  const data = await storageBlob(storage.address().toString(), ALGORAND.tokenBridgeAppId)
  if (data.length < 8) return undefined
  return { assetId: algosdk.bytesToBigInt(data.slice(0, 8)), storage }
}

export async function isRedeemedOnAlgorand(v: Vaa) {
  const st = await localState(messageStorage(v).address().toString(), ALGORAND.tokenBridgeAppId)
  if (!st) return false
  const beg = Number(v.sequence % BigInt(MAX_BITS))
  const s = Math.floor(beg / (127 * 8))
  const b = Math.floor((beg - s * 127 * 8) / 8)
  const kv = st.keyValue?.find((x) => x.key.length === 1 && x.key[0] === s)
  return kv ? (kv.value.bytes[b] & (1 << Number(v.sequence % 8n))) !== 0 : false
}

export type AlgorandRedeem = {
  txns: algosdk.Transaction[] // grouped
  userIndexes: number[] // signed by the user's wallet
  lsigs: Map<number, algosdk.LogicSigAccount> // signed locally by logic signatures
  assetId: bigint
  receiver: string
  needsOptIn: boolean
}

// Build the complete redeem group, paid and partly signed by `sender`, who must be the receiver if an opt-in is needed.
export async function buildAlgorandRedeem(sender: string, v: Vaa): Promise<AlgorandRedeem> {
  const t = v.transfer
  if (!t || t.payloadType !== 1) throw new Error('only plain token transfers (payload 1) are supported')
  if (t.toChain !== ALGORAND.chainId) throw new Error('VAA is not addressed to Algorand')
  const sp = await algod.getTransactionParams().do()
  const fee = (n: number) => ({ ...sp, flatFee: true, fee: BigInt(n) })
  const items: { txn: algosdk.Transaction; lsig?: algosdk.LogicSigAccount }[] = []

  const storageAccount = async (lsig: algosdk.LogicSigAccount, appId: bigint) => {
    const address = lsig.address().toString()
    if (!(await localState(address, appId))) {
      items.push({ txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender, receiver: address, amount: SEED_AMT, suggestedParams: fee(2000) }) })
      items.push({
        txn: algosdk.makeApplicationOptInTxnFromObject({ sender: address, appIndex: appId, rekeyTo: algosdk.getApplicationAddress(appId), suggestedParams: fee(0) }),
        lsig,
      })
    }
    return address
  }

  // submitVAAHeader: storage accounts, signature verification (6 per txn), verifyVAA.
  const seqAddr = await storageAccount(messageStorage(v), ALGORAND.tokenBridgeAppId)
  const gsAddr = await storageAccount(guardianStorage(v.guardianSetIndex), ALGORAND.coreAppId)
  const accounts = [seqAddr, gsAddr]
  const keys = await storageBlob(gsAddr, ALGORAND.coreAppId)
  const verify = algoVerifyLsig()
  const numTxns = Math.ceil(v.signatures.length / MAX_SIGS_PER_TXN)
  for (let n = 0; n < numTxns; n++) {
    const sigs = v.signatures.slice(n * MAX_SIGS_PER_TXN, (n + 1) * MAX_SIGS_PER_TXN)
    const keySet = concat(...sigs.map((s) => keys.slice(s.guardianIndex * 20 + 1, (s.guardianIndex + 1) * 20 + 1)))
    items.push({
      txn: algosdk.makeApplicationNoOpTxnFromObject({
        sender: verify.address().toString(),
        appIndex: ALGORAND.coreAppId,
        appArgs: [enc('verifySigs'), concat(...sigs.map((s) => concat(Uint8Array.of(s.guardianIndex), s.signature))), keySet, v.digest],
        accounts,
        suggestedParams: fee(0),
      }),
      lsig: verify,
    })
  }
  items.push({
    txn: algosdk.makeApplicationNoOpTxnFromObject({
      sender,
      appIndex: ALGORAND.coreAppId,
      appArgs: [enc('verifyVAA'), v.bytes],
      accounts,
      suggestedParams: fee(1000 * (2 + numTxns)),
    }),
  })

  // completeTransfer into the receiver, opting the receiver in to the ASA first if needed.
  const asset = await algorandAssetForToken(t.tokenChain, t.tokenAddress)
  if (!asset) throw new Error('this token has no Wormhole-wrapped asset on Algorand yet (it was never attested)')
  const receiver = new algosdk.Address(t.to).toString()
  const foreignAssets: bigint[] = []
  let needsOptIn = false
  if (asset.assetId !== 0n) {
    foreignAssets.push(asset.assetId)
    try {
      await algod.accountAssetInformation(receiver, asset.assetId).do()
    } catch {
      needsOptIn = true
    }
    if (needsOptIn) {
      if (sender !== receiver) throw new Error(`the receiver ${receiver} must opt in to asset ${asset.assetId} first (connect that account)`)
      items.unshift({
        txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender, receiver: sender, amount: 0, assetIndex: asset.assetId, suggestedParams: fee(1000) }),
      })
    }
  }
  items.push({
    txn: algosdk.makeApplicationNoOpTxnFromObject({
      sender,
      appIndex: ALGORAND.tokenBridgeAppId,
      appArgs: [enc('completeTransfer'), v.bytes],
      accounts: [...accounts, asset.storage.address().toString(), receiver],
      foreignAssets,
      suggestedParams: fee(t.fee === 0n ? 2000 : 3000),
    }),
  })

  if (items.length > 16) throw new Error(`redeem needs ${items.length} transactions, more than one group allows`)
  const txns = items.map((i) => i.txn)
  algosdk.assignGroupID(txns)
  const lsigs = new Map<number, algosdk.LogicSigAccount>()
  const userIndexes: number[] = []
  items.forEach((it, i) => (it.lsig ? lsigs.set(i, it.lsig) : userIndexes.push(i)))
  return { txns, userIndexes, lsigs, assetId: asset.assetId, receiver, needsOptIn }
}

// Combine wallet signatures (for userIndexes) with local logic-signature signatures into the final signed group.
export function assembleSigned(r: AlgorandRedeem, walletSigned: (Uint8Array | null)[]) {
  return r.txns.map((txn, i) => {
    const lsig = r.lsigs.get(i)
    if (lsig) return algosdk.signLogicSigTransactionObject(txn, lsig).blob
    const s = walletSigned[i]
    if (!s) throw new Error(`wallet did not sign transaction ${i}`)
    return s
  })
}

// Simulate the group before asking the wallet: logic signatures really signed, user txns with empty signatures
// (and the sender's auth address, for rekeyed accounts). Returns the failure message, or undefined if it passes.
export async function simulateRedeem(r: AlgorandRedeem) {
  const sender = r.txns[r.userIndexes[0]].sender.toString()
  const auth = (await algod.accountInformation(sender).exclude('all').do()).authAddr
  const txns = r.txns.map((txn, i) => {
    const lsig = r.lsigs.get(i)
    return lsig ? new algosdk.SignedTransaction({ txn, lsig: lsig.lsig }) : new algosdk.SignedTransaction({ txn, sgnr: auth })
  })
  const req = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns })],
    allowEmptySignatures: true,
  })
  return (await algod.simulateTransactions(req).do()).txnGroups[0].failureMessage
}
