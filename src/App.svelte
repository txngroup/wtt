<script lang="ts">
  import { WalletManager, NetworkId, useWalletContext } from '@txnlab/use-wallet-svelte'
  import { pera } from '@txnlab/use-wallet-pera'
  import { lute } from '@txnlab/use-wallet-lute'
  import Send from './Send.svelte'
  import ToAlgorand from './ToAlgorand.svelte'
  import Redeem from './Redeem.svelte'
  import Unwrap from './Unwrap.svelte'
  import Activity from './Activity.svelte'
  import WalletBar from './WalletBar.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import HotRelayDialog from './HotRelayDialog.svelte'
  import { FOOTER_LINKS, NOT_FOUND, PAGES, SITE_NAME, SITE_INTRO } from './pages.ts'
  import { router, startRouter } from './lib/router.svelte.ts'
  import overview from './overview.html?raw' // bundled site text, also pre-rendered at build time

  const manager = new WalletManager({
    wallets: [pera(), lute({ siteName: location.host })],
    defaultNetwork: NetworkId.MAINNET,
  })
  useWalletContext(manager)

  startRouter()
  const route = $derived(router.route)
  const page = $derived(PAGES.find((p) => p.id === route.page))

  // Arrow keys, Home and End move between the page links, as in a tab row.
  function arrows(e: KeyboardEvent) {
    const link = e.currentTarget as HTMLElement
    const links = [...link.parentElement!.children] as HTMLElement[]
    const i = links.indexOf(link)
    const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: links.length - 1 } as Record<string, number>)[e.key]
    if (next === undefined) return
    e.preventDefault()
    links[(next + links.length) % links.length].focus()
  }
</script>

<main>
  <header>
    <a class="brand" href="/">{SITE_NAME}</a>
    <h1>{(page ?? NOT_FOUND).heading}</h1>
    <!-- The other pages open on their own task, so the site introduction stays on the overview. -->
    {#if route.page === 'overview'}<p class="muted">{SITE_INTRO}</p>{/if}
  </header>
  <WalletBar />
  <nav aria-label="Pages">
    {#each PAGES as p (p.id)}
      <a href={p.path} class:active={route.page === p.id} aria-current={route.page === p.id ? 'page' : undefined} onkeydown={arrows}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={p.icon} /></svg><span>{p.tab}</span>
      </a>
    {/each}
  </nav>
  <section class="card">
    {#if route.page === 'redeem'}
      {#key route.params.toString()}
        <Redeem initialTx={route.params.get('tx') ?? route.params.get('vaa') ?? ''} />
      {/key}
    {:else if route.page === 'to-algorand'}
      <ToAlgorand />
    {:else if route.page === 'activity'}
      <Activity />
    {:else if route.page === 'unwrap'}
      <Unwrap />
    {:else if route.page === 'send'}
      <Send />
    {:else if route.page === 'overview'}
      <article class="overview">{@html overview}</article>
    {:else}
      <p>There is no page at this address. Choose a page above, or start from the <a href="/">overview</a>.</p>
    {/if}
  </section>

  <footer class="muted">
    <p class="links">
      {#each FOOTER_LINKS as l (l.href)}<a href={l.href}>{l.text}</a>{' '}{/each}
    </p>
    <p>
      Not affiliated with or endorsed by Wormhole, Portal or the Wormhole Foundation. Bridging cannot be undone, so send a small test
      amount first and check the destination address.
    </p>
    <p>
      Uses the Token Bridge app on Algorand (842126029). Algorand data comes from
      <a href="https://nodely.io" target="_blank" rel="noreferrer">Nodely</a> and Solana data from
      <a href="https://publicnode.com" target="_blank" rel="noreferrer">PublicNode</a>. EVM data comes through your
      wallet, or from PublicNode for WalletConnect wallets. NEAR data comes from
      <a href="https://fastnear.com" target="_blank" rel="noreferrer">FastNEAR</a>, or from NEAR's own public RPC when
      FastNEAR is busy. Signed transfers and their status come from
      <a href="https://wormholescan.io" target="_blank" rel="noreferrer">Wormholescan</a>.
    </p>
  </footer>
  <ConfirmDialog />
  <HotRelayDialog />
</main>
