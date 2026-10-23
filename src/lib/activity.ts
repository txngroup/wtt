// Token Bridge transfers to or from Algorand that involve a set of addresses, from Wormholescan's operations index.
// Wormholescan does not always record the redeem (a 2024 transfer to Algorand still shows no target transaction
// although it was redeemed), so anything it does not mark completed is checked on the destination chain.
import { ALGORAND, WORMHOLESCAN_API, b64ToBytes, chainById, hex, parseVaa, type Vaa } from './wormhole.ts'
import { isRedeemedOnAlgorand } from './algorand-redeem.ts'
import { isRedeemedOnEvm, publicEvmReader } from './evm.ts'
import { accountHash, isNearAccountId } from './near-account.ts'

// unchecked: the destination chain could not be asked (an RPC was down or busy).
export type TransferStatus = 'signing' | 'ready' | 'redeemed' | 'unsupported' | 'unchecked'

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

// Wormholescan files a NEAR account's outgoing transfers under its name and incoming ones under the sha256 of its name,
// so a NEAR account is looked up both ways. It writes implicit accounts (64 hex characters) as senders with a 0x
// prefix, so those are looked up that way too. Only named accounts with a dot count here: a lowercase EVM address would
// otherwise pass for a top-level NEAR name.
const implicit = (a: string) => /^[0-9a-f]{64}$/.test(a)
const isNearAccount = (a: string) => isNearAccountId(a) && (a.includes('.') || implicit(a))
const lookups = (address: string) =>
  isNearAccount(address) ? [address, hex(accountHash(address)), ...(implicit(address) ? ['0x' + address] : [])] : [address]

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
// for a chain this site does not support. The Algorand and EVM code is part of every page already; the Solana and
// NEAR code is fetched separately.
export async function redeemedOnChain(vaa: Vaa): Promise<boolean | undefined> {
  const to = vaa.transfer!.toChain
  if (to === ALGORAND.chainId) return isRedeemedOnAlgorand(vaa)
  const chain = chainById(to)
  if (chain?.platform === 'evm') return isRedeemedOnEvm(publicEvmReader(chain), chain, vaa)
  if (chain?.platform === 'near') return (await import('./near.ts')).isRedeemedOnNear(vaa)
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
  try {
    const redeemed = await redeemedOnChain(parseVaa(b64ToBytes(op.vaa.raw)))
    return { ...t, status: redeemed === undefined ? 'unsupported' : redeemed ? 'redeemed' : 'ready' }
  } catch {
    return { ...t, status: 'unchecked' }
  }
}

// Newest first. One Wormholescan request per address; on-chain checks only for transfers not marked completed.
// `truncated` is set when an address has more operations than one page returns.
export async function fetchTransfers(addresses: string[]): Promise<{ transfers: Transfer[]; truncated: boolean }> {
  const lists = await Promise.all([...new Set(addresses.flatMap(lookups))].map(operationsFor))
  const ops = new Map<string, Operation>()
  for (const op of lists.flat()) if (isAlgorandTransfer(op)) ops.set(op.id, op)
  // The on-chain checks go to public RPCs that limit each address, so at most four run at once.
  const queue = [...ops.values()]
  const transfers: Transfer[] = []
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let op = queue.shift(); op; op = queue.shift()) transfers.push(await toTransfer(op))
    }),
  )
  return {
    transfers: transfers.sort((a, b) => b.time.localeCompare(a.time)),
    truncated: lists.some((l) => l.length >= PAGE_SIZE),
  }
}
