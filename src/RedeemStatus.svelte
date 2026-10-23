<script lang="ts" module>
  // Progress of a sent transfer while the guardians sign it. The redeem link appears only once there is something
  // to redeem, so nobody is sent to the Redeem page too early.
  export type GuardianWait = {
    state: 'waiting' | 'ready' | 'timeout'
    since: number // Date.now() when the source transaction confirmed
    expected: string // a sentence, e.g. "This usually takes a minute or two."
    dest: string // destination chain name
    link: string // /redeem/?... for this transfer
    id: string // what to paste into the Redeem tab later
  }
</script>

<script lang="ts">
  let { wait }: { wait: GuardianWait } = $props()

  let now = $state(Date.now())
  $effect(() => {
    if (wait.state !== 'waiting') return
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })
  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - wait.since) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })
</script>

<div class="box status">
  {#if wait.state === 'waiting'}
    <p><b>Waiting for the guardians to sign</b> <span class="mono">{elapsed}</span></p>
    <p class="muted">
      {wait.expected} The redeem button appears here when the transfer is ready. You can also leave and
      redeem later: paste <span class="mono">{wait.id}</span> into the Redeem tab.
    </p>
  {:else if wait.state === 'ready'}
    <p class="ok">The guardians have signed. The transfer is ready to redeem on {wait.dest}.</p>
    <a class="button primary" href={wait.link}>Redeem on {wait.dest}</a>
  {:else}
    <p class="warn">
      The guardians have not signed after {elapsed}. Nothing is lost: the transfer stays redeemable, and the Redeem tab
      will show it once they sign.
    </p>
    <a class="button" href={wait.link}>Check on the Redeem tab</a>
  {/if}
</div>

<style>
  .status p:first-child { margin-top: 0; }
</style>
