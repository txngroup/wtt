<script lang="ts" module>
  export type LogLine = { text: string; cls?: string; href?: string }
</script>

<script lang="ts">
  // Progress and results of the page's current action. The live region is always in the page, so screen readers
  // announce each line as it is added, errors and confirmations included.
  let { lines }: { lines: LogLine[] } = $props()
</script>

<div aria-live="polite">
  {#if lines.length}
    <div class="box log">
      {#each lines as l}<div class={l.cls}>{l.text}{#if l.href} <a href={l.href} target="_blank" rel="noreferrer">view</a>{/if}</div>{/each}
    </div>
  {/if}
</div>
