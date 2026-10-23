<script lang="ts">
  import algosdk from 'algosdk'
  import { tick, untrack } from 'svelte'
  import { useWallet } from '@txnlab/use-wallet-svelte'
  import { CHAINS, chainById, chainName, fetchVaa, ALGORAND } from './lib/wormhole.ts'
  import { ensureEvmChain, waitForEvmReceipt } from './lib/evm.ts'
  import { evmTokenInfo, buildEvmTransfer, nativeFeeReserve, simulateEvmTx, sendEvmTx, sequenceFromReceipt, evmEmitterHex, truncateTo8, type EvmTxRequest } from './lib/evm-send.ts'
  import { algorandAssetForToken } from './lib/algorand-redeem.ts'
  import { algod } from './lib/algorand.ts'
  import { conn } from './lib/wallets.svelte.ts'
  import { formatUnits, parseUnits, errorText, short } from './lib/format.ts'
  import { ask } from './lib/confirm.svelte.ts'
  import RedeemStatus, { type GuardianWait } from './RedeemStatus.svelte'
  import ConnectPrompt from './ConnectPrompt.svelte'
  import Log, { type LogLine } from './Log.svelte'

  const { activeAddress, signTransactions } = useWallet()

  type Token = {
    symbol: string
    decimals: number
    balance: bigint
    originChain: number
    originAddress: Uint8Array
    evm?: Awaited<ReturnType<typeof evmTokenInfo>>
    solMint?: string
    feeReserve?: bigint // for the chain's own coin: what Max leaves for fees and rent
  }

  let chainId = $state(6)
  let tokenInput = $state('')
  let token = $state<Token | undefined>()
  let algoAssetId = $state<bigint | undefined>()
  let recipient = $state('')
  let recipientOptedIn = $state<boolean | undefined>()
  let amount = $state('')
  let sendAmt = $state<bigint | undefined>() // the reviewed amount, after truncation to 8 decimals
  let evmPlan = $state<EvmTxRequest[] | undefined>()
  let solPlan = $state<any>()
  let simulation = $state<string | undefined>()
  let log = $state<LogLine[]>([])
  let busy = $state(false)
  let wait = $state<GuardianWait | undefined>()

  const chain = $derived(chainById(chainId)!)
  const source = $derived(chain.platform === 'evm' ? conn.evm : conn.sol)
  const say = (text: string, cls?: string, href?: string) => (log = [...log, { text, cls, href }])
  const resetPlan = () => (evmPlan = solPlan = simulation = sendAmt = undefined)
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

  $effect(() => {
    if (!recipient && activeAddress.current) recipient = activeAddress.current
  })

  // Until the user picks a chain, start on the connected wallet's: the EVM wallet's current network, or Solana when
  // only a Solana wallet is connected. Then the balance of that chain's coin loads without a prompt to switch networks.
  let picked = false // the source chain was set, by the user or from a wallet
  $effect(() => {
    const evm = conn.evm?.wallet
    const solana = !!conn.sol
    untrack(async () => {
      if (picked) return
      let id: number | undefined
      if (evm) {
        const current = parseInt(String(await evm.provider.request({ method: 'eth_chainId' })), 16)
        id = CHAINS.find((c) => c.evmChainId === current)?.id
      } else if (solana) id = CHAINS.find((c) => c.platform === 'solana')?.id
      if (id === undefined || picked) return
      picked = true
      chainId = id
      autoLoad()
    })
  })
  // After the user picks a chain, its coin's balance loads as soon as a wallet for it connects.
  $effect(() => {
    const address = source?.address
    untrack(() => address && picked && autoLoad())
  })
  // Load the chain's own coin unless a token address is typed in.
  async function autoLoad() {
    await tick()
    if (source && !tokenInput.trim() && !token && !busy) loadToken()
  }
  function pickChain() {
    picked = true
    tokenInput = ''
    token = undefined
    resetPlan()
    autoLoad()
  }
  // Max for the chain's own coin keeps the fee reserve back; the bridge carries at most 8 decimals.
  const maxAmount = (t: Token) => truncateTo8(t.balance > (t.feeReserve ?? 0n) ? t.balance - (t.feeReserve ?? 0n) : 0n, t.decimals)
  // A reserve shown rounded up to 6 decimals.
  const approx = (x: bigint, decimals: number) => {
    const step = decimals > 6 ? 10n ** BigInt(decimals - 6) : 1n
    return formatUnits(((x + step - 1n) / step) * step, decimals)
  }

  const loadToken = () =>
    run(async () => {
      token = algoAssetId = undefined
      amount = ''
      resetPlan()
      log = []
      if (chain.platform === 'evm') {
        if (!conn.evm) throw new Error('connect an EVM wallet in the bar above')
        await ensureEvmChain(conn.evm.wallet, chain)
        const t = await evmTokenInfo(conn.evm.wallet, chain, conn.evm.address, tokenInput.trim() || undefined)
        token = { ...t, evm: t, feeReserve: t.native ? await nativeFeeReserve(conn.evm.wallet, chain) : undefined }
      } else {
        if (!conn.sol) throw new Error('connect a Solana wallet in the bar above')
        const { Connection, PublicKey } = await import('./lib/solana-tx.ts')
        const sol = await import('./lib/solana.ts')
        const c = new Connection(sol.SOLANA_RPC, 'confirmed')
        const owner = new PublicKey(conn.sol.address)
        if (!tokenInput.trim()) {
          const [balance, feeReserve] = await Promise.all([c.getBalance(owner), sol.solSendReserve(c)])
          token = { symbol: 'SOL', decimals: 9, balance: BigInt(balance), originChain: 1, originAddress: sol.NATIVE_MINT.toBytes(), feeReserve }
        } else {
          const mint = new PublicKey(tokenInput.trim())
          const decimals = await sol.mintDecimals(c, mint)
          if (decimals === undefined) throw new Error('not an SPL token mint (Token-2022 is not supported)')
          const meta = await sol.wrappedMetaOf(c, mint)
          token = {
            symbol: short(mint.toBase58(), 4),
            decimals,
            balance: (await sol.tokenAccountAmount(c, sol.associatedTokenAddress(owner, mint))) ?? 0n,
            originChain: meta?.chain ?? 1,
            originAddress: meta?.address ?? mint.toBytes(),
            solMint: mint.toBase58(),
          }
        }
      }
      const asset = await algorandAssetForToken(token.originChain, token.originAddress)
      if (!asset) throw new Error(`${token.symbol} has no wrapped asset on Algorand yet (it was never attested there), so it cannot be sent there`)
      algoAssetId = asset.assetId
    })

  async function checkRecipient() {
    recipientOptedIn = undefined
    if (!algosdk.isValidAddress(recipient.trim()) || algoAssetId === undefined) return
    if (algoAssetId === 0n) return (recipientOptedIn = true)
    try {
      await algod.accountAssetInformation(recipient.trim(), algoAssetId).do()
      recipientOptedIn = true
    } catch {
      recipientOptedIn = false
    }
  }
  $effect(() => {
    void recipient
    void algoAssetId
    checkRecipient()
  })

  // Opting in before bridging means any account can pay for the redeem later.
  const optIn = () =>
    run(async () => {
      const addr = activeAddress.current
      if (!addr || addr !== recipient.trim() || algoAssetId === undefined) throw new Error('connect the recipient account in the bar above')
      const sp = await algod.getTransactionParams().do()
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr, receiver: addr, amount: 0, assetIndex: algoAssetId, suggestedParams: sp })
      const [signed] = await signTransactions([txn])
      if (!signed) throw new Error('the wallet did not sign the opt-in')
      await algod.sendRawTransaction(signed).do()
      await algosdk.waitForConfirmation(algod, txn.txID(), 10)
      say(`Opted in to ASA ${algoAssetId}.`, 'ok', `https://allo.info/tx/${txn.txID()}`)
      await checkRecipient()
    })

  const review = () =>
    run(async () => {
      resetPlan()
      log = []
      wait = undefined
      if (!source || !token) throw new Error('choose a token first')
      if (!algosdk.isValidAddress(recipient.trim())) throw new Error('enter a valid Algorand address')
      const to = algosdk.decodeAddress(recipient.trim()).publicKey
      const amt = truncateTo8(parseUnits(amount, token.decimals), token.decimals)
      if (amt <= 0n || amt > token.balance) throw new Error('amount must be above zero and at most your balance')
      sendAmt = amt
      if (chain.platform === 'evm' && conn.evm) {
        await ensureEvmChain(conn.evm.wallet, chain)
        evmPlan = await buildEvmTransfer(conn.evm.wallet, chain, conn.evm.address, token.evm!, amt, ALGORAND.chainId, to)
        // A transfer that still needs an approval can only be simulated after the approval lands.
        simulation = (await simulateEvmTx(conn.evm.wallet, conn.evm.address, evmPlan[0])) ?? 'ok'
      } else if (conn.sol) {
        const { Connection, PublicKey } = await import('./lib/solana-tx.ts')
        const sol = await import('./lib/solana.ts')
        const c = new Connection(sol.SOLANA_RPC, 'confirmed')
        const owner = new PublicKey(conn.sol.address)
        solPlan = await sol.planSolanaTransfer(c, owner, token.solMint ? new PublicKey(token.solMint) : undefined, amt, to, ALGORAND.chainId)
        const sim = await c.simulateTransaction(solPlan.tx)
        simulation = sim.value.err ? `${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-2).join(' ')}` : 'ok'
      }
    })

  const send = () =>
    run(async () => {
      if (!source || !token || sendAmt === undefined) return
      const yes = await ask({
        title: `Bridge ${formatUnits(sendAmt, token.decimals)} ${token.symbol} from ${chain.name} to Algorand?`,
        rows: [['From', source.address], ['To', recipient.trim()]],
        note: 'This cannot be undone.',
        ok: 'Bridge',
      })
      if (!yes) return say('Cancelled.')
      let sequence: bigint
      let emitter: string
      if (chain.platform === 'evm' && conn.evm && evmPlan) {
        const { wallet: w, address } = conn.evm
        await ensureEvmChain(w, chain)
        let receipt: any
        for (const [i, tx] of evmPlan.entries()) {
          if (i > 0) {
            const failure = await simulateEvmTx(w, address, tx)
            if (failure) throw new Error(`${tx.label} would fail: ${failure}`)
          }
          say(`${tx.label}: confirm in your wallet...`)
          const hash = await sendEvmTx(w, address, tx)
          say(`${tx.label}: sent ${short(hash, 10)}`, '', chain.explorerTx + hash)
          receipt = await waitForEvmReceipt(w, hash)
        }
        sequence = sequenceFromReceipt(chain, receipt)
        emitter = evmEmitterHex(chain)
      } else if (conn.sol && solPlan) {
        const { Connection } = await import('./lib/solana-tx.ts')
        const sol = await import('./lib/solana.ts')
        const sw = await import('./lib/solana-wallets.ts')
        const c = new Connection(sol.SOLANA_RPC, 'confirmed')
        const [signed] = await sw.signSolanaTransactions(conn.sol.wallet, conn.sol.account, [solPlan.tx])
        const sig = await sw.sendAndConfirm(c, signed)
        say(`Sent ${short(sig, 10)}`, '', chain.explorerTx + sig)
        sequence = await sol.sequenceFromMessage(c, solPlan.message.publicKey)
        emitter = sol.solanaEmitterHex()
      } else return
      const id = `${chain.id}/${emitter}/${sequence}`
      say(`Wormhole sequence ${sequence}.`, 'ok')
      const slow = [2, 23, 24, 30].includes(chain.id) // these wait for Ethereum finality
      const w: GuardianWait = {
        state: 'waiting',
        since: Date.now(),
        expected: slow ? 'This takes about 20 minutes, until the transaction is final on Ethereum.' : 'This usually takes a minute or two.',
        dest: 'Algorand',
        link: `/redeem/?vaa=${id}`,
        id,
      }
      wait = w
      for (let i = 0; i < 180; i++) {
        if (await fetchVaa(chain.id, emitter, sequence)) return void (wait = { ...w, state: 'ready' })
        await new Promise((r) => setTimeout(r, 10000))
      }
      wait = { ...w, state: 'timeout' }
    })
</script>

<h2>1. Source chain</h2>
<select bind:value={chainId} onchange={pickChain}>
  {#each CHAINS as c}<option value={c.id}>{c.name}</option>{/each}
</select>
{#if source}
  <p>Sending from <span class="mono">{source.address}</span></p>
{:else}
  <ConnectPrompt kind={chain.platform === 'evm' ? 'evm' : 'sol'} text="Connect {chain.platform === 'evm' ? 'an EVM' : 'a Solana'} wallet to send from {chain.name}." />
{/if}

{#if source}
  <h2>2. Token</h2>
  <label for="token">{chain.platform === 'evm' ? 'ERC-20 address' : 'SPL mint address'} (leave empty for {chain.nativeSymbol})</label>
  <div class="row">
    <input id="token" bind:value={tokenInput} placeholder={chain.nativeSymbol} />
    <button disabled={busy} onclick={loadToken}>Load</button>
  </div>
  {#if token}
    <p>
      Balance: {formatUnits(token.balance, token.decimals)} {token.symbol}. Origin chain: {chainName(token.originChain)}.
      {#if algoAssetId !== undefined}Arrives on Algorand as {algoAssetId === 0n ? 'ALGO' : `ASA ${algoAssetId}`}.{/if}
    </p>
  {/if}
{/if}

{#if token && algoAssetId !== undefined}
  <h2>3. Algorand recipient and amount</h2>
  <label for="recipient">Algorand address</label>
  <input id="recipient" bind:value={recipient} oninput={resetPlan} />
  {#if recipientOptedIn === false}
    <p class="warn">
      This account has not opted in to ASA {algoAssetId}. Either opt in now, after which any account can pay for the
      redeem, or redeem later from this account, which adds the opt-in to the redeem.
    </p>
    <button disabled={busy || activeAddress.current !== recipient.trim()} onclick={optIn}>
      {activeAddress.current === recipient.trim() ? `Opt in to ASA ${algoAssetId}` : 'Connect this Algorand account above to opt in'}
    </button>
  {:else if recipientOptedIn}
    <p class="ok">Recipient can receive {algoAssetId === 0n ? 'ALGO' : `ASA ${algoAssetId}`}.</p>
  {/if}
  <label for="amount">Amount ({token.symbol}){token.decimals > 8 ? ', at most 8 decimals are bridged' : ''}</label>
  <div class="row">
    <input id="amount" bind:value={amount} oninput={resetPlan} placeholder="0.0" />
    <button onclick={() => { amount = formatUnits(maxAmount(token!), token!.decimals); resetPlan() }}>Max</button>
  </div>
  {#if token.feeReserve !== undefined}
    <p class="muted">Max keeps about {approx(token.feeReserve, token.decimals)} {token.symbol} back for {chain.platform === 'solana' ? 'fees and account rent' : 'gas and the Wormhole fee'}.</p>
  {/if}
  <p class="warn">Send a small test amount first. Bridged funds cannot be recalled.</p>
  <button class="primary" disabled={busy || !amount || !recipient} onclick={review}>Review</button>
{/if}

{#if simulation}
  <h2>4. Review</h2>
  <div class="box">
    <table class="kv">
      <tbody>
        <tr><th>From</th><td>{chain.name} <span class="mono">{source?.address}</span></td></tr>
        <tr><th>Send</th><td>{token && sendAmt !== undefined ? formatUnits(sendAmt, token.decimals) : amount} {token?.symbol}</td></tr>
        <tr><th>To</th><td>Algorand <span class="mono">{recipient}</span></td></tr>
        {#if evmPlan}<tr><th>Transactions</th><td>{evmPlan.map((t) => t.label).join(', then ')}</td></tr>{/if}
        <tr><th>Simulation</th><td class={simulation === 'ok' ? 'ok' : 'err'}>{simulation === 'ok' ? (evmPlan && evmPlan.length > 1 ? `${evmPlan[0].label} passes. The bridge transaction is simulated after the approval confirms.` : 'passes') : simulation}</td></tr>
      </tbody>
    </table>
  </div>
  <button class="primary" disabled={busy || simulation !== 'ok'} onclick={send}>Send</button>
{/if}

<Log lines={log} />

{#if wait}<RedeemStatus {wait} />{/if}
