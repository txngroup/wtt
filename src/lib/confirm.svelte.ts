// In-page replacement for window.confirm(). ConfirmDialog.svelte (mounted once in App) shows the current request,
// and the promise resolves true or false when the user picks a button or presses Escape.
export type ConfirmRequest = {
  title: string
  rows?: [string, string][] // label, value
  note?: string // shown as a warning under the rows
  ok: string // label of the confirming button
}

class Pending {
  current = $state.raw<(ConfirmRequest & { resolve: (yes: boolean) => void }) | undefined>()
}
export const pending = new Pending()

export function ask(req: ConfirmRequest): Promise<boolean> {
  pending.current?.resolve(false)
  return new Promise((resolve) => (pending.current = { ...req, resolve }))
}

export function answer(yes: boolean) {
  const p = pending.current
  pending.current = undefined
  p?.resolve(yes)
}
