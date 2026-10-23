// WalletConnect v2 for mobile EVM and Solana wallets, using only @walletconnect/sign-client (no Reown AppKit).
// A session is wrapped so the rest of the app sees the same shapes as browser wallets: an EIP-1193 provider for EVM
// (reads go to the chain's public RPC; WalletConnect wallets only sign and send) and a Wallet Standard-like object
// for Solana. Loaded lazily, only when someone picks WalletConnect.
import { SignClient } from '@walletconnect/sign-client'
import type { SessionTypes } from '@walletconnect/types'
import { CHAINS, type Chain } from './wormhole.ts'
import { rpcCall, type EvmWallet } from './evm.ts'
import { base58Decode, fromBase64, toBase64 } from './format.ts'
import { WALLETCONNECT_PROJECT_ID } from './config.ts'

export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'

type Client = InstanceType<typeof SignClient>
let clientPromise: Promise<Client> | undefined

// The relay closes the socket with code 3000 when it refuses the site: an address the WalletConnect project does not
// list, such as a LAN address while testing. The client would reopen the socket every second for good, so it stops
// for the rest of the visit, and the pairing fails with the reason.
let refused: Error | undefined
const onRefused: ((e: Error) => void)[] = []
const whenRefused = () => new Promise<never>((_, reject) => (refused ? reject(refused) : onRefused.push(reject)))
function stop(c: Client, e: Error) {
  if (refused) return
  const reason = /\(([^)]+)\)/.exec(e.message)?.[1] ?? e.message
  refused = new Error(`WalletConnect's relay refused ${location.host} (${reason}). It only accepts the addresses listed for this site's WalletConnect project.`)
  c.core.heartbeat.stop()
  c.core.relayer.transportClose().catch(() => {})
  onRefused.splice(0).forEach((reject) => reject(refused!))
}

const client = () =>
  refused
    ? Promise.reject(refused)
    : (clientPromise ??= SignClient.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        telemetryEnabled: false,
        logger: 'silent', // failures reach the user through the wallet card instead of the console
        metadata: {
          name: 'Algorand WTT',
          description: 'Unofficial tool for the Wormhole Token Bridge (Wrapped Token Transfers) on Algorand',
          url: location.origin,
          icons: [`${location.origin}/favicon.svg`],
        },
      }).then((c) => {
        c.core.relayer.on('relayer_error', (e: Error) => /code: 3000\b/.test(String(e?.message)) && stop(c, e))
        return c
      }))

// Start pairing: returns the wc: URI to show as a QR code (or open on mobile), and a promise of the session.
export async function pair(kind: 'evm' | 'solana') {
  const c = await client()
  const evmChains = CHAINS.filter((ch) => ch.platform === 'evm').map((ch) => `eip155:${ch.evmChainId}`)
  const { uri, approval } = await Promise.race([
    c.connect({
      optionalNamespaces:
        kind === 'evm'
          ? { eip155: { chains: evmChains, methods: ['eth_sendTransaction', 'wallet_switchEthereumChain'], events: ['chainChanged', 'accountsChanged'] } }
          : { solana: { chains: [SOLANA_MAINNET], methods: ['solana_signTransaction', 'solana_signAllTransactions'], events: [] } },
    }),
    whenRefused(),
  ])
  if (!uri) throw new Error('WalletConnect did not return a pairing URI')
  return { uri, session: Promise.race([approval(), whenRefused()]) }
}

const peerName = (s: SessionTypes.Struct) => `${s.peer.metadata.name} (WalletConnect)`
const accountsOf = (s: SessionTypes.Struct, ns: string) => (s.namespaces[ns]?.accounts ?? []).map((a) => a.split(':'))

// EIP-1193 provider over a WalletConnect session.
export function evmWalletFromSession(s: SessionTypes.Struct): EvmWallet {
  const accounts = accountsOf(s, 'eip155')
  if (!accounts.length) throw new Error('the wallet did not share an EVM account')
  let current = CHAINS.find((c) => c.evmChainId === Number(accounts[0][1])) ?? CHAINS.find((c) => c.platform === 'evm')!
  const supported = new Set(accounts.map((a) => Number(a[1])))
  return {
    name: peerName(s),
    topic: s.topic,
    provider: {
      request: async ({ method, params = [] }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [accounts.find((a) => Number(a[1]) === current.evmChainId)?.[2] ?? accounts[0][2]]
          case 'eth_chainId':
            return '0x' + current.evmChainId!.toString(16)
          case 'wallet_switchEthereumChain': {
            const id = parseInt((params[0] as { chainId: string }).chainId, 16)
            const next = CHAINS.find((c) => c.evmChainId === id)
            if (!next || !supported.has(id)) throw Object.assign(new Error(`the wallet did not approve chain ${id}`), { code: 4902 })
            current = next
            return null
          }
          case 'eth_sendTransaction': {
            const tx = params[0] as Record<string, string>
            const value = tx.value && tx.value !== '0x0' ? tx.value : undefined
            return (await client()).request({
              topic: s.topic,
              chainId: `eip155:${current.evmChainId}`,
              request: { method, params: [{ ...tx, ...(value ? { value } : { value: '0x0' }) }] },
            })
          }
          default:
            return rpcCall(current, method, params)
        }
      },
    },
  }
}

// Wallet Standard-shaped Solana wallet over a WalletConnect session. Several transactions go to the wallet in one
// solana_signAllTransactions request, so one prompt, when the wallet approved that method for the session; otherwise
// one solana_signTransaction request (and prompt) each, and `oneAtATime` lets the page say so.
export function solanaWalletFromSession(s: SessionTypes.Struct) {
  const [account] = accountsOf(s, 'solana')
  if (!account) throw new Error('the wallet did not share a Solana account')
  const address = account[2]
  const acct = { address, publicKey: base58Decode(address) }
  const batch = !!s.namespaces.solana?.methods.includes('solana_signAllTransactions')
  const request = async (method: string, params: unknown): Promise<any> =>
    (await client()).request({ topic: s.topic, chainId: SOLANA_MAINNET, request: { method, params } })
  return {
    name: peerName(s),
    topic: s.topic,
    icon: '',
    chains: ['solana:mainnet'],
    accounts: [acct],
    oneAtATime: !batch,
    features: {
      'standard:connect': { connect: async () => ({ accounts: [acct] }) },
      'solana:signTransaction': {
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          const { addSignatureToWire, checkSignedWire, PublicKey } = await import('./solana-tx.ts')
          if (batch && inputs.length > 1) {
            const res = await request('solana_signAllTransactions', { transactions: inputs.map((i) => toBase64(i.transaction)) })
            const signed: string[] = res?.transactions ?? []
            if (signed.length !== inputs.length) throw new Error(`the wallet returned ${signed.length} of ${inputs.length} signed transactions`)
            return signed.map((t, i) => ({ signedTransaction: checkSignedWire(inputs[i].transaction, fromBase64(t)) }))
          }
          const out = []
          for (const input of inputs) {
            const res = await request('solana_signTransaction', { transaction: toBase64(input.transaction) })
            // Wallets answer either with the signature alone, or with the whole signed transaction.
            out.push({
              signedTransaction: res?.transaction
                ? checkSignedWire(input.transaction, fromBase64(res.transaction))
                : addSignatureToWire(input.transaction, new PublicKey(address), base58Decode(res.signature)),
            })
          }
          return out
        },
      },
    },
  }
}


// A still-valid session from an earlier visit with the given namespace, if any.
export async function existingSession(kind: 'evm' | 'solana') {
  const ns = kind === 'evm' ? 'eip155' : 'solana'
  const now = Date.now() / 1000
  return (await client()).session.getAll().find((s) => s.namespaces[ns]?.accounts.length && s.expiry > now)
}

export async function disconnectSession(topic: string) {
  try {
    await (await client()).disconnect({ topic, reason: { code: 6000, message: 'User disconnected' } })
  } catch {
    // already gone on the wallet side
  }
}

