// Path routing for the pages in pages.ts: /, /from-algorand/, /to-algorand/, /redeem/?tx=... or ?vaa=..., /activity/,
// /unwrap/.
// Same-origin links to those paths change the page in place (history.pushState), and back/forward work. Links from
// before the switch to paths (#redeem?tx=...) are rewritten to their path form on load.
import { NOT_FOUND, PAGES, pageForPath, type PageId } from '../pages.ts'

type Route = { page: PageId | 'not-found'; params: URLSearchParams }

const current = (): Route => ({
  page: pageForPath(location.pathname)?.id ?? 'not-found',
  params: new URLSearchParams(location.search),
})

class Router {
  route = $state.raw<Route>(current())
}
export const router = new Router()

function update() {
  router.route = current()
  const page = PAGES.find((p) => p.id === router.route.page)
  document.title = page?.title ?? NOT_FOUND.title
}

// A new page starts at the page links rather than the top of the site: someone scrolled past the wallets stays past
// them, and someone above the links stays where they are.
export function navigate(href: string) {
  history.pushState(null, '', href)
  update()
  const nav = document.querySelector('main > nav')
  const top = nav ? nav.getBoundingClientRect().top + scrollY : 0
  if (scrollY > top) scrollTo({ top })
}

export function startRouter() {
  const [hashPage, hashQuery] = location.hash.slice(1).split('?')
  const old = PAGES.find((p) => p.id === hashPage)
  if (old) history.replaceState(null, '', old.path + (hashQuery ? `?${hashQuery}` : ''))
  // A link without the trailing slash shows the page's own path, as hosts that redirect it would.
  const page = pageForPath(location.pathname)
  if (page && page.path !== location.pathname) history.replaceState(null, '', page.path + location.search + location.hash)
  update()
  addEventListener('popstate', update)
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a')
    if (!a || a.target || a.hasAttribute('download') || e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const url = new URL(a.href, location.href)
    const page = url.origin === location.origin && pageForPath(url.pathname)
    if (!page) return
    e.preventDefault()
    navigate(page.path + url.search)
  })
}
