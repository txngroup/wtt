// Oracle test: build the Algorand redeem group for real Algorand-bound VAAs with the official SDK and with the
// hand-rolled src/lib/algorand-redeem.ts, and diff them (ignoring rounds, genesis, group id, notes).
// Run from test/sdk after npm ci: node compare-algorand-redeem.mjs [<wormholescan op id> ...]
// Without ids, it takes the three latest transfers to Algorand that Wormholescan lists.
import algosdk from 'algosdk' // v2, as used by the SDK
import { Wormhole } from '@wormhole-foundation/sdk-connect'
import { deserialize } from '@wormhole-foundation/sdk-definitions'
import { AlgorandPlatform } from '@wormhole-foundation/sdk-algorand'
import '@wormhole-foundation/sdk-algorand-core'
import '@wormhole-foundation/sdk-algorand-tokenbridge'
import { parseVaa, b64ToBytes } from '../../src/lib/wormhole.ts'
import { buildAlgorandRedeem } from '../../src/lib/algorand-redeem.ts'

const wh = new Wormhole('Mainnet', [AlgorandPlatform], { chains: { Algorand: { rpc: 'https://mainnet-api.algonode.cloud' } } })
const tb = await wh.getChain('Algorand').getTokenBridge()
// Canonical JSON of an unsigned txn: bytes as hex, bigints as strings, keys sorted, round/group fields dropped.
const norm = (v) =>
  v instanceof Uint8Array ? Buffer.from(v).toString('hex')
  : Array.isArray(v) ? v.map(norm)
  : typeof v === 'bigint' ? v.toString()
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
  : v
const strip = (bytes) => {
  const o = algosdk.decodeObj(bytes)
  for (const k of ['fv', 'lv', 'gh', 'grp', 'gen', 'note']) delete o[k]
  return JSON.stringify(norm(o))
}
let failures = 0
const latest = async () =>
  (await (await fetch('https://api.wormholescan.io/api/v1/operations?targetChain=8&appId=PORTAL_TOKEN_BRIDGE&pageSize=20')).json()).operations
    .filter((o) => o.vaa?.raw && o.content?.payload?.payloadType === 1)
    .slice(0, 3)
    .map((o) => o.id)
const ids = process.argv.length > 2 ? process.argv.slice(2) : await latest()
for (const id of ids) {
  const op = await (await fetch(`https://api.wormholescan.io/api/v1/operations/${id}`)).json()
  const bytes = b64ToBytes(op.vaa.raw)
  const v = parseVaa(bytes)
  const receiver = algosdk.encodeAddress(v.transfer.to)
  console.log(`\n## ${id}\nreceiver ${receiver}, token chain ${v.transfer.tokenChain}, amount ${v.transfer.amount}`)
  const sdkTxns = []
  for await (const utx of tb.redeem(receiver, deserialize('TokenBridge:Transfer', bytes))) sdkTxns.push(utx.transaction.tx)
  const ours = await buildAlgorandRedeem(receiver, v)
  console.log(`txn count: sdk ${sdkTxns.length}, ours ${ours.txns.length}; asset ${ours.assetId}; opt-in ${ours.needsOptIn}`)
  let a = sdkTxns.map((t) => strip(algosdk.encodeUnsignedTransaction(t)))
  const b = ours.txns.map((t) => strip(t.toByte()))
  // The SDK treats an opted-in receiver with a zero balance as not opted in and prepends a redundant (harmless)
  // 0-amount self opt-in; we check that the holding exists instead.
  if (a.length === b.length + 1 && !ours.needsOptIn && JSON.parse(a[0]).type === 'axfer' && !JSON.parse(a[0]).aamt) {
    console.log('note: SDK prepends a redundant opt-in (receiver holds the asset with a 0 balance); skipped')
    a = a.slice(1)
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) console.log(`OK    [${i}] ${JSON.parse(a[i]).type}`)
    else {
      failures++
      console.log(`DIFF  [${i}]\n  sdk:  ${a[i]}\n  ours: ${b[i]}`)
    }
  }
}
console.log(failures ? `\n${failures} DIFFERENCES` : '\nALL TRANSACTIONS IDENTICAL TO THE SDK')
process.exit(failures ? 1 : 0)
