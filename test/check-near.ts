// Check near.ts against NEAR mainnet and Wormholescan (read-only): the bridge registry, wrapped ALGO, the redeem plan and
// redeem status of the latest transfer into NEAR, and the sequence of the latest transfer out of NEAR.
// Usage: node test/check-near.ts
import * as near from '../src/lib/near.ts'
import { WORMHOLESCAN_API, b64ToBytes, hex, parseVaa } from '../src/lib/wormhole.ts'

const ops = async (q: string) => (await (await fetch(`${WORMHOLESCAN_API}/operations?${q}&appId=PORTAL_TOKEN_BRIDGE&pageSize=10`)).json()).operations
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`)
}

console.log('## registry and tokens')
check('account ids', near.isNearAccountId('alice.near') && near.isNearAccountId('a'.repeat(64)) && !near.isNearAccountId('Alice.near') && !near.isNearAccountId('a..near'))
check('emitter is sha256 of the bridge account', hex(near.accountHash(near.NEAR.tokenBridge)) === near.NEAR.tokenBridgeEmitter)
check('unknown account is not registered', !(await near.isRegistered('wtt-check-no-such-account.near')))
const wrappedAlgo = await near.foreignAsset(8, new Uint8Array(32))
check('wrapped ALGO on NEAR', wrappedAlgo === '9.contract.portalbridge.near', String(wrappedAlgo))
const origin = await near.originalAsset(wrappedAlgo!)
check('its origin is ALGO on Algorand', origin.chain === 8 && /^0+$/.test(origin.address), JSON.stringify(origin))
const meta = await near.ftMetadata(wrappedAlgo!)
check('its metadata', meta.symbol === 'ALGO' && meta.decimals === 6, `${meta.symbol}, ${meta.decimals} decimals`)
check('bridge token naming', near.isBridgeToken(wrappedAlgo!) && !near.isBridgeToken('wrap.near'))
console.log(`      message fee ${await near.messageFee()} yoctoNEAR`)

console.log('## latest transfer into NEAR')
// Wormholescan does not record redeems on NEAR, so the app asks the bridge (is_transfer_completed).
const incoming = (await ops('targetChain=15')).find((o: any) => o.vaa?.raw)
const vaa = parseVaa(b64ToBytes(incoming.vaa.raw))
const receiver = await near.accountForHash(vaa.transfer!.to)
check('recipient resolves to a registered account', !!receiver && (await near.isRegistered(receiver)), `${incoming.id} -> ${receiver}`)
console.log(`      redeemed on NEAR: ${await near.isRedeemedOnNear(vaa)}`)
// A transfer the bridge has paid out needs nothing more. The rest of the checks use the same transfer with a new nonce,
// which the bridge has never seen: its plan verifies with one submit_vaa and pays out with a second.
const done = await near.planNearRedeem(receiver!, vaa)
check('a paid-out transfer needs no transactions', (await near.isRedeemedOnNear(vaa)) ? done.executed && done.txs.length === 0 : !done.executed)
const unseen = Uint8Array.from(vaa.bytes)
unseen.set([0x77, 0x74, 0x74, 0x21], unseen.length - vaa.body.length + 4)
const fresh0 = parseVaa(unseen)
const plan = await near.planNearRedeem(receiver!, fresh0)
const submits = (p: typeof plan) => p.txs.filter((t) => t.actions[0].methodName === 'submit_vaa' && t.receiverId === near.NEAR.tokenBridge).length
check('an unseen transfer gets two submit_vaa calls', submits(plan) === 2, plan.txs.map((t) => `${t.receiverId}.${t.actions[0].methodName}`).join(', '))
check('no registration for a registered recipient', !plan.txs.some((t) => t.actions[0].methodName === 'register_account'))
const stranger = 'wtt-check-no-such-account.near'
await near.planNearRedeem(stranger, fresh0).then(
  () => check('anyone can redeem for a registered recipient', true),
  (e) => check('anyone can redeem for a registered recipient', false, e.message),
)
// The same transfer, as if it were to an account the bridge has never seen.
const unregistered = { ...fresh0, transfer: { ...fresh0.transfer!, to: near.accountHash(stranger) } }
await near.planNearRedeem('someone-else.near', unregistered).then(
  () => check('someone else cannot redeem for an unregistered recipient', false),
  () => check('someone else cannot redeem for an unregistered recipient', true),
)
const own = await near.planNearRedeem(stranger, unregistered)
check('an unregistered recipient registers first', own.txs[0].actions[0].methodName === 'register_account' && own.txs[0].actions[0].args.account === stranger)

// Every call exactly as @certusone/wormhole-sdk 0.10.18, the last Wormhole SDK with NEAR support, builds it. The values
// were compared call by call with its registerAccount, redeemOnNear, transferNearFromNear and transferTokenFromNear on
// 2026-10-23, and are written out here so the check needs no copy of that SDK.
console.log('## calls, as the Wormhole SDK builds them')
const TGAS = 10n ** 12n
const sorted = (v: any): any => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v)
const show = (receiverId: string, a: near.NearCall) => JSON.stringify({ receiverId, methodName: a.methodName, args: sorted(a.args), gas: String(a.gas), deposit: String(a.deposit) })
function expectCall(label: string, tx: near.NearTx | undefined, receiverId: string, methodName: string, args: Record<string, unknown>, gas: bigint, deposit: bigint) {
  const want = show(receiverId, { methodName, args, gas, deposit })
  const got = tx && tx.actions.length === 1 ? show(tx.receiverId, tx.actions[0]) : JSON.stringify(tx)
  check(label, got === want, got === want ? '' : `\n        want ${want}\n        got  ${got}`)
}
// The full redeem: the transfer with a new nonce, to an account the bridge and the token have never seen.
const fresh = Uint8Array.from(unseen)
fresh.set(near.accountHash(stranger), fresh.length - vaa.payload.length + 67)
const full = (await near.planNearRedeem(stranger, parseVaa(fresh))).txs
const t = vaa.transfer!
const token = t.tokenChain === 15 && t.tokenAddress.every((b) => b === 0) ? undefined : await near.foreignAsset(t.tokenChain, t.tokenAddress)
const submit = { vaa: hex(fresh) }
expectCall('register_account', full[0], near.NEAR.tokenBridge, 'register_account', { account: stranger }, 100n * TGAS, 2n * 10n ** 21n)
if (token) expectCall('storage_deposit on the token', full[1], token, 'storage_deposit', { account_id: stranger, registration_only: true }, 100n * TGAS, 2n * 10n ** 21n)
expectCall('submit_vaa, to verify', full.at(-2), near.NEAR.tokenBridge, 'submit_vaa', submit, 150n * TGAS, 10n ** 23n)
expectCall('submit_vaa, to complete', full.at(-1), near.NEAR.tokenBridge, 'submit_vaa', submit, 150n * TGAS, 10n ** 23n)
check('nothing else in the redeem', full.length === (token ? 4 : 3), full.map((x) => x.actions[0].methodName).join(', '))
const to = new Uint8Array(32).fill(7)
const fee = await near.messageFee()
const nearAmount = 15n * 10n ** 23n
expectCall('send_transfer_near', near.nearTransferTx(nearAmount, to, 8, fee), near.NEAR.tokenBridge, 'send_transfer_near', { receiver: hex(to), chain: 8, fee: '0', payload: '', message_fee: Number(fee) }, 100n * TGAS, nearAmount + fee)
const wrappedSend = await near.planWrappedTransfer(receiver!, wrappedAlgo!, 500000n, to, 8)
expectCall('send_transfer_wormhole_token', wrappedSend.at(-1), near.NEAR.tokenBridge, 'send_transfer_wormhole_token', { token: wrappedAlgo, amount: '500000', receiver: hex(to), chain: 8, fee: '0', payload: '', message_fee: Number(fee) }, 100n * TGAS, fee + 1n)
check('a registered sender needs no registration to send', wrappedSend.length === 1)

console.log('## latest transfer out of NEAR')
const outgoing = (await ops('sourceChain=15')).find((o: any) => o.sourceChain?.transaction?.txHash && o.sourceChain?.from)
// Wormholescan writes implicit accounts (64 hex characters) with a 0x prefix NEAR does not use.
const sender = outgoing.sourceChain.from.replace(/^0x(?=[0-9a-f]{64}$)/, '')
const outcome = await near.waitForNearTx(outgoing.sourceChain.transaction.txHash, sender)
check('sequence from the publish event matches Wormholescan', String(near.sequenceFromNearOutcome(outcome)) === String(outgoing.sequence), `${outgoing.id}`)

console.log(failures ? `\n${failures} FAILED` : '\nALL NEAR CHECKS PASSED')
process.exit(failures ? 1 : 0)
