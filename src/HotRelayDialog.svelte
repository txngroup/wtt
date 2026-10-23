<script lang="ts">
  // A HOT request waiting for the HOT app on a phone, or HOT's Telegram wallet (see lib/near-wallets.ts). On desktops
  // the QR code shows at once; on phones the wallet is most likely on this device, so its links come first.
  import { relay } from './lib/hot-relay.svelte.ts'

  const touch = matchMedia('(pointer: coarse), (max-width: 640px)').matches
  let dialog: HTMLDialogElement
  $effect(() => {
    if (relay.current && !dialog.open) dialog.showModal()
    else if (!relay.current && dialog.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} aria-labelledby="hot-title" oncancel={(e) => { e.preventDefault(); relay.current?.cancel() }}>
  {#if relay.current}
    {@const req = relay.current}
    <h2 id="hot-title">Approve in HOT</h2>
    <p>{req.what}</p>
    {#if req.expired}
      <p class="warn">If you have not opened this request in HOT yet, it has expired. Cancel and start again.</p>
    {/if}
    {#if !touch}
      <div class="qr">{@html req.qr}</div>
      <p class="muted">Scan with your phone's camera or the HOT app within a minute. This page continues once you approve.</p>
    {/if}
    <div class="row links">
      <a class="button" class:primary={touch} href={req.link} target="_blank" rel="noreferrer">Open the HOT app</a>
      <a class="button" href={req.telegram} target="_blank" rel="noreferrer">Open in Telegram</a>
    </div>
    <div class="row buttons"><button onclick={() => req.cancel()}>Cancel</button></div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(400px, calc(100vw - 32px)); padding: 20px 22px; border: 1px solid var(--fg);
    background: var(--bg); color: var(--fg);
  }
  dialog::backdrop { background: rgba(15, 17, 20, .45); }
  h2 { margin: 0 0 12px; }
  .qr { display: flex; justify-content: center; margin: 12px 0 4px; background: #fff; padding: 8px; }
  .qr :global(svg) { width: 220px; height: 220px; }
  .links { margin-top: 12px; }
  .buttons { justify-content: flex-end; margin-top: 18px; }
</style>
