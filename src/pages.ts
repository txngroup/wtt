// The site's pages: one entry per tab, used by the in-app router and by the build, which writes a pre-rendered
// HTML file for each (own title, description, canonical URL and readable text) so every page can be linked and indexed.
import { CHAINS, type Chain } from './lib/wormhole.ts'

export const SITE_NAME = 'Algorand WTT'
export const SITE_INTRO =
  'Move tokens between Algorand and other chains with the Wormhole Token Bridge (Wrapped Token Transfers). The site ' +
  'runs in your browser and has no backend or custody of its own. It simulates transactions before you sign them ' +
  'wherever the chain allows.'

export type PageId = 'overview' | 'send' | 'to-algorand' | 'redeem' | 'activity' | 'unwrap'

export type Page = {
  id: PageId
  path: string
  tab: string // label in the tab row
  icon: string // path data for the tab's stroked 24x24 icon
  title: string // <title> and social card title
  heading: string // the page's <h1>, under the site name
  description: string // meta description, and the pre-rendered page text; at most 160 characters, which the build checks
  about?: string // HTML under the page's tool, in the app and the pre-rendered page alike
}

// The route pages (src/content/routes.ts), which the app pages link to.
export const toPath = (c: Chain) => `/${c.slug}-algorand-bridge/`
export const fromPath = (c: Chain) => `/algorand-${c.slug}-bridge/`

const and = (l: string[]) => l.slice(0, -1).join(', ') + ' and ' + l.at(-1)
const FAST = CHAINS.filter((c) => !c.slow).map((c) => c.name)
const SLOW = CHAINS.filter((c) => c.slow).map((c) => c.name)
const routeLinks = (path: (c: Chain) => string, label: (c: Chain) => string) =>
  CHAINS.map((c) => `<a href="${path(c)}">${label(c)}</a>`).join(', ')

export const PAGES: Page[] = [
  {
    // Its text is src/overview.html, shared by the app and the pre-rendered page.
    id: 'overview',
    path: '/',
    tab: 'Overview',
    icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v5M12 8h.01',
    title: 'Algorand Bridge: Wormhole Token Bridge to and from Algorand',
    heading: 'Algorand Wormhole bridge',
    description:
      'Algorand bridge for the Wormhole Token Bridge: move tokens between Algorand and Ethereum, Solana, NEAR, Base ' +
      'and more, and finish stuck transfers.',
  },
  {
    id: 'to-algorand',
    path: '/to-algorand/',
    tab: 'To Algorand',
    icon: 'M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4',
    title: `Send Tokens to Algorand (Wormhole Bridge) - ${SITE_NAME}`,
    heading: 'Send tokens to Algorand',
    description:
      'Bridge tokens to Algorand from Ethereum, Solana, Base, Arbitrum, Avalanche, BNB Smart Chain, Polygon, ' +
      'Optimism, Celo or NEAR with the Wormhole Token Bridge.',
    about:
      '<h2>How sending to Algorand works</h2>\n' +
      '<p>A token can go to Algorand only if it already has a Wormhole-wrapped asset there. It arrives as that asset, ' +
      'one ASA for each token on each chain, and can later go back the same way. The recipient has to opt in to the ' +
      'asset, which sets aside 0.1 ALGO; the page offers the opt-in, or the recipient can opt in as part of the redeem.</p>\n' +
      `<p>Wormhole guardians sign a transfer from ${and(FAST)} within about 15 seconds. From ${and(SLOW)} they wait ` +
      'until it is final on Ethereum, which takes 15 to 30 minutes. Then you redeem it on Algorand, usually for under ' +
      '0.01 ALGO. A transfer you leave part way can be finished later on the <a href="/redeem/">Redeem</a> page.</p>\n' +
      `<p>Each chain has a page with the tokens that can go, their addresses and the steps: ${routeLinks(toPath, (c) => c.name)}.</p>`,
  },
  {
    id: 'send',
    path: '/from-algorand/',
    tab: 'From Algorand',
    icon: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    title: `Send Tokens from Algorand (Wormhole Bridge) - ${SITE_NAME}`,
    heading: 'Send tokens from Algorand',
    description:
      'Send Wormhole-wrapped assets on Algorand, such as WETH, USDC or SOL, back to their origin chain with the ' +
      'Wormhole Token Bridge, then redeem them there.',
    about:
      '<h2>How sending from Algorand works</h2>\n' +
      '<p>Only Wormhole-wrapped assets can leave Algorand on this site, each back to the chain it came from, where it ' +
      'is redeemed for the original token. ALGO and Algorand\'s own assets, such as Circle\'s USDC on Algorand, cannot ' +
      'be sent out. The <a href="/wrapped-assets/">wrapped assets</a> page lists every one with its original token.</p>\n' +
      '<p>Wormhole guardians sign a transfer from Algorand within about 15 seconds. Then you redeem it on the ' +
      'destination chain with a wallet there, which pays that chain\'s fee. WETH, WAVAX, WBNB, Wrapped Matic and SOL ' +
      'arrive as the chain\'s own coin. On Solana the recipient\'s own wallet has to redeem.</p>\n' +
      `<p>Each chain has a page with the assets that can go and how to redeem there: ${routeLinks(fromPath, (c) => c.name)}.</p>`,
  },
  {
    id: 'redeem',
    path: '/redeem/',
    tab: 'Redeem',
    icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3 5-6',
    title: `Redeem a Wormhole Transfer - ${SITE_NAME}`,
    heading: 'Redeem a Wormhole transfer',
    description:
      'Finish a Wormhole Token Bridge transfer on Algorand, Solana, NEAR or an EVM chain. Find it by source ' +
      'transaction, Wormholescan ID or signed VAA.',
    about:
      '<h2>When to use Redeem</h2>\n' +
      '<p>A Wormhole transfer finishes only when someone redeems it on the destination chain. This page is for a ' +
      'transfer that was signed but never redeemed, such as one left unfinished on Portal after Portal stopped ' +
      'supporting Algorand, or one you started here and closed the page on.</p>\n' +
      '<p>It looks the transfer up, checks on the destination chain whether it was already redeemed, and redeems it ' +
      'there from your wallet. On Algorand and the EVM chains any wallet can pay for the redeem, and the tokens always ' +
      'go to the recipient written in the transfer.</p>\n' +
      '<p>A transfer signed by an older guardian set that has since expired cannot be redeemed as it is. The page warns ' +
      'about this on every chain but NEAR. <a href="/stuck-transfers/">Stuck transfers</a> explains this and the other ' +
      'reasons a transfer stops.</p>',
  },
  {
    id: 'activity',
    path: '/activity/',
    tab: 'Activity',
    icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
    title: `Wormhole Transfer Activity - ${SITE_NAME}`,
    heading: 'Wormhole transfer activity',
    description:
      'See Wormhole Token Bridge transfers to and from Algorand for any address, check on chain whether each one ' +
      'was redeemed, and continue unfinished ones.',
  },
  {
    id: 'unwrap',
    path: '/unwrap/',
    tab: 'Unwrap',
    icon: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
    title: `Unwrap wSOL, WETH or WAVAX - ${SITE_NAME}`,
    heading: 'Unwrap wSOL, WETH, WAVAX, WBNB or WPOL',
    description:
      'Turn a wrapped gas token, such as wSOL, WETH, WAVAX, WBNB or WPOL, back into the native coin on its chain.',
  },
]

// Each page is built as <name>/index.html, so its path ends in a slash. Links without the slash, or ending in
// index.html, find the same page.
export const byPath = <T extends { path: string }>(list: T[], path: string) => {
  const dir = path.replace(/index\.html$/, '')
  return list.find((p) => p.path === dir || p.path === dir + '/')
}
export const pageForPath = (path: string) => byPath(PAGES, path)

// Any other path. The build writes this page as 404.html, which hosts serve with a 404 status, so search engines drop
// a mistyped or outdated address instead of indexing it as a copy of another page.
export const NOT_FOUND = {
  title: `Page not found - ${SITE_NAME}`,
  heading: 'Page not found',
  description: 'There is no page at this address.',
}

// Links under every page, in the app and the guide pages: the guides, which have no tab of their own, and the source.
export const REPO_URL = 'https://github.com/txngroup/wtt'
export const FOOTER_LINKS = [
  { href: '/bridges/', text: 'Bridge routes' },
  { href: '/wrapped-assets/', text: 'Wrapped assets' },
  { href: '/faq/', text: 'FAQ' },
  { href: '/stuck-transfers/', text: 'Stuck transfers' },
  { href: REPO_URL, text: 'Source code on GitHub' },
]
