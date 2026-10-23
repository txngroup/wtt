<script lang="ts">
  // Shown where a page needs a wallet that is not connected: says which one, with a button that opens that wallet's
  // card in the wallet bar. Without a kind, the button just brings the wallet bar into view.
  import { requestConnect, type WalletKind } from './lib/wallets.svelte.ts'

  let { kind, text }: { kind?: WalletKind; text: string } = $props()
  const LABEL: Record<WalletKind, string> = { algo: 'Algorand', evm: 'EVM', sol: 'Solana', near: 'NEAR' }
</script>

<div class="prompt">
  <p>{text}</p>
  <button class="primary" onclick={() => requestConnect(kind)}>{kind ? `Connect ${LABEL[kind]} wallet` : 'Connect a wallet'}</button>
</div>

<style>
  .prompt {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 10px 0;
    padding: 8px 8px 8px 12px; border: 1px solid var(--warn);
  }
  .prompt p { flex: 1 1 16em; margin: 0; color: var(--warn); }
</style>
