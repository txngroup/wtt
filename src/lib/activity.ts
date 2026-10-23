// Token Bridge transfers to or from Algorand that involve a set of addresses, from Wormholescan's operations index.
// Wormholescan does not always record the redeem (a 2024 transfer to Algorand still shows no target transaction
// although it was redeemed), so anything it does not mark completed is checked on the destination chain.
import { ALGORAND, WORMHOLESCAN_API, b64ToBytes, chainById, parseVaa, type Vaa } from './wormhole.ts'

export type TransferStatus = 'signing' | 'ready' | 'redeemed' | 'unsupported'

export type Transfer = {
  id: string // chain/emitter/sequence, accepted by the Redeem tab
  time: string // ISO timestamp of the source transaction
  fromChain: number
  toChain: number
  amount: string // human-readable, as Wormholescan reports it
  symbol: string
  sourceTx: string
  targetTx?: string
  status: TransferStatus
}

type Operation = {
  id: string
  vaa?: { raw?: string }
  content?: { standarizedProperties?: { appIds?: string[] | null; fromChain?: number; toChain?: number }; payload?: { payloadType?: number } | null }
  sourceChain?: { chainId?: number; timestamp?: string; transaction?: { txHash?: string } }
  targetChain?: { status?: string; transaction?: { txHash?: string } } | null
  data?: { symbol?: string; tokenAmount?: string } | null
}

const PAGE_SIZE = 50

async function operationsFor(address: string): Promise<Operation[]> {
  const r = await fetch(`${WORMHOLESCAN_API}/operations?address=${encodeURIComponent(address)}&pageSize=${PAGE_SIZE}`)
  if (!r.ok) throw new Error(`Wormholescan: HTTP ${r.status}`)
  return (await r.json())?.operations ?? []
}

// Plain Token Bridge transfers (payload 1, the kind this site redeems) with Algorand at either end.
function isAlgorandTransfer(op: Operation) {
  const p = op.content?.standarizedProperties
  return (
    !!p?.appIds?.includes('PORTAL_TOKEN_BRIDGE') &&
    op.content?.payload?.payloadType === 1 &&
    (p.fromChain === ALGORAND.chainId || p.toChain === ALGORAND.chainId)
  )
}

// Whether the transfer has been redeemed, asked of the destination chain itself (no wallet needed), or undefined
// for a chain this site does not support.
export async function redeemedOnChain(vaa: Vaa): Promise<boolean | undefined> {
  const to = vaa.transfer!.toChain
  if (to === ALGORAND.chainId) return (await import('./algorand-redeem.ts')).isRedeemedOnAlgorand(vaa)
  const chain = chainById(to)
  if (chain?.platform === 'evm') {
    const evm = await import('./evm.ts')
    return evm.isRedeemedOnEvm(evm.publicEvmReader(chain), chain, vaa)
  }
  if (chain?.platform === 'solana') {
    const [{ Connection }, sol] = await Promise.all([import('./solana-tx.ts'), import('./solana.ts')])
    return sol.isRedeemedOnSolana(new Connection(sol.SOLANA_RPC, 'confirmed'), vaa)
  }
  return undefined
}

async function toTransfer(op: Operation): Promise<Transfer> {
  const p = op.content!.standarizedProperties!
  const t: Transfer = {
    id: op.id,
    time: op.sourceChain?.timestamp ?? '',
    fromChain: p.fromChain!,
    toChain: p.toChain!,
    amount: op.data?.tokenAmount ?? '?',
    symbol: op.data?.symbol || 'tokens',
    sourceTx: op.sourceChain?.transaction?.txHash ?? '',
    targetTx: op.targetChain?.transaction?.txHash || undefined,
    status: 'signing',
  }
  if (!op.vaa?.raw) return t
  if (op.targetChain?.status === 'completed') return { ...t, status: 'redeemed' }
  const redeemed = await redeemedOnChain(parseVaa(b64ToBytes(op.vaa.raw)))
  return { ...t, status: redeemed === undefined ? 'unsupported' : redeemed ? 'redeemed' : 'ready' }
}

// Newest first. One Wormholescan request per address; on-chain checks only for transfers not marked completed.
// `truncated` is set when an address has more operations than one page returns.
export async function fetchTransfers(addresses: string[]): Promise<{ transfers: Transfer[]; truncated: boolean }> {
  const lists = await Promise.all([...new Set(addresses)].map(operationsFor))
  const ops = new Map<string, Operation>()
  for (const op of lists.flat()) if (isAlgorandTransfer(op)) ops.set(op.id, op)
  const transfers = await Promise.all([...ops.values()].map(toTransfer))
  return {
    transfers: transfers.sort((a, b) => b.time.localeCompare(a.time)),
    truncated: lists.some((l) => l.length >= PAGE_SIZE),
  }
}
