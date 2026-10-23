<script lang="ts">
  import type algosdk from 'algosdk'
  import { untrack } from 'svelte'
  import { useWallet } from '@txnlab/use-wallet-svelte'
  import { listWrappedAssets, buildTransfer, describeTransfer, simulateUnsigned, simulateSigned, submit, type WrappedAsset } from './lib/algorand.ts'
  import { chainById, chainName, fetchAlgorandVaa, sequenceFromAlgorandTxn, hex } from './lib/wormhole.ts'
  import { evmAddressTo32 } from './lib/evm.ts'
  import { formatUnits, parseUnits, errorText } from './lib/format.ts'
  import { conn } from './lib/wallets.svelte.ts'
  import { ask } from './lib/confirm.svelte.ts'
  import RedeemStatus, { type GuardianWait } from './RedeemStatus.svelte'
  import ConnectPrompt from './ConnectPrompt.svelte'
  import Log, { type LogLine } from './Log.svelte'

  const { activeAddress, activeWallet, signTransactions } = useWallet()

  let assets = $state<WrappedAsset[] | undefined>()
  let selected = $state<WrappedAsset | undefined>()
  let amount = $state('')
  let recipient = $state('')
  let group = $state<algosdk.Transaction[] | undefined>()
  let review = $state<ReturnType<typeof describeTransfer> & { recipientNote?: string } | undefined>()
  let simulation = $state<string | undefined>()
  let log = $state<LogLine[]>([])
  let busy = $state(false)
  let wait = $state<GuardianWait | undefined>()

  const dest = $derived(selected ? chainById(selected.originChain) : undefined)
  // The connected EVM or Solana wallet (wallet bar) is the natural recipient on that platform.
  const defaultRecipient = (a: WrappedAsset) => {
    const p = chainById(a.originChain)?.platform
    return (p === 'evm' ? conn.evm?.address : p === 'solana' ? conn.sol?.address : undefined) ?? ''
  }
  const say = (text: string, cls?: string) => (log = [...log, { text, cls }])
  const reset = () => {
    group = review = simulation = wait = undefined
    log = []
  }

  // Reload assets whenever the connected account changes (tracks only the address).
  $effect(() => {
    const addr = activeAddress.current
    untrack(() => {
      assets = selected = undefined
      reset()
      if (addr) listWrappedAssets(addr).then((a) => (assets = a)).catch((e) => say(errorText(e), 'err'))
    })
  })

  async function recipientBytes(): Promise<{ to: Uint8Array; note?: string }> {
    if (!dest || !selected) throw new Error('choose an asset')
    if (dest.platform === 'evm') return { to: evmAddressTo32(recipient.trim()) }
    // Solana pays into the recipient's associated token account for the token's mint, not the wallet itself.
    const sol = await import('./lib/solana.ts')
    const { PublicKey } = await import('./lib/solana-tx.ts')
    const owner = new PublicKey(recipient.trim())
    const mint = new PublicKey(selected.originAddress)
    const ata = sol.associatedTokenAddress(owner, mint)
    return { to: ata.toBytes(), note: `token account ${ata.toBase58()} of wallet ${owner.toBase58()}` }
  }

  async function prepare() {
    reset()
    busy = true
    try {
      if (!selected || !activeAddress.current) throw new Error('connect a wallet and choose an asset')
      if (!dest) throw new Error(`origin chain ${chainName(selected.originChain)} is not supported here`)
      const amt = parseUnits(amount, selected.decimals)
      const { to, note } = await recipientBytes()
      group = await buildTransfer({ sender: activeAddress.current, asset: selected, amount: amt, toChain: dest.id, to })
      review = { ...describeTransfer(group), recipientNote: note }
      if (hex(review.to) !== hex(to) || review.toChain !== dest.id || review.amount !== amt) throw new Error('decoded group does not match the request')
      simulation = (await simulateUnsigned(group)) ?? 'ok'
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  async function signAndSend() {
    if (!group || !review) return
    busy = true
    try {
      say(`Asking ${activeWallet()?.metadata.name ?? 'wallet'} to sign ${group.length} transactions...`)
      const signed = (await signTransactions(group)).filter((s): s is Uint8Array => !!s)
      if (signed.length !== group.length) throw new Error('wallet did not sign every transaction')
      const failure = await simulateSigned(signed)
      if (failure) throw new Error(`signed group fails simulation: ${failure}`)
      say('Signed group simulates OK.', 'ok')
      const yes = await ask({
        title: `Bridge ${formatUnits(review.amount, selected!.decimals)} ${selected!.unitName} to ${review.toChainName}?`,
        rows: [['Recipient', dest?.platform === 'evm' ? '0x' + review.toHex.slice(24) : review.recipientNote ?? '']],
        note: 'This cannot be undone.',
        ok: 'Bridge',
      })
      if (!yes) return say('Cancelled.')
      const info = await submit(signed, review.sendTransferTxid)
      const sequence = sequenceFromAlgorandTxn(info)
      say(`Confirmed in round ${info.confirmedRound}. Transaction ${review.sendTransferTxid}, Wormhole sequence ${sequence}.`, 'ok')
      const w: GuardianWait = { state: 'waiting', since: Date.now(), expected: 'This usually takes a minute or two.', dest: review.toChainName, link: `/redeem/?tx=${review.sendTransferTxid}`, id: review.sendTransferTxid }
      wait = w
      for (let i = 0; i < 60; i++) {
        if (await fetchAlgorandVaa(sequence)) return void (wait = { ...w, state: 'ready' })
        await new Promise((r) => setTimeout(r, 10000))
      }
      wait = { ...w, state: 'timeout' }
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }
</script>

{#if !activeAddress.current}
  <ConnectPrompt kind="algo" text="Connect an Algorand wallet to see the Wormhole-wrapped assets it holds." />
{/if}

{#if activeAddress.current}
  <h2>1. Wormhole-wrapped asset</h2>
  <p class="muted">
    This page lists the Wormhole-wrapped assets in your account and sends each one back to its origin chain. It cannot
    send native Algorand assets, such as ALGO or USDC, to other chains.
  </p>
  {#if !assets}
    <p class="muted">Loading assets...</p>
  {:else if !assets.length}
    <p class="muted">This account holds no Wormhole-wrapped assets.</p>
  {:else}
    <div class="options">
      {#each assets as a (a.assetId)}
        <label>
          <input type="radio" name="asset" checked={selected === a} onchange={() => { selected = a; amount = ''; recipient = defaultRecipient(a); reset() }} />
          <span class="grow"><b>{a.unitName}</b> <span class="muted">ASA {a.assetId}, from {chainName(a.originChain)}</span></span>
          <span class="num">{formatUnits(a.amount, a.decimals)}</span>
        </label>
      {/each}
    </div>
  {/if}
{/if}

{#if selected}
  <h2>2. Destination and amount</h2>
  {#if !dest}
    <p class="err">This asset comes from {chainName(selected.originChain)}, which this tool does not support yet.</p>
  {:else}
    <p>The asset returns to its origin chain, <b>{dest.name}</b>.</p>
    <label for="amount">Amount ({selected.unitName})</label>
    <div class="row">
      <input id="amount" bind:value={amount} oninput={reset} placeholder="0.0" />
      <button onclick={() => { amount = formatUnits(selected!.amount, selected!.decimals); reset() }}>Max</button>
    </div>
    <label for="recipient">{dest.platform === 'evm' ? `${dest.name} address (0x...)` : 'Solana wallet address'}</label>
    <input id="recipient" bind:value={recipient} oninput={reset} placeholder={dest.platform === 'evm' ? '0x...' : 'base58 wallet address'} />
    <p class="warn">Send a small test amount first. Bridged funds cannot be recalled.</p>
    <button class="primary" disabled={busy || !amount || !recipient} onclick={prepare}>Review</button>
  {/if}
{/if}

{#if review && selected}
  <h2>3. Review</h2>
  <div class="box">
    <p class="muted">Decoded from the transactions you are about to sign:</p>
    <table class="kv">
      <tbody>
        <tr><th>Send</th><td>{formatUnits(review.amount, selected.decimals)} {selected.unitName} (asset {review.assetId})</td></tr>
        <tr><th>To chain</th><td>{review.toChainName} (Wormhole chain {review.toChain})</td></tr>
        <tr><th>Recipient</th><td class="mono">{dest?.platform === 'evm' ? '0x' + review.toHex.slice(24) : review.recipientNote}</td></tr>
        <tr><th>Relayer fee</th><td>{review.relayerFee === 0n ? 'None. You redeem on the destination chain yourself.' : review.relayerFee}</td></tr>
        <tr><th>Simulation</th><td class={simulation === 'ok' ? 'ok' : 'err'}>{simulation === 'ok' ? 'passes' : simulation}</td></tr>
        <tr><th>Valid until</th><td>round {review.lastValid}</td></tr>
      </tbody>
    </table>
  </div>
  <button class="primary" disabled={busy || simulation !== 'ok'} onclick={signAndSend}>Sign and send</button>
{/if}

<Log lines={log} />

{#if wait}<RedeemStatus {wait} />{/if}
