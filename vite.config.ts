import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { NOT_FOUND, PAGES, SITE_NAME, SITE_INTRO, type Page } from './src/pages.ts'

// The site's security headers. The build writes them to dist/_headers, which Cloudflare Pages and Netlify read, and adds
// the Content-Security-Policy to every page as a <meta> tag for hosts that cannot send headers, such as IPFS gateways.
// - script-src 'self': no inline or eval'd script, no third-party script.
// - style-src 'unsafe-inline': Svelte and wallet connect modals set inline styles.
// - connect-src: only the hosts the app and its wallet SDKs call, so a compromised dependency cannot send data anywhere
//   else. Wormholescan; Algorand algod and indexer (Nodely); PublicNode for Solana and EVM reads; Pera's config, bridges
//   (wallet-connect-*.perawallet.app, listed in wc.perawallet.app/config.json) and node; the two Pera modal animations,
//   as exact files in Pera's S3 bucket; the WalletConnect relay and verify API. Lute opens lute.app in a popup and
//   needs no entry. data: is for an icon the Pera modal fetches inline. Browser wallets make their RPC calls from the
//   extension, not the page. A new wallet or RPC host must be added here first.
// - media-src: the sound Pera Connect loops on iPhones while the connection waits for approval in the Pera app, which
//   seems to keep the backgrounded tab and its bridge connection alive. One exact file.
// - frame-src: Pera Web and Lute open inside frames; WalletConnect's verify service is an iframe.
// - frame-ancestors only works as a header, so the <meta> copy leaves it out.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' data: https://api.wormholescan.io https://mainnet-api.algonode.cloud https://mainnet-idx.algonode.cloud https://*.publicnode.com https://*.perawallet.app wss://*.perawallet.app https://s3.amazonaws.com/wc.perawallet.app/static/sign-toast-animation.json https://s3.amazonaws.com/wc.perawallet.app/static/pera-loader-animation.json wss://relay.walletconnect.org https://verify.walletconnect.org",
  'media-src https://s3.amazonaws.com/wc.perawallet.app/audio.mp3',
  'frame-src https://*.perawallet.app https://lute.app https://verify.walletconnect.org',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
]
const HEADERS = `/*
  Content-Security-Policy: ${[...CSP, "frame-ancestors 'none'"].join('; ')}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Absolute links (canonical, social card, sitemap) need the address the site is served from, SITE_URL. Without it the
// build leaves them out.
// The not-found page (no page) asks search engines not to index it, and has no canonical address of its own.
function head(page: Page | undefined, siteUrl: string) {
  if (!page) {
    return [
      `<title>${esc(NOT_FOUND.title)}</title>`,
      `<meta name="description" content="${esc(NOT_FOUND.description)}" />`,
      `<meta name="robots" content="noindex" />`,
    ].join('\n    ')
  }
  const url = siteUrl + page.path
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
  ]
  if (siteUrl) {
    tags.push(
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${siteUrl}/og.png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${SITE_NAME}: bridge tokens to and from Algorand" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    )
  }
  if (page.path === '/') {
    // Structured data for search engines; a data block, so the page's script-src policy does not apply.
    const app = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE_NAME,
      ...(siteUrl && { url: siteUrl + '/' }),
      description: SITE_INTRO,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any (web browser)',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }
    tags.push(`<script type="application/ld+json">${JSON.stringify(app)}</script>`)
  }
  return tags.join('\n    ')
}

// The overview's text, shared with the app (App.svelte imports it too).
const overview = readFileSync(new URL('./src/overview.html', import.meta.url), 'utf8')

// What crawlers and no-JavaScript visitors see: the same header, tabs and footer as the app, and the page's purpose
// (the full text, for the overview).
function body(page: Page | undefined) {
  const icon = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}" /></svg>`
  const nav = PAGES.map(
    (p) => `<a href="${p.path}"${p.id === page?.id ? ' class="active" aria-current="page"' : ''}>${icon(p.icon)}<span>${esc(p.tab)}</span></a>`,
  ).join('')
  const content = !page
    ? `<h2>Page not found</h2>\n        <p>There is no page at this address. Choose a page above, or start from the <a href="/">overview</a>.</p>`
    : page.id === 'overview'
      ? `<article class="overview">${overview}</article>`
      : `<h2>${esc(page.tab)}</h2>\n        <p>${esc(page.description)}</p>`
  return `<main>
      <header><h1>${SITE_NAME}</h1>${page?.id === 'overview' ? `<p class="muted">${esc(SITE_INTRO)}</p>` : ''}</header>
      <nav aria-label="Pages">${nav}</nav>
      <section class="card">
        ${content}
        <noscript><p class="warn">This site needs JavaScript to connect wallets and build transactions.</p></noscript>
      </section>
      <footer class="muted"><p>Not affiliated with or endorsed by Wormhole, Portal or the Wormhole Foundation.</p></footer>
    </main>`
}

const render = (html: string, page: Page | undefined, siteUrl: string) =>
  html.replace(/<!-- page-head:[^>]*-->/, head(page, siteUrl)).replace(/<!-- page-body:[^>]*-->/, body(page))

// The root page is rendered in place; every other page gets its own <path>/index.html, plus 404.html, _headers,
// robots.txt and a sitemap of the pages.
function pages(siteUrl: string): Plugin {
  let template = ''
  return {
    name: 'wtt-pages',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // The policy would block the dev server's own scripts, so only builds carry it.
        if (!ctx.server) html = html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP.join('; ')}" />`)
        template = html
        return render(html, PAGES[0], siteUrl)
      },
    },
    generateBundle: {
      order: 'post', // after Vite has rendered index.html, which fills `template`
      handler() {
        for (const page of PAGES.slice(1)) {
          this.emitFile({ type: 'asset', fileName: `${page.path.slice(1)}index.html`, source: render(template, page, siteUrl) })
        }
        this.emitFile({ type: 'asset', fileName: '404.html', source: render(template, undefined, siteUrl) })
        this.emitFile({ type: 'asset', fileName: '_headers', source: HEADERS })
        const sitemap = siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n${sitemap}` })
        if (!siteUrl) return this.warn('SITE_URL is not set: the build has no canonical links, social card image or sitemap')
        const urls = PAGES.map((p) => `  <url><loc>${siteUrl}${p.path}</loc></url>`).join('\n')
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        })
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // SITE_URL comes from the environment or a .env file, like the VITE_ settings the app reads (see .env.example).
  const siteUrl = (loadEnv(mode, process.cwd(), '').SITE_URL ?? '').replace(/\/+$/, '')
  return {
    plugins: [svelte(), pages(siteUrl)],
    // Some wallet connector dependencies still reference Node's `global`.
    define: { global: 'globalThis' },
    build: { target: 'es2022', sourcemap: true },
  }
})
