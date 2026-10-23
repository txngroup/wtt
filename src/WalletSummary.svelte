<script lang="ts">
  // Phones only: one bar stands in for the cards of connected wallets, so the page itself stays near the top.
  // Wider screens show the cards in one short row instead, and hide this bar.
  let { chips, controls, expanded = $bindable() }: { chips: string[]; controls: string; expanded: boolean } = $props()
</script>

<button class="summary" aria-expanded={expanded} aria-controls={controls} onclick={() => (expanded = !expanded)}>
  <span class="left">
    <span class="line"><span class="dot" aria-hidden="true"></span>{chips.length} wallet{chips.length === 1 ? '' : 's'} connected</span>
    <span class="chips">{#each chips as c (c)}<span>{c}</span>{/each}</span>
  </span>
  <span class="manage">
    {expanded ? 'Hide' : 'Manage'}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </span>
</button>

<style>
  .summary {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 60px;
    padding: 12px 12px 12px 14px; border: 1px solid var(--line); background: var(--field); text-align: left;
  }
  .left { display: flex; flex-direction: column; gap: 6px; }
  .line { display: flex; align-items: center; gap: 8px; font-weight: 500; }
  .dot { width: 7px; height: 7px; background: var(--ok); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips span { padding: 1px 6px; border: 1px solid var(--line); font: 11px/1.5 var(--mono); letter-spacing: .05em; color: var(--muted); }
  .manage { display: flex; align-items: center; gap: 4px; font-size: 14px; color: var(--muted); }
  .summary[aria-expanded='true'] svg { transform: rotate(180deg); }
  @media (prefers-reduced-motion: no-preference) {
    .manage svg { transition: transform .15s; }
  }
  @media (min-width: 720px) {
    .summary { display: none; }
  }
</style>
