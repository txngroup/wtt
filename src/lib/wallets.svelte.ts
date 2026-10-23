// Site-wide EVM and Solana wallet connections, connected once in the wallet bar and shared by every page.
// (Algorand wallets are already site-wide through use-wallet.) The last choice is remembered and restored quietly
// on the next visit: injected wallets via eth_accounts / silent connect, WalletConnect via its stored session.
import { connectEvm, discoverEvmWallets, type EvmWallet } from './evm.ts'

export type EvmConnection = { wallet: EvmWallet; address: string }
export type SolanaConnection = { wallet: any; account: any; address: string }
export type WalletKind = 'algo' | 'evm' | 'sol'

// $state.raw: reactive on assignment, but the wallet objects themselves are not proxied (wallets may rely on identity).
class Connections {
  evm = $state.raw<EvmConnection | undefined>()
  sol = $state.raw<SolanaConnection | undefined>()
  restoring = $state.raw<{ evm?: boolean; sol?: boolean }>({})
  request = $state.raw<{ kind?: WalletKind; n: number } | undefined>() // the latest requestConnect
}
export const conn = new Connections()

// A page's Connect button asks the wallet bar to bring that wallet's card into view and open its list of wallets
// (or just to show the bar, without a kind). The bar scrolls back to the page once the wallet connects.
let requests = 0
export const requestConnect = (kind?: WalletKind) => (conn.request = { kind, n: ++requests })

const KEY = { evm: 'wallet.evm', sol: 'wallet.sol' }
const remember = (k: string, v: string | null) => {
  try {
    v ? localStorage.setItem(k, v) : localStorage.removeItem(k)
  } catch {
    // storage blocked: the connection just won't be restored next time
  }
}
const recall = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export async function connectEvmWallet(w: EvmWallet) {
  const address = await connectEvm(w)
  conn.evm = { wallet: w, address }
  remember(KEY.evm, w.topic ? 'walletconnect' : (w.rdns ?? w.name))
}

export async function connectSolanaWallet(w: any) {
  const sw = await import('./solana-wallets.ts')
  const account = await sw.connectSolana(w)
  conn.sol = { wallet: w, account, address: account.address }
  remember(KEY.sol, w.topic ? 'walletconnect' : w.name)
}

export async function disconnectWallet(kind: 'evm' | 'sol') {
  const c = conn[kind]
  conn[kind] = undefined
  remember(KEY[kind], null)
  if (c?.wallet.topic) (await import('./walletconnect.ts')).disconnectSession(c.wallet.topic)
  else if (kind === 'sol') await c?.wallet.features['standard:disconnect']?.disconnect?.()
}

// Reconnect without prompts where the wallet allows it. EVM and Solana restore side by side, and `conn.restoring`
// lets the wallet bar show "Reconnecting..." meanwhile. WalletConnect keeps its sessions in IndexedDB, so the
// remembered choice alone decides whether to load its client and look for a session.
export async function restoreWallets() {
  await Promise.all([
    restore('evm', async (choice) => {
      if (choice === 'walletconnect') {
        const wc = await import('./walletconnect.ts')
        const s = await wc.existingSession('evm')
        if (!s) return false
        const w = wc.evmWalletFromSession(s)
        conn.evm = { wallet: w, address: (await w.provider.request({ method: 'eth_accounts' }))[0] }
        return true
      }
      const w = (await discoverEvmWallets()).find((x) => (x.rdns ?? x.name) === choice)
      const [address] = (await w?.provider.request({ method: 'eth_accounts' }).catch(() => [])) ?? []
      if (w && address) conn.evm = { wallet: w, address }
      return !!(w && address)
    }),
    restore('sol', async (choice) => {
      if (choice === 'walletconnect') {
        const wc = await import('./walletconnect.ts')
        const s = await wc.existingSession('solana')
        if (!s) return false
        const w = wc.solanaWalletFromSession(s)
        conn.sol = { wallet: w, account: w.accounts[0], address: w.accounts[0].address }
        return true
      }
      const sw = await import('./solana-wallets.ts')
      // Wallet Standard wallets register asynchronously; give the remembered one up to a second to appear.
      let w
      for (let i = 0; i < 10 && !(w = sw.solanaWallets().find((x) => x.name === choice)); i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const res = await w?.features['standard:connect'].connect({ silent: true }).catch(() => undefined)
      const account = res?.accounts?.[0]
      if (w && account) conn.sol = { wallet: w, account, address: account.address }
      return !!(w && account)
    }),
  ])
}

async function restore(kind: 'evm' | 'sol', attempt: (choice: string) => Promise<boolean>) {
  const choice = recall(KEY[kind])
  if (!choice) return
  conn.restoring = { ...conn.restoring, [kind]: true }
  try {
    // A locked browser wallet stays remembered for next time; a WalletConnect session that has ended does not.
    if (!(await attempt(choice)) && choice === 'walletconnect') remember(KEY[kind], null)
  } catch {
    // the Connect button stays in place
  } finally {
    conn.restoring = { ...conn.restoring, [kind]: false }
  }
}
