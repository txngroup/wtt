// Wormhole constants, VAA parsing and Wormholescan lookups. No dependencies beyond keccak.
import { keccak_256 } from '@noble/hashes/sha3'

export const ALGORAND = {
  chainId: 8,
  coreAppId: 842125965n,
  tokenBridgeAppId: 842126029n,
  coreAppAddress: 'J476J725L4JTOI2YU6DAI4E23LYUECLZR7RCYZ3LK6QFHX4M54ZI53SGXQ',
  tokenBridgeAddress: 'M7UT7JWIVROIDGMQVJZUBQGBNNIIVOYRPC7JWMGQES4KYJIZHVCRZEGFRQ',
  // The token bridge's Wormhole emitter, and the core contract storage account that tracks its sequence.
  tokenBridgeEmitter: '67e93fa6c8ac5c819990aa7340c0c16b508abb1178be9b30d024b8ac25193d45',
  emitterStorage: 'KGLLCLRLXRIANIGQCGBNSYITYAB2NEUQGQ6A5LN6SXTPDKWUEFDUUSEGDM',
}

export const WORMHOLESCAN_API = 'https://api.wormholescan.io/api/v1'

export type Chain = {
  id: number // Wormhole chain id
  name: string
  slug: string // in the route pages' paths (/near-algorand-bridge/) and in /to-algorand/?from=<slug>
  platform: 'evm' | 'solana' | 'near'
  tokenBridge: string
  core: string // core bridge (emits LogMessagePublished on EVM)
  evmChainId?: number
  rpc?: string // public CORS-enabled RPC, used for reads when the wallet is connected over WalletConnect
  nativeSymbol: string
  slow?: boolean // the guardians wait for the transfer to be final on Ethereum, which takes 15 to 30 minutes
  explorerTx: string // prefix; append the tx hash
}

// Destinations whose token bridge has Algorand's emitter registered (checked on-chain 2026-10-21).
export const CHAINS: Chain[] = [
  { id: 1, name: 'Solana', slug: 'solana', platform: 'solana', tokenBridge: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb', core: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth', nativeSymbol: 'SOL', explorerTx: 'https://solscan.io/tx/' },
  { id: 2, name: 'Ethereum', slug: 'ethereum', slow: true, platform: 'evm', evmChainId: 1, tokenBridge: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', core: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B', rpc: 'https://ethereum-rpc.publicnode.com', nativeSymbol: 'ETH', explorerTx: 'https://etherscan.io/tx/' },
  { id: 4, name: 'BNB Smart Chain', slug: 'bnb', platform: 'evm', evmChainId: 56, tokenBridge: '0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7', core: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B', rpc: 'https://bsc-rpc.publicnode.com', nativeSymbol: 'BNB', explorerTx: 'https://bscscan.com/tx/' },
  { id: 5, name: 'Polygon', slug: 'polygon', platform: 'evm', evmChainId: 137, tokenBridge: '0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE', core: '0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7', rpc: 'https://polygon-bor-rpc.publicnode.com', nativeSymbol: 'POL', explorerTx: 'https://polygonscan.com/tx/' },
  { id: 6, name: 'Avalanche', slug: 'avalanche', platform: 'evm', evmChainId: 43114, tokenBridge: '0x0e082F06FF657D94310cB8cE8B0D9a04541d8052', core: '0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', nativeSymbol: 'AVAX', explorerTx: 'https://snowtrace.io/tx/' },
  { id: 14, name: 'Celo', slug: 'celo', slow: true, platform: 'evm', evmChainId: 42220, tokenBridge: '0x796Dff6D74F3E27060B71255Fe517BFb23C93eed', core: '0xa321448d90d4e5b0A732867c18eA198e75CAC48E', rpc: 'https://celo-rpc.publicnode.com', nativeSymbol: 'CELO', explorerTx: 'https://celoscan.io/tx/' },
  { id: 23, name: 'Arbitrum', slug: 'arbitrum', slow: true, platform: 'evm', evmChainId: 42161, tokenBridge: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c', core: '0xa5f208e072434bC67592E4C49C1B991BA79BCA46', rpc: 'https://arbitrum-one-rpc.publicnode.com', nativeSymbol: 'ETH', explorerTx: 'https://arbiscan.io/tx/' },
  { id: 24, name: 'Optimism', slug: 'optimism', slow: true, platform: 'evm', evmChainId: 10, tokenBridge: '0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b', core: '0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722', rpc: 'https://optimism-rpc.publicnode.com', nativeSymbol: 'ETH', explorerTx: 'https://optimistic.etherscan.io/tx/' },
  { id: 15, name: 'NEAR', slug: 'near', platform: 'near', tokenBridge: 'contract.portalbridge.near', core: 'contract.wormhole_crypto.near', nativeSymbol: 'NEAR', explorerTx: 'https://nearblocks.io/txns/' },
  { id: 30, name: 'Base', slug: 'base', slow: true, platform: 'evm', evmChainId: 8453, tokenBridge: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627', core: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6', rpc: 'https://base-rpc.publicnode.com', nativeSymbol: 'ETH', explorerTx: 'https://basescan.org/tx/' },
]

export const chainById = (id: number) => CHAINS.find((c) => c.id === id)
export const chainName = (id: number) => chainById(id)?.name ?? (id === ALGORAND.chainId ? 'Algorand' : `chain ${id}`)
// Explorer link for a transaction on any supported chain, Algorand included.
export const explorerTxUrl = (chain: number, tx: string) =>
  chain === ALGORAND.chainId ? `https://allo.info/tx/${tx}` : chainById(chain) ? chainById(chain)!.explorerTx + tx : undefined

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
export const fromHex = (h: string) => {
  const s = h.replace(/^0x/, '')
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error('invalid hex')
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16))
}
export const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0))
const be = (b: Uint8Array) => b.reduce((n, x) => (n << 8n) | BigInt(x), 0n)

export type TokenTransfer = {
  payloadType: 1 | 3
  amount: bigint // normalized to at most 8 decimals
  tokenAddress: Uint8Array // 32 bytes
  tokenChain: number
  to: Uint8Array // 32 bytes
  toChain: number
  fee: bigint // payload type 1 only
}

export type Vaa = {
  bytes: Uint8Array
  guardianSetIndex: number
  signatures: { guardianIndex: number; signature: Uint8Array }[] // 65-byte r,s,v
  body: Uint8Array
  timestamp: number
  nonce: number
  emitterChain: number
  emitterAddress: Uint8Array
  sequence: bigint
  consistencyLevel: number
  payload: Uint8Array
  hash: Uint8Array // keccak256(body): used for Solana PDAs
  digest: Uint8Array // keccak256(keccak256(body)): what guardians sign
  transfer?: TokenTransfer
}

export function parseVaa(bytes: Uint8Array): Vaa {
  if (bytes[0] !== 1) throw new Error(`unsupported VAA version ${bytes[0]}`)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nsig = bytes[5]
  const signatures = []
  for (let i = 0; i < nsig; i++) {
    const o = 6 + i * 66
    signatures.push({ guardianIndex: bytes[o], signature: bytes.slice(o + 1, o + 66) })
  }
  const body = bytes.slice(6 + nsig * 66)
  const bv = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const hash = keccak_256(body)
  const vaa: Vaa = {
    bytes,
    guardianSetIndex: dv.getUint32(1),
    signatures,
    body,
    timestamp: bv.getUint32(0),
    nonce: bv.getUint32(4),
    emitterChain: bv.getUint16(8),
    emitterAddress: body.slice(10, 42),
    sequence: bv.getBigUint64(42),
    consistencyLevel: body[50],
    payload: body.slice(51),
    hash,
    digest: keccak_256(hash),
  }
  const p = vaa.payload
  if ((p[0] === 1 || p[0] === 3) && p.length >= 133) {
    vaa.transfer = {
      payloadType: p[0],
      amount: be(p.slice(1, 33)),
      tokenAddress: p.slice(33, 65),
      tokenChain: (p[65] << 8) | p[66],
      to: p.slice(67, 99),
      toChain: (p[99] << 8) | p[100],
      fee: p[0] === 1 ? be(p.slice(101, 133)) : 0n,
    }
  }
  return vaa
}

async function getJson(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json()
}

// The Wormhole sequence an Algorand token-bridge transfer emitted, from the core contract's inner-txn log.
export function sequenceFromAlgorandTxn(confirmed: { innerTxns?: { logs?: Uint8Array[] }[] }): bigint {
  const log = confirmed.innerTxns?.flatMap((t) => t.logs ?? [])[0]
  if (!log || log.length !== 8) throw new Error('no Wormhole sequence log in this transaction')
  return be(log)
}

// Signed VAA for a message, or undefined while the guardians have not signed it yet.
export async function fetchVaa(chain: number, emitterHex: string, sequence: bigint): Promise<Uint8Array | undefined> {
  const r = await fetch(`${WORMHOLESCAN_API}/vaas/${chain}/${emitterHex}/${sequence}`)
  if (r.status === 404) return undefined
  if (!r.ok) throw new Error(`Wormholescan: HTTP ${r.status}`)
  const j = await r.json()
  return j?.data?.vaa ? b64ToBytes(j.data.vaa) : undefined
}
export const fetchAlgorandVaa = (sequence: bigint) => fetchVaa(ALGORAND.chainId, ALGORAND.tokenBridgeEmitter, sequence)

export type Operation = {
  id: string // chain/emitter/sequence
  vaa?: Uint8Array
  targetStatus?: string
  targetTx?: string // the redeem transaction, once Wormholescan has seen it
  symbol?: string
  amount?: string // human-readable, in the token's own decimals
}

const toOperation = (op: any): Operation | undefined =>
  op && {
    id: op.id,
    vaa: op.vaa?.raw ? b64ToBytes(op.vaa.raw) : undefined,
    targetStatus: op.targetChain?.status,
    targetTx: op.targetChain?.transaction?.txHash || undefined,
    symbol: op.data?.symbol || undefined,
    amount: op.data?.tokenAmount || undefined,
  }

// Look up a transfer by its source transaction (any chain Wormholescan indexes).
export async function fetchOperation(txHash: string) {
  const j = await getJson(`${WORMHOLESCAN_API}/operations?txHash=${encodeURIComponent(txHash)}`)
  return toOperation(j?.operations?.[0])
}

// Look up a transfer by its Wormhole id (chain/emitter/sequence), or undefined if Wormholescan does not know it.
export async function fetchOperationById(id: string) {
  const r = await fetch(`${WORMHOLESCAN_API}/operations/${id}`)
  if (r.status === 404) return undefined
  if (!r.ok) throw new Error(`Wormholescan: HTTP ${r.status}`)
  return toOperation(await r.json())
}
