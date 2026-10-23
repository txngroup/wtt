// The HOT request waiting on the person's phone, if any. HotRelayDialog.svelte (mounted once in App) shows it as a QR
// code and links; near-wallets.ts sets and clears it.
export type RelayRequest = {
  what: string // what the person is asked to approve
  link: string // opens the request in the HOT app
  telegram: string // opens it in HOT's Telegram wallet
  qr: string // SVG of the link
  expired: boolean // the minute to open it has passed; a request already opened can still be approved
  cancel: () => void
}

class Relay {
  current = $state.raw<RelayRequest | undefined>()
}
export const relay = new Relay()
