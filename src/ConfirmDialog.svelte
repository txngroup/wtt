<script lang="ts">
  // The site's confirmation dialog (see lib/confirm.svelte.ts). A native modal <dialog> keeps focus inside it and
  // closes on Escape; Cancel comes first so it has the initial focus.
  import { pending, answer } from './lib/confirm.svelte.ts'

  let dialog: HTMLDialogElement
  $effect(() => {
    if (pending.current && !dialog.open) dialog.showModal()
    else if (!pending.current && dialog.open) dialog.close()
  })
</script>

<dialog bind:this={dialog} aria-labelledby="confirm-title" oncancel={(e) => { e.preventDefault(); answer(false) }}>
  {#if pending.current}
    {@const req = pending.current}
    <h2 id="confirm-title">{req.title}</h2>
    {#if req.rows?.length}
      <table class="kv">
        <tbody>
          {#each req.rows as [label, value]}<tr><th>{label}</th><td class="mono">{value}</td></tr>{/each}
        </tbody>
      </table>
    {/if}
    {#if req.note}<p class="warn">{req.note}</p>{/if}
    <div class="row buttons">
      <button onclick={() => answer(false)}>Cancel</button>
      <button class="primary" onclick={() => answer(true)}>{req.ok}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px)); padding: 20px 22px; border: 1px solid var(--fg);
    background: var(--bg); color: var(--fg);
  }
  dialog::backdrop { background: rgba(15, 17, 20, .45); }
  h2 { margin: 0 0 12px; }
  .buttons { justify-content: flex-end; margin-top: 18px; }
</style>
