// Lists every Wormhole-wrapped asset on Algorand with its origin chain, origin token address and the amount in
// circulation, as JSON on stdout. The route pages' token tables come from this list.
//
//   node scripts/wrapped-assets.mjs > src/content/wrapped-assets.json
//
// The token bridge creates each wrapped ASA from a storage account that is opted in to the bridge app and rekeyed to
// it. The indexer lists those accounts; the ones that created an asset are the wrapped assets. Each storage account's
// local state holds the origin, as in src/lib/algorand.ts. In circulation is the total less what the reserve (the
// creator) still holds.
const IDX = 'https://mainnet-idx.algonode.cloud'
const ALGOD = 'https://mainnet-api.algonode.cloud'
const APP = 842126029
const BRIDGE = 'M7UT7JWIVROIDGMQVJZUBQGBNNIIVOYRPC7JWMGQES4KYJIZHVCRZEGFRQ'

async function get(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url)
    if (r.ok) return r.json()
    if (i === 4 || (r.status !== 429 && r.status < 500)) throw new Error(`${url}: HTTP ${r.status}`)
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)))
  }
}

const creators = []
let next
do {
  const q = `${IDX}/v2/accounts?application-id=${APP}&limit=1000&exclude=assets,created-apps,apps-local-state` + (next ? `&next=${next}` : '')
  const page = await get(q)
  for (const a of page.accounts) if (a['total-created-assets'] > 0 && a['auth-addr'] === BRIDGE) creators.push(a.address)
  next = page['next-token']
} while (next)

const b64 = (s) => Buffer.from(s, 'base64')
const assets = []
for (const creator of creators) {
  const [created, local] = await Promise.all([
    get(`${IDX}/v2/accounts/${creator}/created-assets?include-all=false`),
    get(`${ALGOD}/v2/accounts/${creator}/applications/${APP}`),
  ])
  const kvs = (local['app-local-state']?.['key-value'] ?? [])
    .map((kv) => ({ key: b64(kv.key), value: b64(kv.value.bytes ?? '') }))
    .filter((kv) => !(kv.key.length === 4 && kv.key.toString() === 'meta'))
    .sort((a, b) => a.key[0] - b.key[0])
  const blob = Buffer.concat(kvs.map((kv) => kv.value))
  if (blob.length < 94) continue
  const assetId = Number(blob.readBigUInt64BE(0))
  const asset = created.assets.find((a) => a.index === assetId)
  if (!asset || asset.params.manager !== BRIDGE || asset.params.reserve !== creator) continue
  const held = await get(`${ALGOD}/v2/accounts/${creator}/assets/${assetId}`).catch(() => undefined)
  const reserve = BigInt(held?.['asset-holding']?.amount ?? 0)
  assets.push({
    assetId,
    unitName: asset.params['unit-name'] ?? '',
    name: asset.params.name ?? '',
    decimals: asset.params.decimals,
    originChain: blob.readUInt16BE(92),
    originAddress: blob.subarray(60, 92).toString('hex'),
    circulating: (BigInt(asset.params.total) - reserve).toString(),
  })
}
assets.sort((a, b) => a.originChain - b.originChain || a.assetId - b.assetId)
// Non-ASCII characters in asset names are written as \u escapes, so the file stays ASCII.
const json = JSON.stringify({ checked: new Date().toISOString().slice(0, 10), assets }, null, 2)
console.log(json.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')))
