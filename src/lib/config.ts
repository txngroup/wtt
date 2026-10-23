// Settings chosen at build time, from environment variables or a .env file (see .env.example).

// WalletConnect project id (dashboard.reown.com). The relay only accepts the domains listed for the project, so each
// host needs its own. Without one, WalletConnect is not offered and only browser wallets can connect.
export const WALLETCONNECT_PROJECT_ID: string = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''
