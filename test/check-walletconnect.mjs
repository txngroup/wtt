// Check the WalletConnect project id against the relay: initialise, create a pairing URI, then shut down.
// Usage: node --env-file-if-exists=.env test/check-walletconnect.mjs (reads VITE_WALLETCONNECT_PROJECT_ID and SITE_URL)
import { SignClient } from '@walletconnect/sign-client'
const projectId = process.env.VITE_WALLETCONNECT_PROJECT_ID
if (!projectId) throw new Error('set VITE_WALLETCONNECT_PROJECT_ID, see .env.example')
const client = await SignClient.init({
  projectId,
  telemetryEnabled: false,
  metadata: { name: 'Algorand WTT', description: 'test', url: process.env.SITE_URL ?? 'http://localhost:5173', icons: [] },
})
const { uri } = await client.connect({ optionalNamespaces: { solana: { chains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'], methods: ['solana_signTransaction'], events: [] } } })
console.log('relay connected:', client.core.relayer.connected, '| pairing uri:', uri?.slice(0, 60) + '...')
await client.core.relayer.transportClose()
process.exit(0)
