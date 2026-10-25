// /wrapped-assets/: every Wormhole-wrapped asset on Algorand from a chain this site supports, by origin chain, from
// wrapped-assets.json. Each row links the ASA to allo.info and Vestige, and the original token to its chain's explorer.
// wrapped-assets.json also lists assets from chains the site does not support, which the page leaves out.
import { CHAINS } from '../lib/wormhole.ts'
import { REPO_URL } from '../pages.ts'
import wrapped from './wrapped-assets.json' with { type: 'json' }
import { esc, type Doc } from './doc.ts'
import { CHECKED, external, fromPath, originalToken, table, type Asset } from './routes.ts'


// Unit name, then the name (unless it only repeats the unit name) and the ASA id underneath.
const label = (a: Asset) => {
  const unit = a.unitName.trim()
  const name = a.name.trim()
  const title = unit && name && unit.toLowerCase() !== name.toLowerCase() ? `${esc(unit)}<br><span class="muted">${esc(name)}</span>` : esc(unit || name || '(no name)')
  return `${title}<br><span class="muted">ASA <code class="id">${a.assetId}</code></span>`
}

const row = (a: Asset) => [
  label(a),
  originalToken(a),
  `${external(`https://allo.info/asset/${a.assetId}`, 'allo.info')}, ${external(`https://vestige.fi/asset/${a.assetId}`, 'Vestige')}`,
]

// In the site's chain order.
const byChain = CHAINS.map((c) => ({ c, assets: wrapped.assets.filter((a) => a.originChain === c.id) })).filter((x) => x.assets.length)

const summary = table(
  ['Origin chain', 'Wrapped assets'],
  byChain.map(({ c, assets }) => [`<a href="#${c.slug}">${esc(c.name)}</a>`, String(assets.length)]),
  true,
)

const sections = byChain
  .map(
    ({ c, assets }) => `<h2 id="${c.slug}">From ${esc(c.name)}</h2>
<p>To send them back, see the <a href="${fromPath(c)}">Algorand to ${esc(c.name)} bridge</a>.</p>
${table(['Asset', `Original token on ${esc(c.name)}`, 'Look up'], assets.map(row))}`,
  )
  .join('\n')

const total = byChain.reduce((n, x) => n + x.assets.length, 0)

export const ASSETS_DOC: Doc = {
  path: '/wrapped-assets/',
  title: 'Wormhole-Wrapped Assets on Algorand - Algorand WTT',
  heading: 'Wormhole-wrapped assets on Algorand',
  description:
    `All ${total} Wormhole-wrapped assets on Algorand by origin chain, with each one's original token address and ` +
    'links to allo.info and Vestige for supply, holders and prices.',
  html: `<p>The Wormhole Token Bridge creates one Algorand asset (ASA) for each token that has been attested to Algorand from another chain. On ${CHECKED} there were ${total} from the chains this site supports. Each one can only go back to the chain it came from, where it is redeemed for the original token.</p>
<p>Anyone can attest a token, so the list includes test tokens and spam. A wrapped asset is worth only what its original token is worth, and an ASA's name proves nothing. Check the original token's address before trusting an asset.</p>
<p>For how much of each asset is on Algorand now, its holders, trading and prices, follow the allo.info and Vestige links.</p>
${summary}
${sections}
<h2>How this list is made</h2>
<p>The bridge creates each wrapped asset from a storage account that it controls, with itself as the asset's manager, and records the asset's origin in that account. The list has every ASA created that way whose recorded origin leads back to the same storage account. The script that builds it, <a href="${REPO_URL}/blob/main/scripts/wrapped-assets.mjs">scripts/wrapped-assets.mjs</a>, reads only public Algorand data, so anyone can run it and compare.</p>`,
}
