<script lang="ts">
  // One wallet slot (Algorand, EVM or Solana): its status, then the connected address and a menu holding Disconnect,
  // or a Connect button that lists the ways to connect, or a WalletConnect pairing in progress. It only renders; WalletBar holds the state.
  import { tick } from 'svelte'
  import { short } from './lib/format.ts'
  import WalletConnectPanel from './WalletConnectPanel.svelte'

  type Status = 'connected' | 'connecting' | 'disconnected'
  let {
    chain,
    anchor,
    status,
    statusText,
    address,
    walletName,
    explorer,
    error,
    options = [],
    pairing,
    accountHint = 'an account on this chain',
    ondisconnect,
    oncancel,
  }: {
    chain: string
    anchor?: string // element id, so the wallet bar can scroll to this card
    status: Status
    statusText?: string // replaces the default status word, e.g. "Reconnecting..."
    address?: string
    walletName?: string
    explorer?: string // account page on a block explorer
    error?: string
    options?: { name: string; connect: () => void }[] // ways to connect, shown while disconnected
    pairing?: { uri: string; qr: string } // a WalletConnect pairing waiting for the wallet
    accountHint?: string
    ondisconnect?: () => void
    oncancel?: () => void
  } = $props()

  const STATUS: Record<Status, string> = { connected: 'Connected', connecting: 'Connecting...', disconnected: 'Not connected' }
  const id = $props.id()

  let menuOpen = $state(false)
  let menuButton = $state<HTMLButtonElement>()
  let menu = $state<HTMLElement>()
  let copied = $state(false)
  let said = $state('') // read out by screen readers
  let choosing = $state(false) // the list of wallets is open
  let connectButton = $state<HTMLButtonElement>()
  let ways = $state<HTMLElement>()

  // Every card shows one Connect button. With a single way to connect it starts that; otherwise it lists them.
  // Also called by the wallet bar when a page's Connect button asks for this wallet.
  export async function choose() {
    if (!options.length) return
    if (options.length === 1) return options[0].connect()
    choosing = true
    await tick()
    ways?.querySelector('button')?.focus({ preventScroll: true })
  }

  async function stopChoosing() {
    choosing = false
    await tick()
    connectButton?.focus()
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (menuOpen) closeMenu()
    else if (choosing) stopChoosing()
  }

  async function copy() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      copied = true
      said = `${chain} address copied`
      setTimeout(() => ((copied = false), (said = '')), 1500)
    } catch {
      said = 'Could not copy the address'
    }
  }

  function closeMenu(refocus = true) {
    menuOpen = false
    if (refocus) menuButton?.focus()
  }

  function outside(e: MouseEvent) {
    const t = e.target as Node
    if (menuOpen && !menu?.contains(t) && !menuButton?.contains(t)) closeMenu(false)
  }
</script>

<svelte:window onclick={outside} {onkeydown} />

<!-- idle: only the Connect button below the status, which phones show on one line -->
<section class="wallet" id={anchor} class:pairing={!!pairing} class:idle={status !== 'connected' && !pairing && options.length > 0 && !choosing} aria-label="{chain} wallet">
  <div class="head">
    <span class="chain">{chain}</span>
    <span class="status {status}" aria-live="polite"><span class="dot" aria-hidden="true"></span>{statusText ?? STATUS[status]}</span>
    {#if status === 'connected'}
      <div class="more">
        <button
          class="icon"
          bind:this={menuButton}
          aria-label="{chain} wallet options"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${id}-menu` : undefined}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
        {#if menuOpen}
          <div class="menu" id="{id}-menu" bind:this={menu}>
            <button onclick={() => (closeMenu(), copy())}>Copy address</button>
            {#if explorer}<a href={explorer} target="_blank" rel="noreferrer" onclick={() => closeMenu(false)}>View on explorer</a>{/if}
            <button class="err" onclick={() => (closeMenu(false), ondisconnect?.())}>Disconnect</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if status === 'connected' && address}
    <button class="address" title={address} aria-label="Copy {chain} address {short(address, 6)}" onclick={copy}>
      <span>{short(address, 6)}</span>
      {#if copied}
        <span class="ok copied">Copied</span>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" /><path d="M5 15V3h12" /></svg>
      {/if}
    </button>
    {#if walletName}<span class="muted name">{walletName}</span>{/if}
  {:else if pairing && oncancel}
    <WalletConnectPanel uri={pairing.uri} qr={pairing.qr} {accountHint} {oncancel} />
  {:else if options.length}
    {#if choosing}
      <div class="ways" bind:this={ways}>
        {#each options as o}<button onclick={() => ((choosing = false), o.connect())}>{o.name}</button>{/each}
        <button class="quiet" onclick={stopChoosing}>Cancel</button>
      </div>
    {:else}
      <div class="ways">
        <button bind:this={connectButton} aria-label="Connect {chain} wallet" onclick={choose}>Connect</button>
      </div>
    {/if}
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
  <span class="sr-only" aria-live="polite">{said}</span>
</section>

<style>
  .wallet {
    display: flex; flex-direction: column; gap: 6px; min-width: 0;
    padding: 12px 8px 14px 14px; border: 1px solid var(--line); background: var(--field);
  }
  /* A pairing in progress stays in its column and grows downward. */
  .wallet.pairing { border-color: var(--fg); padding: 14px; gap: 12px; }
  .head { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .chain { font: 13px var(--mono); text-transform: uppercase; letter-spacing: .06em; }
  .status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .dot { width: 7px; height: 7px; border: 1.5px solid currentColor; flex: none; }
  .status.connected { color: var(--ok); }
  .status.connected .dot { background: currentColor; }
  .status.connecting { color: var(--warn); }

  .more { position: relative; margin-left: auto; }
  .icon { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; color: var(--muted); }
  .icon:hover:not(:disabled) { color: var(--fg); }
  .menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 180px;
    display: flex; flex-direction: column; padding: 4px;
    border: 1px solid var(--fg); background: var(--field); box-shadow: 0 8px 24px rgb(0 0 0 / .25);
  }
  .menu > * {
    display: flex; align-items: center; min-height: 44px; padding: 0 12px; border: 0;
    font-size: 15px; text-align: left; text-decoration: none;
  }
  .menu > a { color: var(--fg); }
  .menu > a:hover { background: var(--sunk); }
  .menu > .err { color: var(--err); }

  .address {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 0;
    border: 0; font: 16px var(--mono);
  }
  .address:hover:not(:disabled) { background: none; text-decoration: underline; text-underline-offset: 3px; }
  .address svg { color: var(--muted); }
  .copied { font: 13px system-ui, sans-serif; }
  .name { font-size: 14px; }

  .ways { display: flex; flex-direction: column; gap: 8px; padding: 6px 6px 0 0; }
  .ways button { min-height: 48px; }
  .ways .quiet { align-self: flex-start; min-height: 44px; padding: 0 4px; border: 0; color: var(--muted); }
  .ways .quiet:hover:not(:disabled) { background: none; color: var(--fg); }
  .wallet p.err { margin: 6px 6px 0 0; font-size: 14px; }
  @media (max-width: 719px) {
    .wallet.idle { flex-flow: row wrap; align-items: center; padding-block: 6px; }
    .wallet.idle .head { flex: 1; }
    .wallet.idle .ways { padding: 0; }
    .wallet.idle .ways button { min-height: 44px; padding: 0 20px; }
    .wallet.idle p.err { flex-basis: 100%; margin-bottom: 6px; }
  }
</style>
