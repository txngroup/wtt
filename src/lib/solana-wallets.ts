// Minimal Wallet Standard discovery and signing for Solana browser wallets (Phantom, Solflare, Backpack, ...).
// Implements the app side of the standard's two events directly instead of pulling in @wallet-standard/app.
import type { Connection, Transaction } from './solana-tx.ts'

const CHAIN = 'solana:mainnet'
export type SolanaWallet = {
  name: string
  icon: string
  chains: readonly string[]
  features: Record<string, any>
  accounts: readonly { address: string; publicKey: Uint8Array }[]
}

const registered = new Set<SolanaWallet>()
const api = {
  register: (...wallets: SolanaWallet[]) => {
    wallets.forEach((w) => registered.add(w))
    return () => wallets.forEach((w) => registered.delete(w))
  },
}
if (typeof window !== 'undefined') {
  window.addEventListener('wallet-standard:register-wallet', (e) => (e as CustomEvent).detail?.(api))
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }))
}

export const solanaWallets = () =>
  [...registered].filter(
    (w) => w.chains.includes(CHAIN) && w.features['standard:connect'] && w.features['solana:signTransaction'],
  )

export async function connectSolana(w: SolanaWallet) {
  const { accounts } = await w.features['standard:connect'].connect()
  const account = accounts?.[0] ?? w.accounts[0]
  if (!account) throw new Error('wallet returned no account')
  return account as { address: string; publicKey: Uint8Array }
}

// Ask the wallet to sign several (possibly partially signed) transactions in one prompt.
export async function signSolanaTransactions(w: SolanaWallet, account: unknown, txs: Transaction[]): Promise<Uint8Array[]> {
  const inputs = txs.map((tx) => ({
    account,
    chain: CHAIN,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  }))
  const out = await w.features['solana:signTransaction'].signTransaction(...inputs)
  return out.map((o: { signedTransaction: Uint8Array }) => o.signedTransaction)
}

// Confirm by polling the signature status over HTTP. web3.js's confirmTransaction waits on a WebSocket
// subscription, and the public RPC's WebSocket endpoint does not work, so it reported landed transactions as expired.
export async function sendAndConfirm(conn: Connection, signed: Uint8Array) {
  const sig = await conn.sendRawTransaction(signed, { skipPreflight: false, maxRetries: 5 })
  for (let i = 0; i < 90; i++) {
    const [status] = (await conn.getSignatureStatuses([sig])).value
    if (status?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return sig
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`transaction ${sig} is not confirmed after 3 minutes; check it on an explorer before retrying`)
}
