<script lang="ts">
  // Unwrap a chain's wrapped gas token back to the native coin: wSOL on Solana, WETH/WAVAX/WBNB/WPOL on EVM chains.
  import { CHAINS, chainById } from './lib/wormhole.ts'
  import { ensureEvmChain, waitForEvmReceipt, wrappedGasToken, withdrawCalldata } from './lib/evm.ts'
  import { conn } from './lib/wallets.svelte.ts'
  import { formatUnits, parseUnits, errorText, short } from './lib/format.ts'
  import { ask } from './lib/confirm.svelte.ts'
  import ConnectPrompt from './ConnectPrompt.svelte'
  import Log, { type LogLine } from './Log.svelte'

  // Chains whose token bridge names a wrapped gas token (Celo has none).
  const UNWRAPPABLE = CHAINS.filter((c) => c.id !== 14)
  let chainId = $state(1)
  let token = $state<{ symbol: string; decimals: number; balance: bigint; address?: string } | undefined>()
  let amount = $state('')
  let log = $state<LogLine[]>([])
  let busy = $state(false)

  const chain = $derived(chainById(chainId)!)
  const wallet = $derived(chain.platform === 'solana' ? conn.sol : conn.evm)
  const say = (text: string, cls?: string, href?: string) => (log = [...log, { text, cls, href }])
  const run = async (f: () => Promise<unknown>) => {
    busy = true
    try {
      await f()
    } catch (e) {
      say(errorText(e), 'err')
    } finally {
      busy = false
    }
  }

  const solConn = async () => {
    const { Connection } = await import('./lib/solana-tx.ts')
    const sol = await import('./lib/solana.ts')
    return { c: new Connection(sol.SOLANA_RPC, 'confirmed'), sol }
  }

  const load = () =>
    run(async () => {
      token = undefined
      log = []
      if (chain.platform === 'solana') {
        if (!conn.sol) throw new Error('connect a Solana wallet in the bar above')
        const { PublicKey } = await import('./lib/solana-tx.ts')
        const { c, sol } = await solConn()
        const balance = (await sol.tokenAccountAmount(c, sol.associatedTokenAddress(new PublicKey(conn.sol.address), sol.NATIVE_MINT))) ?? 0n
        token = { symbol: 'wSOL', decimals: 9, balance }
      } else {
        if (!conn.evm) throw new Error('connect an EVM wallet in the bar above')
        await ensureEvmChain(conn.evm.wallet, chain)
        const t = await wrappedGasToken(conn.evm.wallet, chain, conn.evm.address)
        if (!t) throw new Error(`${chain.name} has no wrapped gas token`)
        token = { symbol: t.symbol, decimals: 18, balance: t.balance, address: t.address }
      }
      amount = ''
    })

  const unwrap = () =>
    run(async () => {
      if (!token) return
      const amt = parseUnits(amount, token.decimals)
      if (amt <= 0n || amt > token.balance) throw new Error('amount must be above zero and at most your balance')
      if (chain.platform === 'solana' && conn.sol) {
        const { PublicKey } = await import('./lib/solana-tx.ts')
        const { c, sol } = await solConn()
        const sw = await import('./lib/solana-wallets.ts')
        const owner = new PublicKey(conn.sol.address)
        const plan = await sol.planUnwrapSol(c, owner, amt)
        const before = await c.getBalance(owner)
        const sim = await c.simulateTransaction(plan.tx, [owner])
        if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`)
        // Net change in the wallet's SOL from the simulation: the unwrapped amount and any returned rent, less the fee.
        const gain = BigInt(sim.value.accounts![0]!.lamports - before)
        const yes = await ask({
          title: `Unwrap ${formatUnits(plan.amount, 9)} wSOL?`,
          rows: [['SOL balance change', `${gain < 0n ? '-' + formatUnits(-gain, 9) : '+' + formatUnits(gain, 9)} SOL`]],
          note: plan.full ? 'This also closes your wSOL account, which returns its rent.' : undefined,
          ok: 'Unwrap',
        })
        if (!yes) return say('Cancelled.')
        const [signed] = await sw.signSolanaTransactions(conn.sol.wallet, conn.sol.account, [plan.tx])
        const sig = await sw.sendAndConfirm(c, signed)
        say(`Unwrapped ${formatUnits(plan.amount, 9)} wSOL.`, 'ok', chain.explorerTx + sig)
      } else if (conn.evm && token.address) {
        const w = conn.evm.wallet
        await ensureEvmChain(w, chain)
        const tx = { from: conn.evm.address, to: token.address, data: withdrawCalldata(amt) }
        await w.provider.request({ method: 'eth_call', params: [tx, 'latest'] }).catch((e) => {
          throw new Error(`unwrap would fail: ${errorText(e)}`)
        })
        const yes = await ask({
          title: `Unwrap ${amount} ${token.symbol} on ${chain.name}?`,
          rows: [['You receive', `${amount} ${chain.nativeSymbol}, less gas`]],
          ok: 'Unwrap',
        })
        if (!yes) return say('Cancelled.')
        const hash = await w.provider.request({ method: 'eth_sendTransaction', params: [tx] })
        say(`Sent ${short(hash, 10)}; waiting for confirmation...`, '', chain.explorerTx + hash)
        await waitForEvmReceipt(w, hash)
        say(`Unwrapped ${amount} ${token.symbol}.`, 'ok', chain.explorerTx + hash)
      }
      token = undefined
    })
</script>

<h2>Unwrap a wrapped gas token</h2>
<p>
  Turns a chain's wrapped gas token (wSOL, WETH, WAVAX, WBNB or WPOL) back into the native coin. When this site
  redeems a transfer of a gas token, it already pays out the native coin. This page is for wrapped balances you hold
  for any other reason.
</p>
<label for="chain">Chain</label>
<select id="chain" bind:value={chainId} onchange={() => { token = undefined; log = [] }}>
  {#each UNWRAPPABLE as c}<option value={c.id}>{c.name}</option>{/each}
</select>
{#if wallet}
  <div class="row actions">
    <span class="mono">{wallet.address}</span>
    <button disabled={busy} onclick={load}>Load balance</button>
  </div>
{:else}
  <ConnectPrompt kind={chain.platform === 'solana' ? 'sol' : 'evm'} text="Connect {chain.platform === 'solana' ? 'a Solana' : 'an EVM'} wallet to unwrap on {chain.name}." />
{/if}

{#if token}
  <p>Wrapped balance: {formatUnits(token.balance, token.decimals)} {token.symbol}</p>
  {#if token.balance > 0n}
    <label for="amount">Amount to unwrap</label>
    <div class="row">
      <input id="amount" bind:value={amount} />
      <button onclick={() => (amount = formatUnits(token!.balance, token!.decimals))}>Max</button>
    </div>
    <div class="row actions"><button class="primary" disabled={busy || !amount} onclick={unwrap}>Unwrap</button></div>
  {/if}
{/if}

<Log lines={log} />
