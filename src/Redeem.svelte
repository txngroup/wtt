<script lang="ts">
  import algosdk from 'algosdk'
  import { onMount } from 'svelte'
  import { useWallet } from '@txnlab/use-wallet-svelte'
  import { chainById, chainName, explorerTxUrl, fetchAlgorandVaa, fetchOperation, fetchOperationById, fetchVaa, parseVaa, sequenceFromAlgorandTxn, b64ToBytes, fromHex, hex, ALGORAND, type Operation, type Vaa } from './lib/wormhole.ts'
  import { redeemedOnChain } from './lib/activity.ts'
  import ConnectPrompt from './ConnectPrompt.svelte'
  import { algod, simulateSigned } from './lib/algorand.ts'
  import { buildAlgorandRedeem, simulateRedeem, assembleSigned, isRedeemedOnAlgorand } from './lib/algorand-redeem.ts'
  import { conn as wallets } from './lib/wallets.svelte.ts'
  import { ensureEvmChain, isRedeemedOnEvm, redeemCalldata, simulateEvmRedeem, sendEvmRedeem, waitForEvmReceipt } from './lib/evm.ts'
  import { formatUnits, errorText, short, base58 } from './lib/format.ts'
  import Log, { type LogLine } from './Log.svelte'

  let { initialTx = '' }: { initialTx?: string } = $props()
  // Only the first value is wanted: App re-creates this component when the transfer in the address changes.
  // svelte-ignore state_referenced_locally
  let input = $state(initialTx)
  const { activeAddress, signTransactions } = useWallet()
  let vaa = $state<Vaa | undefined>()
  let op = $state<Operation | undefined>() // what Wormholescan knows: symbol, amount, status, redeem transaction
  let redeemed = $state<boolean | undefined>() // from the destination chain; undefined if it could not be checked
  let log = $state<LogLine[]>([])
  let busy = $state(false)

  const t = $derived(vaa?.transfer)
  let nearRecipient = $state<string | undefined>() // the NEAR account behind the recipient hash, if registered
  // Display a 32-byte address in the native format of the chain it belongs to.
  const addr = (chain: number, b: Uint8Array) =>
    chain === ALGORAND.chainId ? (t?.tokenAddress === b ? `asset ${algosdk.bytesToBigInt(b)}` : algosdk.encodeAddress(b))
    : chainById(chain)?.platform === 'evm' ? '0x' + hex(b).slice(24)
    : chainById(chain)?.platform === 'solana' ? base58(b)
    : chainById(chain)?.platform === 'near' && t?.to === b ? (nearRecipient ?? `an unregistered account (sha256 ${short(hex(b), 6)})`)
    : chainById(chain)?.platform === 'near' && b.every((x) => x === 0) ? 'NEAR (native)'
    : hex(b)
  const dest = $derived(t ? chainById(t.toChain) : undefined)
  const toAlgorand = $derived(t?.toChain === ALGORAND.chainId)
  const redeemTx = $derived(t && op?.targetTx ? explorerTxUrl(t.toChain, op.targetTx) : undefined)
  const say = (text: string, cls?: string, href?: string) => (log = [...log, { text, cls, href }])
  const indexer = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '')

  // Accepts a source transaction (Algorand id, EVM hash, Solana signature), a Wormholescan id chain/emitter/sequence,
  // or a raw VAA as hex or base64.
  async function lookup() {
    vaa = op = redeemed = nearRecipient = undefined
    log = []
    busy = true
    try {
      const v = input.trim()
      let bytes: Uint8Array | undefined
      let found: Operation | undefined
      const id = v.match(/^(\d+)\/([0-9a-fA-F]{64})\/(\d+)$/)
      const raw = /^(0x)?01[0-9a-fA-F]{200,}$/.test(v) || /^AQ[A-Za-z0-9+/=]{150,}$/.test(v)
      if (/^(0x)?01[0-9a-fA-F]{200,}$/.test(v)) bytes = fromHex(v)
      else if (/^AQ[A-Za-z0-9+/=]{150,}$/.test(v)) bytes = b64ToBytes(v)
      else if (id) {
        bytes = await fetchVaa(Number(id[1]), id[2].toLowerCase(), BigInt(id[3]))
        if (!bytes) throw new Error('not signed by the guardians yet; try again in a few minutes')
      } else {
        found = await fetchOperation(v).catch(() => undefined)
        bytes = found?.vaa
        if (!bytes) {
          const { transaction } = await indexer.lookupTransactionByID(v).do()
          const seq = sequenceFromAlgorandTxn(transaction)
          bytes = await fetchAlgorandVaa(seq)
          if (!bytes) throw new Error(`Wormhole sequence ${seq} is not signed by the guardians yet; try again in a few minutes`)
        }
      }
      const parsed = parseVaa(bytes)
      if (!parsed.transfer) throw new Error('this VAA is not a token transfer')
      if (parsed.emitterChain === ALGORAND.chainId && hex(parsed.emitterAddress) !== ALGORAND.tokenBridgeEmitter) throw new Error('not from the Algorand token bridge')
      const opId = `${parsed.emitterChain}/${hex(parsed.emitterAddress)}/${parsed.sequence}`
      found ??= await fetchOperationById(opId).catch(() => undefined)
      ;[vaa, op] = [parsed, found]
      // A link or a reload brings the same transfer back. A pasted VAA that Wormholescan does not know stays as typed.
      if (!raw || found) history.replaceState(null, '', `/redeem/?vaa=${opId}`)
      const toNear = chainById(parsed.transfer.toChain)?.platform === 'near'
      ;[nearRecipient, redeemed] = await Promise.all([
        toNear ? import('./lib/near.ts').then((near) => near.accountForHash(parsed.transfer!.to)).catch(() => undefined) : undefined,
        redeemedOnChain(parsed).catch(() => undefined),
      ])
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  async function redeemEvm() {
    if (!vaa || !dest || !wallets.evm) return
    busy = true
    try {
      const { wallet: w, address: from } = wallets.evm
      await ensureEvmChain(w, dest)
      if (await isRedeemedOnEvm(w, dest, vaa)) return void (redeemed = true)
      const { data, unwrap } = await redeemCalldata(w, dest, vaa)
      const failure = await simulateEvmRedeem(w, dest, from, data)
      if (failure) throw new Error(`redeem would fail: ${failure}`)
      say(`Simulation OK (${unwrap ? `pays native ${dest.nativeSymbol}` : 'pays the token'}). Confirm in your wallet.`, 'ok')
      const txHash = await sendEvmRedeem(w, dest, from, data)
      say(`Sent ${short(txHash, 10)}; waiting for confirmation...`, '', dest.explorerTx + txHash)
      await waitForEvmReceipt(w, txHash)
      say('Redeemed.', 'ok', dest.explorerTx + txHash)
      redeemed = true
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  async function redeemSolana() {
    if (!vaa || !wallets.sol) return
    busy = true
    try {
      const { Connection, PublicKey } = await import('./lib/solana-tx.ts')
      const sol = await import('./lib/solana.ts')
      const sw = await import('./lib/solana-wallets.ts')
      const conn = new Connection(sol.SOLANA_RPC, 'confirmed')
      const { wallet: w, account } = wallets.sol
      const owner = new PublicKey(account.address)
      if (await sol.isRedeemedOnSolana(conn, vaa)) return void (redeemed = true)
      const plan = await sol.planRedeem(conn, owner, vaa)
      const txs = [...plan.verify.map((v) => v.tx), ...(plan.post ? [plan.post] : []), plan.complete]
      // Later transactions depend on earlier ones being on chain, so only the first can be simulated up front.
      const first = await conn.simulateTransaction(txs[0], [owner])
      if (first.value.err) throw new Error(`first transaction fails simulation: ${JSON.stringify(first.value.err)} ${(first.value.logs ?? []).slice(-3).join(' ')}`)
      say('First transaction simulates OK.', 'ok')
      say(`Approve ${txs.length} transactions in ${w.name}: ${plan.verify.length} to verify guardian signatures, ${plan.post ? '1 to post the VAA, ' : ''}1 to redeem${plan.unwrapsSol ? ' and unwrap to SOL' : ''}.`)
      // A WalletConnect wallet without solana_signAllTransactions asks for each one separately.
      if (w.oneAtATime) say(`${w.name} shows a separate prompt for each of the ${txs.length}. Nothing is sent until all are approved.`)
      const signed = await sw.signSolanaTransactions(w, account, txs)
      for (let i = 0; i < signed.length; i++) {
        const sig = await sw.sendAndConfirm(conn, signed[i])
        say(`${i + 1}/${signed.length} confirmed`, '', `https://solscan.io/tx/${sig}`)
      }
      say(plan.unwrapsSol ? 'Redeemed and unwrapped to native SOL.' : `Redeemed into ${plan.recipientAta.toBase58()}.`, 'ok')
      redeemed = true
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  // The bridge pays out to registered NEAR accounts only. The recipient registers on its own redeem, so an unregistered
  // recipient has to redeem from its own account.
  async function redeemNear() {
    if (!vaa || !wallets.near) return
    busy = true
    try {
      const near = await import('./lib/near.ts')
      const w = wallets.near.wallet
      const plan = await near.planNearRedeem(w.accountId, vaa)
      if (plan.executed) return void (redeemed = true)
      const attached = plan.txs.reduce((n, tx) => n + tx.actions.reduce((m, a) => m + a.deposit, 0n), 0n)
      say(`Approve ${plan.txs.length} transactions in ${w.name}: ${plan.txs.map((tx) => tx.label.toLowerCase()).join(', ')}. They attach ${formatUnits(attached, 24)} NEAR, and the bridge returns all but a little storage.`)
      const sent = await w.signAndSend(plan.txs)
      for (const [i, tx] of sent.entries()) {
        await near.waitForNearTx(tx.hash, tx.signer)
        say(`${i + 1}/${sent.length} confirmed`, '', `https://nearblocks.io/txns/${tx.hash}`)
      }
      redeemed = await near.isRedeemedOnNear(vaa)
      if (redeemed) say(`Redeemed to ${plan.receiver}${plan.native ? ' (native NEAR)' : ` (${plan.token})`}.`, 'ok')
      else say('The transactions went through, but the bridge does not show the transfer as complete. Look it up again, and redeem again if it is still open.', 'err')
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  async function redeemAlgorand() {
    if (!vaa) return
    busy = true
    try {
      const sender = activeAddress.current
      if (!sender) throw new Error('connect an Algorand wallet')
      if (await isRedeemedOnAlgorand(vaa)) return void (redeemed = true)
      const r = await buildAlgorandRedeem(sender, vaa)
      const failure = await simulateRedeem(r)
      if (failure) throw new Error(`redeem would fail: ${failure}`)
      say(`Simulation OK: ${r.txns.length} transactions (${r.lsigs.size} signed by bridge logic signatures${r.needsOptIn ? `, one opting you in to ASA ${r.assetId}` : ''}). Approve ${r.userIndexes.length} in your wallet.`, 'ok')
      const walletSigned = await signTransactions(r.txns, r.userIndexes)
      const signed = assembleSigned(r, walletSigned)
      const signedFailure = await simulateSigned(signed)
      if (signedFailure) throw new Error(`signed group fails simulation: ${signedFailure}`)
      await algod.sendRawTransaction(signed).do()
      const last = r.txns[r.txns.length - 1].txID()
      await algosdk.waitForConfirmation(algod, last, 10)
      say(`Redeemed to ${r.receiver}${r.assetId === 0n ? ' (ALGO)' : ` (ASA ${r.assetId})`}.`, 'ok', `https://allo.info/tx/${last}`)
      redeemed = true
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  onMount(() => {
    if (initialTx) lookup()
  })
</script>

<h2>Find the transfer</h2>
<label for="tx">Source transaction (Algorand transaction ID, EVM transaction hash, Solana signature or NEAR transaction hash), Wormholescan ID (chain/emitter/sequence), or a signed VAA in hex or base64</label>
<div class="row">
  <input id="tx" bind:value={input} onkeydown={(e) => e.key === 'Enter' && !busy && input.trim() && lookup()} />
  <button class="primary" disabled={busy || !input.trim()} onclick={lookup}>{busy && !vaa ? 'Looking up...' : 'Look up'}</button>
</div>

{#if vaa && t}
  <div class="box">
    <table class="kv">
      <tbody>
        <tr><th>From</th><td>{chainName(vaa.emitterChain)}, sequence {vaa.sequence}</td></tr>
        <tr><th>Token</th><td>{#if op?.symbol}<b>{op.symbol}</b>{', from '}{/if}{chainName(t.tokenChain)} <span class="mono">{addr(t.tokenChain, t.tokenAddress)}</span></td></tr>
        {#if op?.amount}
          <tr><th>Amount</th><td>{op.amount} {op.symbol ?? ''}</td></tr>
        {:else}
          <tr><th>Amount</th><td>{formatUnits(t.amount, 8)} <span class="muted">(Wormhole records amounts with at most 8 decimals; for a token with fewer decimals, read this as {t.amount} base units)</span></td></tr>
        {/if}
        <tr><th>To</th><td>{chainName(t.toChain)} <span class="mono">{addr(t.toChain, t.to)}</span></td></tr>
        <tr><th>Status</th><td>
          {#if redeemed}<span class="ok">Redeemed</span>{#if redeemTx}{' '}<a href={redeemTx} target="_blank" rel="noreferrer">view</a>{/if}
          {:else if redeemed === false}Signed, not redeemed yet
          {:else}{op?.targetStatus ?? 'unknown (checked on-chain when you redeem)'}{/if}
        </td></tr>
      </tbody>
    </table>
  </div>

  {#if redeemed}
    <p class="ok">This transfer has been redeemed on {chainName(t.toChain)}. There is nothing left to do.</p>
  {:else if toAlgorand}
    <h2>Redeem on Algorand</h2>
    <p class="muted">Any Algorand account can pay for the redeem, and the funds always go to the recipient in the transfer. If the recipient has not opted in to the asset yet, redeem from the recipient account, and the site adds the opt-in to the redeem.</p>
    {#if activeAddress.current}
      <div class="row"><button class="primary" disabled={busy} onclick={redeemAlgorand}>Redeem with {short(activeAddress.current, 6)}</button></div>
    {:else}
      <ConnectPrompt kind="algo" text="Connect an Algorand wallet to pay for the redeem." />
    {/if}
  {:else if !dest}
    <p class="err">Redeeming on {chainName(t.toChain)} is not supported here yet.</p>
  {:else if dest.platform === 'evm'}
    <h2>Redeem on {dest.name}</h2>
    <p class="muted">Any account can submit the redeem, and the funds always go to the recipient in the transfer. The connected wallet pays the gas.</p>
    {#if wallets.evm}
      <div class="row"><button class="primary" disabled={busy} onclick={redeemEvm}>Redeem with {wallets.evm.wallet.name}</button></div>
    {:else}
      <ConnectPrompt kind="evm" text="Connect an EVM wallet to pay for the redeem on {dest.name}." />
    {/if}
  {:else if dest.platform === 'near'}
    <h2>Redeem on NEAR</h2>
    <p class="muted">Any NEAR account can submit the redeem for a recipient the bridge already knows. An account it has not seen yet
      registers on its own redeem, so connect the recipient account. The redeem attaches about 0.2 NEAR, which the bridge returns
      apart from a little storage.</p>
    {#if !nearRecipient}
      <p class="warn">The recipient is not registered with the bridge yet, so only the recipient account can redeem this transfer. It registers as part of the redeem.</p>
    {/if}
    {#if wallets.near}
      <div class="row"><button class="primary" disabled={busy} onclick={redeemNear}>Redeem with {wallets.near.address}</button></div>
    {:else}
      <ConnectPrompt kind="near" text="Connect a NEAR wallet to redeem on NEAR." />
    {/if}
  {:else}
    <h2>Redeem on Solana</h2>
    <p class="muted">Connect the wallet that owns the recipient token account. It pays about 0.0035 SOL in fees and account rent, plus
      about 0.002 SOL if the token account has to be created. A SOL redeem gets that 0.002 SOL back when it unwraps.</p>
    {#if wallets.sol}
      <div class="row"><button class="primary" disabled={busy} onclick={redeemSolana}>Redeem with {wallets.sol.wallet.name}</button></div>
    {:else}
      <ConnectPrompt kind="sol" text="Connect the Solana wallet that owns the recipient token account." />
    {/if}
  {/if}
{/if}

<Log lines={log} />
