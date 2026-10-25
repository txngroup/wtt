// /wrapped-assets/: every Wormhole-wrapped asset on Algorand, by origin chain, from wrapped-assets.json. Each row links
// the ASA to allo.info and Vestige, and the original token to its chain's explorer.
import { CHAINS, chainById } from '../lib/wormhole.ts'
import { REPO_URL } from '../pages.ts'
import wrapped from './wrapped-assets.json' with { type: 'json' }
import { esc, type Doc } from './doc.ts'
import { CHECKED, amount, base58, checksum, fromPath, held, table, type Asset } from './routes.ts'

// Chains with wrapped assets on Algorand that this site does not support, by Wormhole chain id.
const OTHER_CHAINS: Record<number, string> = { 3: 'Terra Classic', 7: 'Oasis', 10: 'Fantom', 16: 'Moonbeam', 18: 'Terra', 22: 'Aptos' }
const chainLabel = (id: number) => chainById(id)?.name ?? OTHER_CHAINS[id] ?? `Wormhole chain ${id}`
const anchor = (id: number) => chainById(id)?.slug ?? `chain-${id}`

const external = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`

// The original token: a link to the token on its chain's explorer where this site supports the chain, else its
// 32-byte Wormhole address. NEAR's own coin has no token address.
function original(a: Asset) {
  const c = chainById(a.originChain)
  if (c?.platform === 'near' && /^0+$/.test(a.originAddress)) return 'NEAR (the native coin)'
  if (c?.platform === 'evm' || c?.platform === 'solana') {
    const address = c.platform === 'evm' ? checksum(a.originAddress.slice(24)) : base58(a.originAddress)
    return external(c.explorerTx.replace(/\/tx\/$/, '/token/') + address, `<code>${address}</code>`)
  }
  return `<code>${a.originAddress}</code>`
}

const label = (a: Asset) => {
  const unit = a.unitName.trim()
  const name = a.name.trim()
  return unit && name ? `${esc(unit)}<br><span class="muted">${esc(name)}</span>` : esc(unit || name || '(no name)')
}

const row = (a: Asset) => [
  label(a),
  `<code>${a.assetId}</code>`,
  held(a) ? `${amount(a)}` : '0',
  original(a),
  `${external(`https://allo.info/asset/${a.assetId}`, 'allo.info')}, ${external(`https://vestige.fi/asset/${a.assetId}`, 'Vestige')}`,
]

const byChain = [...new Set(wrapped.assets.map((a) => a.originChain))]
  .map((id) => ({ id, assets: wrapped.assets.filter((a) => a.originChain === id) }))
  // Supported chains first, in the site's chain order, then the others.
  .sort((x, y) => {
    const i = (id: number) => (chainById(id) ? CHAINS.indexOf(chainById(id)!) : CHAINS.length + id)
    return i(x.id) - i(y.id)
  })

const summary = table(
  ['Origin chain', 'Wrapped assets', 'In circulation'],
  byChain.map(({ id, assets }) => [`<a href="#${anchor(id)}">${esc(chainLabel(id))}</a>`, String(assets.length), String(assets.filter(held).length)]),
  true,
)

const sections = byChain
  .map(({ id, assets }) => {
    const c = chainById(id)
    const note = c
      ? `<p>To send them back, see the <a href="${fromPath(c)}">Algorand to ${esc(c.name)} bridge</a>.</p>\n`
      : `<p>This site does not support ${esc(chainLabel(id))}, so these assets cannot be sent back from here.</p>\n`
    return `<h2 id="${anchor(id)}">From ${esc(chainLabel(id))}</h2>
${note}${table(['Asset', 'ASA', 'On Algorand', `Original token on ${esc(chainLabel(id))}`, 'Look up'], assets.map(row))}`
  })
  .join('\n')

const total = wrapped.assets.length

export const ASSETS_DOC: Doc = {
  path: '/wrapped-assets/',
  title: 'Wormhole-Wrapped Assets on Algorand - Algorand WTT',
  heading: 'Wormhole-wrapped assets on Algorand',
  description:
    `All ${total} Wormhole-wrapped assets on Algorand by origin chain, with each one's original token address, the ` +
    'amount on Algorand, and links to allo.info and Vestige.',
  html: `<p>The Wormhole Token Bridge creates one Algorand asset (ASA) for each token that has been attested to Algorand from another chain. On ${CHECKED} there were ${total}, from ${byChain.length} chains. Each one can only go back to the chain it came from, where it is redeemed for the original token.</p>
<p>Anyone can attest a token, so the list includes test tokens and spam. A wrapped asset is worth only what its original token is worth, and an ASA's name proves nothing. Check the original token's address before trusting an asset.</p>
<p>"On Algorand" is the amount in circulation: the asset's total less what the bridge still holds in reserve. For holders, trading and prices, follow the allo.info and Vestige links.</p>
${summary}
${sections}
<h2>How this list is made</h2>
<p>The bridge creates each wrapped asset from a storage account that it controls, with itself as the asset's manager, and records the asset's origin in that account. The list has every ASA created that way whose recorded origin leads back to the same storage account. The script that builds it, <a href="${REPO_URL}/blob/main/scripts/wrapped-assets.mjs">scripts/wrapped-assets.mjs</a>, reads only public Algorand data, so anyone can run it and compare.</p>`,
}
