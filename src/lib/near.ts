// NEAR side of the Wormhole Token Bridge (contract.portalbridge.near), hand-written: view calls over a public RPC, the
// bridge's account registry, and the function calls that send and redeem. The calls match @certusone/wormhole-sdk
// 0.10.18's NEAR functions (test/sdk/compare-near.mjs checks this), as {receiverId, actions} transactions that NEAR
// wallets sign and send themselves.
import { hex, type Vaa } from './wormhole.ts'
import { accountHash, isNearAccountId } from './near-account.ts'

export { accountHash, isNearAccountId }

export const NEAR = {
  chainId: 15,
  tokenBridge: 'contract.portalbridge.near',
  core: 'contract.wormhole_crypto.near',
  // sha256 of the token bridge's account id: its Wormhole emitter.
  tokenBridgeEmitter: '148410499d3fcda4dcfd68a1ebfcdddda16ab28326448d4aae4d2f0465cdfcb7',
  // Public RPCs that accept browser (CORS) requests, tried in order: FastNEAR's free one, then NEAR's own. Both limit
  // how often one address may call them.
  rpcs: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
}

export const TGAS = 10n ** 12n
export const ONE_NEAR = 10n ** 24n // yoctoNEAR
// The bridge carries NEAR with 8 decimals: amounts are whole multiples of 1e16 yoctoNEAR.
export const NEAR_MULT = 10n ** 16n
// What the bridge's own SDK attaches: 0.002 NEAR to cover storage, and 0.1 NEAR per submit_vaa (the rest comes back).
const STORAGE_DEPOSIT = 2n * 10n ** 21n
const SUBMIT_VAA_DEPOSIT = ONE_NEAR / 10n

export type NearCall = { methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }
export type NearTx = { receiverId: string; actions: NearCall[]; label: string }

const call = (methodName: string, args: Record<string, unknown>, gas: bigint, deposit: bigint): NearCall => ({ methodName, args, gas, deposit })

// One JSON-RPC call. A rate limit or a network failure moves on to the next RPC; an error from the chain itself (such as
// an unknown account) does not.
export async function nearRpc<T = any>(method: string, params: unknown): Promise<T> {
  let last: unknown
  for (const url of NEAR.rpcs) {
    let j: any
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'wtt', method, params }),
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      j = await res.json()
      if (j.error && /rate limit/i.test(JSON.stringify(j.error))) throw new Error('rate limited')
    } catch (e) {
      last = e
      continue
    }
    if (j.error) throw new Error(j.error.cause?.name ?? j.error.data ?? j.error.message ?? 'NEAR RPC error')
    return j.result
  }
  throw new Error(`NEAR RPC unavailable: ${(last as Error)?.message ?? last}`)
}

// A contract's view method, with JSON arguments and a JSON result.
export async function nearView<T = any>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await nearRpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  })
  if (r.error) throw new Error(r.error)
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result as number[])))
}

export async function accountExists(account: string) {
  try {
    await nearRpc('query', { request_type: 'view_account', finality: 'final', account_id: account })
    return true
  } catch (e) {
    if (/UNKNOWN_ACCOUNT/.test(String((e as Error).message))) return false
    throw e
  }
}

// Balance that can be spent: the total, less what the account's storage keeps locked (1e19 yoctoNEAR per byte).
export async function nearBalance(account: string) {
  const a = await nearRpc('query', { request_type: 'view_account', finality: 'final', account_id: account })
  const total = BigInt(a.amount)
  const storage = BigInt(a.storage_usage) * 10n ** 19n
  const locked = BigInt(a.locked)
  const reserved = storage > locked ? storage - locked : 0n
  return { total, available: total > reserved ? total - reserved : 0n }
}

// The bridge only pays out to, and only accepts tokens from, accounts in its registry.
export async function isRegistered(account: string) {
  const [registered] = await nearView<[boolean, string]>(NEAR.tokenBridge, 'hash_account', { account })
  return registered
}

// The registered account behind a transfer's recipient bytes, if any.
export async function accountForHash(hash: Uint8Array) {
  const [found, account] = await nearView<[boolean, string]>(NEAR.tokenBridge, 'hash_lookup', { hash: hex(hash) })
  return found ? account : undefined
}

export const messageFee = async () => BigInt(await nearView<number | string>(NEAR.core, 'message_fee'))

// The NEAR token account for a token from another chain, if the bridge has created one.
export async function foreignAsset(chain: number, address: Uint8Array) {
  const account = await nearView<string>(NEAR.tokenBridge, 'get_foreign_asset', { address: hex(address), chain })
  return account || undefined
}

// The bridge's own tokens are <n>.contract.portalbridge.near.
export const isBridgeToken = (token: string) => token.endsWith('.' + NEAR.tokenBridge)

export async function originalAsset(token: string) {
  const [address, chain] = await nearView<[string, number]>(NEAR.tokenBridge, 'get_original_asset', { token })
  return { address, chain }
}

export async function ftBalance(token: string, account: string) {
  return BigInt(await nearView<string>(token, 'ft_balance_of', { account_id: account }))
}

export const ftMetadata = (token: string) => nearView<{ symbol: string; name: string; decimals: number }>(token, 'ft_metadata')

// The bridge's record of a transfer: verified (the first submit_vaa landed) and executed (paid out).
export async function transferState(vaa: Vaa) {
  const [verified, executed] = await nearView<[boolean, boolean]>(NEAR.tokenBridge, 'is_transfer_completed', { vaa: hex(vaa.bytes) })
  return { verified, executed }
}

export const isRedeemedOnNear = async (vaa: Vaa) => (await transferState(vaa)).executed

const registerCall = (account: string) => call('register_account', { account }, 100n * TGAS, STORAGE_DEPOSIT)

// Redeem a transfer on NEAR: register the recipient if the signer is the recipient and not yet registered, open a
// storage record on the token if the recipient has none, then submit the VAA twice (the bridge verifies the
// signatures on the first call and pays out on the second). Each call is its own transaction, sent in order.
export async function planNearRedeem(signer: string, vaa: Vaa) {
  const t = vaa.transfer
  if (!t || t.toChain !== NEAR.chainId) throw new Error('this transfer is not to NEAR')
  const { verified, executed } = await transferState(vaa)
  const txs: NearTx[] = []
  if (executed) return { txs, receiver: undefined, token: undefined, native: false, executed }
  let receiver = await accountForHash(t.to)
  if (!receiver) {
    if (hex(accountHash(signer)) !== hex(t.to)) throw new Error('the recipient NEAR account is not registered with the bridge; connect the recipient account to redeem')
    receiver = signer
    txs.push({ receiverId: NEAR.tokenBridge, actions: [registerCall(signer)], label: 'Register your account with the bridge' })
  }
  const native = t.tokenChain === NEAR.chainId && t.tokenAddress.every((b) => b === 0)
  let token: string | undefined
  if (!native) {
    token = await foreignAsset(t.tokenChain, t.tokenAddress)
    if (!token) throw new Error('this token has no NEAR account on the bridge yet (it was never attested to NEAR)')
    const storage = await nearView(token, 'storage_balance_of', { account_id: receiver })
    if (storage === null) {
      txs.push({ receiverId: token, actions: [call('storage_deposit', { account_id: receiver, registration_only: true }, 100n * TGAS, STORAGE_DEPOSIT)], label: `Open ${receiver}'s balance on ${token}` })
    }
  }
  const submit = call('submit_vaa', { vaa: hex(vaa.bytes) }, 150n * TGAS, SUBMIT_VAA_DEPOSIT)
  // A redeem that stopped after the first call has the transfer verified but not paid out: one call finishes it.
  if (!verified) txs.push({ receiverId: NEAR.tokenBridge, actions: [submit], label: 'Verify the transfer' })
  txs.push({ receiverId: NEAR.tokenBridge, actions: [submit], label: 'Complete the transfer' })
  return { txs, receiver, token, native, executed }
}

// Send native NEAR to another chain. `amount` is in yoctoNEAR and must be a multiple of NEAR_MULT.
export function nearTransferTx(amount: bigint, recipient: Uint8Array, chain: number, fee: bigint): NearTx {
  if (amount <= 0n || amount % NEAR_MULT !== 0n) throw new Error('the amount must be a positive multiple of 0.00000001 NEAR')
  const args = { receiver: hex(recipient), chain, fee: '0', payload: '', message_fee: Number(fee) }
  return { receiverId: NEAR.tokenBridge, actions: [call('send_transfer_near', args, 100n * TGAS, amount + fee)], label: 'Bridge NEAR' }
}

// Send a bridge token (a token from another chain, such as wrapped ALGO) back out. The bridge only accepts these from
// registered accounts, so an unregistered sender registers first.
export async function planWrappedTransfer(signer: string, token: string, amount: bigint, recipient: Uint8Array, chain: number) {
  if (!isBridgeToken(token)) throw new Error(`${token} is not a Wormhole token on NEAR`)
  const fee = await messageFee()
  const txs: NearTx[] = []
  if (!(await isRegistered(signer))) txs.push({ receiverId: NEAR.tokenBridge, actions: [registerCall(signer)], label: 'Register your account with the bridge' })
  const args = { token, amount: amount.toString(), receiver: hex(recipient), chain, fee: '0', payload: '', message_fee: Number(fee) }
  txs.push({ receiverId: NEAR.tokenBridge, actions: [call('send_transfer_wormhole_token', args, 100n * TGAS, fee + 1n)], label: 'Bridge the token' })
  return txs
}

// The Wormhole sequence of a transfer, from the core contract's publish event in the transaction's receipts.
export function sequenceFromNearOutcome(outcome: { receipts_outcome: { outcome: { logs: string[] } }[] }) {
  for (const r of outcome.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue
      const e = JSON.parse(log.slice('EVENT_JSON:'.length))
      if (e.standard === 'wormhole' && e.event === 'publish' && e.emitter === NEAR.tokenBridgeEmitter) return BigInt(e.seq)
    }
  }
  throw new Error('no Wormhole message in this transaction')
}

// Wait for a sent transaction to finish, and throw if any of its receipts failed. The wallet has already sent it, so
// an RPC that times out or has not seen it yet is asked again, for up to about three minutes.
export async function waitForNearTx(hash: string, sender: string) {
  let r: any
  for (let i = 0; ; i++) {
    try {
      r = await nearRpc('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' })
      break
    } catch (e) {
      const transient = /TIMEOUT|UNKNOWN_TRANSACTION|unavailable/i.test(String((e as Error).message))
      if (!transient || i >= 35) throw e
      await new Promise((ok) => setTimeout(ok, 5000))
    }
  }
  const failed = [r.transaction_outcome, ...r.receipts_outcome].find((o) => o.outcome.status?.Failure)
  if (failed || r.status?.Failure) throw new Error(`NEAR transaction failed: ${JSON.stringify((failed ?? r).outcome?.status?.Failure ?? r.status.Failure).slice(0, 300)}`)
  return r
}
