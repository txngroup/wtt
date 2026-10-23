<script lang="ts">
  // Recent transfers for the connected wallets (and any address typed in), with a way to finish unredeemed ones.
  import { untrack } from 'svelte'
  import { useWallet } from '@txnlab/use-wallet-svelte'
  import { fetchTransfers, type Transfer } from './lib/activity.ts'
  import { chainName, explorerTxUrl } from './lib/wormhole.ts'
  import { conn } from './lib/wallets.svelte.ts'
  import { errorText, short } from './lib/format.ts'
  import ConnectPrompt from './ConnectPrompt.svelte'

  const { activeAddress } = useWallet()

  let extra = $state('')
  let looked = $state<string[]>([]) // addresses typed in this visit
  let transfers = $state<Transfer[] | undefined>()
  let truncated = $state(false)
  let error = $state<string | undefined>()
  let busy = $state(false)

  const addresses = $derived(
    [activeAddress.current, conn.evm?.address, conn.sol?.address, conn.near?.address, ...looked].filter((a): a is string => !!a),
  )

  async function load(list: string[]) {
    error = undefined
    if (!list.length) return (transfers = undefined)
    busy = true
    try {
      ;({ transfers, truncated } = await fetchTransfers(list))
    } catch (e) {
      error = errorText(e)
    } finally {
      busy = false
    }
  }

  // Reload when a wallet connects or disconnects, or an address is added.
  $effect(() => {
    const list = addresses
    untrack(() => load(list))
  })

  const removeAddress = (a: string) => (looked = looked.filter((x) => x !== a))

  function addAddress() {
    const a = extra.trim()
    if (a && !looked.includes(a)) looked = [...looked, a]
    extra = ''
  }

  const when = (iso: string) =>
    iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const unfinished = $derived(transfers?.filter((t) => t.status === 'ready').length ?? 0)
</script>

<h2>Activity</h2>
<p class="muted">
  Token Bridge transfers to and from Algorand for your connected wallets, newest first, from Wormholescan. Anything
  not yet redeemed is checked on its destination chain. Use Continue to finish a transfer you left part way.
</p>

<label for="extra">Look up another address (Algorand, EVM, Solana or a NEAR account)</label>
<div class="row">
  <input id="extra" bind:value={extra} placeholder="Address" onkeydown={(e) => e.key === 'Enter' && addAddress()} />
  <button disabled={!extra.trim()} onclick={addAddress}>Add</button>
</div>

{#if addresses.length}
  <div class="row actions">
    <span class="muted">Showing</span>
    <!-- Connected wallets leave the list when they disconnect; added addresses have their own remove button. -->
    {#each [...new Set(addresses)] as a (a)}
      <span class="address mono" title={a}>
        {short(a, 6)}
        {#if looked.includes(a)}
          <button class="remove" aria-label="Stop showing {short(a, 6)}" onclick={() => removeAddress(a)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        {/if}
      </span>
    {/each}
    <button class="small" disabled={busy} onclick={() => load(addresses)}>{busy ? 'Loading...' : 'Refresh'}</button>
  </div>
{:else}
  <ConnectPrompt text="Connect a wallet, or add an address above, to see its transfers." />
{/if}

{#if busy && !transfers}<p class="muted" aria-live="polite">Loading transfers from Wormholescan...</p>{/if}

{#if error}<p class="err">{error}</p>{/if}

{#if transfers}
  {#if !transfers.length}
    <p class="muted">No Token Bridge transfers to or from Algorand for these addresses.</p>
  {:else}
    {#if unfinished}
      <p class="warn">{unfinished === 1 ? 'One transfer is' : `${unfinished} transfers are`} signed but not redeemed yet.</p>
    {/if}
    <div class="transfers">
      {#each transfers as t (t.id)}
        {@const source = explorerTxUrl(t.fromChain, t.sourceTx)}
        {@const target = t.targetTx ? explorerTxUrl(t.toChain, t.targetTx) : undefined}
        <div class="transfer">
          <div class="what">
            <b class="num">{t.amount} {t.symbol}</b>
            <span>{chainName(t.fromChain)} to {chainName(t.toChain)}</span>
            <span class="muted">{when(t.time)}</span>
          </div>
          <div class="status">
            {#if t.status === 'ready'}
              <a class="button primary" href={`/redeem/?vaa=${t.id}`}>Continue</a>
            {:else if t.status === 'redeemed'}
              <span class="ok">Redeemed</span>
            {:else if t.status === 'signing'}
              <span class="muted">Waiting for the guardians</span>
            {:else if t.status === 'unchecked'}
              <a class="button" href={`/redeem/?vaa=${t.id}`} title="{chainName(t.toChain)} could not be asked whether this was redeemed">Check</a>
            {:else}
              <span class="muted">{chainName(t.toChain)} is not supported here</span>
            {/if}
          </div>
          <div class="links muted">
            {#if source}<a href={source} target="_blank" rel="noreferrer">source</a>{/if}
            {#if target}<a href={target} target="_blank" rel="noreferrer">redeem</a>{/if}
            <a href={`https://wormholescan.io/#/tx/${t.sourceTx}`} target="_blank" rel="noreferrer">Wormholescan</a>
          </div>
        </div>
      {/each}
    </div>
    {#if truncated}
      <p class="muted">Only the 50 most recent Wormhole operations of each address are checked.</p>
    {/if}
  {/if}
{/if}

<style>
  .transfers { border-top: 1px solid var(--fg); border-bottom: 1px solid var(--fg); margin-top: 16px; }
  .transfer { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; padding: 12px 4px; align-items: center; }
  .transfer + .transfer { border-top: 1px solid var(--line); }
  .what { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .status { justify-self: end; }
  .links { grid-column: 1 / -1; display: flex; gap: 12px; font-size: 13px; }
  .num { font: 600 14px var(--mono); }
  .address { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px 0 6px; border: 1px solid var(--line); }
  .address:not(:has(.remove)) { padding-right: 6px; }
  .remove { display: grid; place-items: center; min-height: 28px; width: 28px; padding: 0; border: 0; color: var(--muted); }
  .remove:hover:not(:disabled) { background: none; color: var(--fg); }
</style>
