<script lang="ts">
  // One place to connect each kind of wallet; every page uses these connections. One card per chain: two by two on
  // wider screens, stacked on phones, where connected wallets fold into a single summary bar.
  import { onMount, tick, untrack } from 'svelte'
  import { useWallet } from '@txnlab/use-wallet-svelte'
  import { discoverEvmWallets, type EvmWallet } from './lib/evm.ts'
  import { conn, connectEvmWallet, connectNearWallet, connectSolanaWallet, disconnectWallet, restoreWallets } from './lib/wallets.svelte.ts'
  import { errorText } from './lib/format.ts'
  import { WALLETCONNECT_PROJECT_ID } from './lib/config.ts'
  import { qrSvg } from './lib/qr.ts'
  import WalletCard from './WalletCard.svelte'
  import WalletSummary from './WalletSummary.svelte'

  type Kind = 'algo' | 'evm' | 'sol' | 'near'
  type Pairing = { uri: string; qr: string }

  const algo = useWallet()
  let evmWallets = $state<EvmWallet[]>([])
  let solWallets = $state<any[]>([])
  let pending = $state<Partial<Record<Kind, boolean>>>({}) // waiting for a wallet to approve
  let pairing = $state<Partial<Record<'evm' | 'sol', Pairing>>>({})
  let errors = $state<Partial<Record<Kind, string>>>({})
  // Each attempt gets a number; Cancel moves it on, so a late answer from an abandoned attempt is ignored.
  const attempts: Record<Kind, number> = { algo: 0, evm: 0, sol: 0, near: 0 }

  const EXPANDED = 'wallets.expanded'
  let expanded = $state(recallExpanded())

  onMount(async () => {
    restoreWallets().catch(() => {})
    evmWallets = await discoverEvmWallets()
    solWallets = (await import('./lib/solana-wallets.ts')).solanaWallets()
  })

  function recallExpanded() {
    try {
      return localStorage.getItem(EXPANDED) === '1'
    } catch {
      return false
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(EXPANDED, expanded ? '1' : '0')
    } catch {
      // storage blocked: the bar starts folded next time
    }
  })

  async function attempt(kind: Kind, f: (live: () => boolean) => Promise<void>) {
    const n = ++attempts[kind]
    const live = () => n === attempts[kind]
    errors[kind] = undefined
    pending[kind] = true
    try {
      await f(live)
    } catch (e) {
      if (live()) errors[kind] = errorText(e)
    } finally {
      if (live()) cancel(kind)
    }
  }

  function cancel(kind: Kind) {
    attempts[kind]++
    pending[kind] = false
    if (kind === 'evm' || kind === 'sol') pairing[kind] = undefined
  }

  // Shows a QR code (and a link for wallets on this device), then connects once the mobile wallet approves.
  const walletConnect = (kind: 'evm' | 'sol') =>
    attempt(kind, async (live) => {
      const wc = await import('./lib/walletconnect.ts')
      const { uri, session } = await wc.pair(kind === 'evm' ? 'evm' : 'solana')
      const qr = await qrSvg(uri)
      if (!live()) return
      pairing[kind] = { uri, qr }
      const s = await session
      if (!live()) return wc.disconnectSession(s.topic) // approved after Cancel
      pairing[kind] = undefined
      if (kind === 'evm') await connectEvmWallet(wc.evmWalletFromSession(s))
      else await connectSolanaWallet(wc.solanaWalletFromSession(s))
    })

  // Offered only when the build has a WalletConnect project id (see .env.example).
  const walletConnectOption = (kind: 'evm' | 'sol') =>
    WALLETCONNECT_PROJECT_ID ? [{ name: 'WalletConnect', connect: () => walletConnect(kind) }] : []

  const algoOptions = $derived(
    algo.wallets.map((w) => ({
      name: w.metadata.name,
      connect: () => attempt('algo', async () => {
        await w.connect()
      }),
    })),
  )
  const evmOptions = $derived([
    ...evmWallets.map((w) => ({ name: w.name, connect: () => attempt('evm', () => connectEvmWallet(w)) })),
    ...walletConnectOption('evm'),
  ])
  const solOptions = $derived([
    ...solWallets.map((w) => ({ name: w.name as string, connect: () => attempt('sol', () => connectSolanaWallet(w)) })),
    ...walletConnectOption('sol'),
  ])

  // Meteor: its extension if installed, otherwise its web wallet in a popup, which must open from this click. HOT: its
  // extension if installed, otherwise the HOT app on a phone or in Telegram, through a QR code.
  const nearOptions = [
    {
      name: 'Meteor',
      connect: () =>
        attempt('near', async (live) => {
          const nw = await nearWallets
          const w = await nw.connectMeteor()
          if (live()) connectNearWallet(w)
        }),
    },
    {
      name: 'HOT',
      connect: () =>
        attempt('near', async (live) => {
          const nw = await nearWallets
          const w = await nw.connectHot()
          if (live()) connectNearWallet(w)
        }),
    },
  ]
  // Loaded ahead of a click, so the Meteor popup can open within it.
  const nearWallets = import('./lib/near-wallets.ts')

  const algoAddress = $derived(algo.activeAddress.current)
  const restoring = $derived({ algo: !algo.isReady(), evm: !!conn.restoring.evm, sol: !!conn.restoring.sol, near: !!conn.restoring.near })
  const connected = $derived({ algo: !!algoAddress, evm: !!conn.evm, sol: !!conn.sol, near: !!conn.near })
  const count = $derived(Object.values(connected).filter(Boolean).length)

  const status = (kind: Kind) => (connected[kind] ? 'connected' : restoring[kind] || pending[kind] ? 'connecting' : 'disconnected')
  const statusText = (kind: Kind) => (!connected[kind] && restoring[kind] ? 'Reconnecting...' : undefined)

  // Fold on phones once two or more wallets are connected (or being restored) and nothing else is in progress.
  const foldable = $derived(
    (['algo', 'evm', 'sol', 'near'] as Kind[]).filter((k) => connected[k] || restoring[k]).length >= 2 &&
      !pending.algo && !pending.evm && !pending.sol && !pending.near,
  )
  const chips = $derived([connected.algo && 'ALGO', connected.evm && 'EVM', connected.sol && 'SOL', connected.near && 'NEAR'].filter((c) => c !== false))

  // A page's Connect button (requestConnect): unfold the bar, scroll to the card and open its list of wallets. When
  // that wallet connects, scroll back to the page links, where the page now continues.
  let cards = $state<Partial<Record<Kind, WalletCard>>>({})
  let returnTo = $state<Kind | undefined>()
  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
  $effect(() => {
    const r = conn.request
    if (!r) return
    untrack(async () => {
      expanded = true
      await tick()
      document.getElementById(r.kind ? `wallet-${r.kind}` : 'wallet-cards')?.scrollIntoView({ block: 'center', behavior: smooth() })
      returnTo = r.kind && !connected[r.kind] ? r.kind : undefined
      if (returnTo) cards[returnTo]?.choose()
    })
  })
  $effect(() => {
    if (!returnTo || !connected[returnTo]) return
    returnTo = undefined
    const nav = document.querySelector('main > nav')
    if (nav) scrollTo({ top: nav.getBoundingClientRect().top + scrollY, behavior: smooth() })
  })
</script>

<section class="wallets" aria-label="Wallets">
  <div class="head" class:foldable>
    <h2>Wallets</h2>
    <span class="muted">{count} of 4 connected</span>
  </div>
  {#if foldable}<WalletSummary {chips} controls="wallet-cards" bind:expanded />{/if}

  <div class="cards" id="wallet-cards" class:folded={foldable && !expanded}>
    <WalletCard
      bind:this={cards.algo}
      anchor="wallet-algo"
      chain="Algorand"
      status={status('algo')}
      statusText={statusText('algo')}
      address={algoAddress}
      walletName={algo.activeWallet()?.metadata.name}
      explorer={algoAddress && `https://allo.info/account/${algoAddress}`}
      error={errors.algo}
      options={restoring.algo ? [] : algoOptions}
      ondisconnect={() => algo.activeWallet()?.disconnect()}
    />
    <WalletCard
      bind:this={cards.evm}
      anchor="wallet-evm"
      chain="EVM"
      status={status('evm')}
      statusText={statusText('evm')}
      address={conn.evm?.address}
      walletName={conn.evm?.wallet.name}
      error={errors.evm}
      options={restoring.evm ? [] : evmOptions}
      pairing={pairing.evm}
      accountHint="an EVM account"
      ondisconnect={() => disconnectWallet('evm')}
      oncancel={() => cancel('evm')}
    />
    <WalletCard
      bind:this={cards.sol}
      anchor="wallet-sol"
      chain="Solana"
      status={status('sol')}
      statusText={statusText('sol')}
      address={conn.sol?.address}
      walletName={conn.sol?.wallet.name}
      explorer={conn.sol && `https://solscan.io/account/${conn.sol.address}`}
      error={errors.sol}
      options={restoring.sol ? [] : solOptions}
      pairing={pairing.sol}
      accountHint="a Solana account"
      ondisconnect={() => disconnectWallet('sol')}
      oncancel={() => cancel('sol')}
    />
    <WalletCard
      bind:this={cards.near}
      anchor="wallet-near"
      chain="NEAR"
      status={status('near')}
      statusText={statusText('near')}
      address={conn.near?.address}
      walletName={conn.near?.wallet.name}
      explorer={conn.near && `https://nearblocks.io/address/${conn.near.address}`}
      error={errors.near}
      options={restoring.near ? [] : nearOptions}
      ondisconnect={() => disconnectWallet('near')}
      oncancel={() => cancel('near')}
    />
  </div>
</section>

<style>
  .wallets { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  h2 { margin: 0; font: 500 13px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .head span { font-size: 13px; }
  .cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
  @media (max-width: 719px) {
    .head.foldable, .cards.folded { display: none; }
  }
  @media (min-width: 720px) {
    .wallets { gap: 14px; }
    .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  }
</style>
