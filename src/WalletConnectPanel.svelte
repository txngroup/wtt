<script lang="ts">
  // A WalletConnect pairing waiting for the wallet. On phones and touch screens the wallet is most likely on this
  // device, so "Open in wallet" comes first and the QR code stays folded away. On desktops the QR code shows at once.
  let { uri, qr, accountHint, oncancel }: { uri: string; qr: string; accountHint: string; oncancel: () => void } = $props()

  const touch = matchMedia('(pointer: coarse), (max-width: 640px)').matches
  const id = $props.id()
  let showQr = $state(!touch)
  let copied = $state(false)

  async function copy() {
    await navigator.clipboard.writeText(uri)
    copied = true
    setTimeout(() => (copied = false), 2500)
  }
</script>

<div class="panel">
  <div class="steps">
    <p class="hint">Approve the connection in a wallet that has {accountHint}.</p>
    {#if touch}
      <a class="button primary" href={uri}>
        Open in wallet
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
      </a>
    {/if}
    <button onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
    <button class="disclosure" aria-expanded={showQr} aria-controls="{id}-qr" onclick={() => (showQr = !showQr)}>
      <span>{showQr ? 'Hide' : 'Show'} QR code <span class="muted">for another device</span></span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {#if !touch}<a class="link" href={uri}>Open in a wallet on this device</a>{/if}
    <button class="quiet" onclick={oncancel}>Cancel</button>
  </div>
  <div class="qr" id="{id}-qr" hidden={!showQr}>{@html qr}</div>
  <span class="sr-only" aria-live="polite">{copied ? 'Link copied. Paste it into your wallet.' : ''}</span>
</div>

<style>
  /* One column at every width, inside the wallet card: the steps, the QR code, then the same-device link and Cancel. */
  .panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .steps { display: contents; }
  .hint { margin: 0; }
  .steps > :is(a.button, button:not(.disclosure, .quiet)) { justify-content: center; gap: 8px; min-height: 48px; }
  .disclosure {
    display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0;
    border: 0; border-top: 1px solid var(--line); font-size: 14px; text-align: left; white-space: normal;
  }
  .disclosure:hover:not(:disabled) { background: none; }
  .disclosure[aria-expanded='true'] svg { transform: rotate(180deg); }
  .quiet { order: 1; align-self: flex-start; min-height: 44px; padding: 0 4px; border: 0; color: var(--muted); }
  .quiet:hover:not(:disabled) { background: none; color: var(--fg); }
  .link { order: 1; font-size: 14px; align-self: flex-start; } /* below the QR code it belongs with */
  .qr { display: flex; justify-content: center; }
  .qr[hidden] { display: none; }
  /* The SVG carries its own white quiet zone. */
  .qr :global(svg) { display: block; width: 240px; max-width: 100%; height: auto; }

  @media (prefers-reduced-motion: no-preference) {
    .disclosure svg { transition: transform .15s; }
  }
</style>
