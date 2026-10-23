// EVM side of sending to Algorand: token info, wrapAndTransferETH / approve + transferTokens, and the emitted sequence.
// Selectors match the verified BridgeImplementation ABI; calls are dry-run with eth_call before the wallet signs.
import { keccak_256 } from '@noble/hashes/sha3'
import { hex, type Chain } from './wormhole.ts'
import type { EvmWallet } from './evm.ts'
import { errorText } from './format.ts'

const sel = (sig: string) => hex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4))
const word = (n: bigint) => n.toString(16).padStart(64, '0')
const addrWord = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const bytes32 = (b: Uint8Array) => hex(b).padStart(64, '0')
const LOG_MESSAGE_PUBLISHED = hex(keccak_256(new TextEncoder().encode('LogMessagePublished(address,uint64,uint32,bytes,uint8)')))

const call = async (w: EvmWallet, to: string, data: string) =>
  (await w.provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as string
const uintAt = (r: string, i = 0) => BigInt('0x' + (r.replace(/^0x/, '').slice(i * 64, i * 64 + 64) || '0'))
const decodeString = (r: string) => {
  const h = r.replace(/^0x/, '')
  if (h.length === 64) return new TextDecoder().decode(Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16))).replace(/\0+$/, '')
  const len = Number(BigInt('0x' + h.slice(64, 128)))
  return new TextDecoder().decode(Uint8Array.from(h.slice(128, 128 + len * 2).match(/../g) ?? [], (x) => parseInt(x, 16)))
}

export type EvmToken = {
  native: boolean // the chain's gas coin (sent with wrapAndTransferETH)
  address: string // ERC-20 address (WETH for the gas coin)
  symbol: string
  decimals: number
  balance: bigint
  originChain: number // where the token lives natively, as Wormhole sees it
  originAddress: Uint8Array // 32 bytes
}

export async function evmTokenInfo(w: EvmWallet, chain: Chain, owner: string, tokenAddress?: string): Promise<EvmToken> {
  if (!tokenAddress) {
    const weth = '0x' + (await call(w, chain.tokenBridge, '0x' + sel('WETH()'))).slice(-40)
    const balance = BigInt(await w.provider.request({ method: 'eth_getBalance', params: [owner, 'latest'] }))
    return { native: true, address: weth, symbol: chain.nativeSymbol, decimals: 18, balance, originChain: chain.id, originAddress: fromAddr(weth) }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) throw new Error('not a valid token address')
  const [decimals, symbol, balance, wrapped] = await Promise.all([
    call(w, tokenAddress, '0x' + sel('decimals()')).then((r) => Number(uintAt(r))),
    call(w, tokenAddress, '0x' + sel('symbol()')).then(decodeString).catch(() => '?'),
    call(w, tokenAddress, '0x' + sel('balanceOf(address)') + addrWord(owner)).then((r) => uintAt(r)),
    call(w, chain.tokenBridge, '0x' + sel('isWrappedAsset(address)') + addrWord(tokenAddress)).then((r) => uintAt(r) === 1n),
  ])
  let originChain = chain.id
  let originAddress = fromAddr(tokenAddress)
  if (wrapped) {
    // A Wormhole-wrapped token: its origin is recorded in the token contract itself.
    originChain = Number(uintAt(await call(w, tokenAddress, '0x' + sel('chainId()'))))
    const nc = (await call(w, tokenAddress, '0x' + sel('nativeContract()'))).replace(/^0x/, '')
    originAddress = Uint8Array.from(nc.match(/../g)!, (x) => parseInt(x, 16))
  }
  return { native: false, address: tokenAddress, symbol, decimals, balance, originChain, originAddress }
}

const fromAddr = (a: string) => {
  const out = new Uint8Array(32)
  out.set(Uint8Array.from(a.replace(/^0x/, '').match(/../g)!, (x) => parseInt(x, 16)), 12)
  return out
}

// What sending the gas coin costs on top of the amount: the Wormhole message fee, and gas for the bridge call at
// twice the current gas price (wrapAndTransferETH takes about 100-150k gas; 250k leaves room). Rollups (Arbitrum,
// Optimism, Base) also charge for posting the transaction to Ethereum, which the gas price leaves out, so the ETH
// chains keep at least 0.0002 ETH back.
export async function nativeFeeReserve(w: EvmWallet, chain: Chain) {
  const [fee, price] = await Promise.all([
    call(w, chain.core, '0x' + sel('messageFee()')).then((r) => uintAt(r)),
    w.provider.request({ method: 'eth_gasPrice' }).then((r: string) => BigInt(r)),
  ])
  const gas = price * 2n * 250_000n
  const floor = chain.nativeSymbol === 'ETH' ? 200_000_000_000_000n : 0n
  return fee + (gas > floor ? gas : floor)
}

// The bridge only carries 8 decimals; anything finer is refunded (gas coin) or never taken (tokens).
export const truncateTo8 = (amount: bigint, decimals: number) =>
  decimals > 8 ? (amount / 10n ** BigInt(decimals - 8)) * 10n ** BigInt(decimals - 8) : amount

export type EvmTxRequest = { to: string; data: string; value: bigint; label: string }

// The transactions to send, in order: an approve if needed, then the bridge transfer.
export async function buildEvmTransfer(w: EvmWallet, chain: Chain, owner: string, token: EvmToken, amount: bigint, toChain: number, recipient: Uint8Array) {
  const fee = uintAt(await call(w, chain.core, '0x' + sel('messageFee()')))
  const nonce = BigInt(crypto.getRandomValues(new Uint32Array(1))[0])
  const txs: EvmTxRequest[] = []
  if (token.native) {
    txs.push({
      to: chain.tokenBridge,
      data: '0x' + sel('wrapAndTransferETH(uint16,bytes32,uint256,uint32)') + word(BigInt(toChain)) + bytes32(recipient) + word(0n) + word(nonce),
      value: amount + fee,
      label: `Bridge ${token.symbol}`,
    })
    return txs
  }
  const allowance = uintAt(await call(w, token.address, '0x' + sel('allowance(address,address)') + addrWord(owner) + addrWord(chain.tokenBridge)))
  if (allowance < amount) {
    txs.push({ to: token.address, data: '0x' + sel('approve(address,uint256)') + addrWord(chain.tokenBridge) + word(amount), value: 0n, label: `Approve ${token.symbol}` })
  }
  txs.push({
    to: chain.tokenBridge,
    data: '0x' + sel('transferTokens(address,uint256,uint16,bytes32,uint256,uint32)') + addrWord(token.address) + word(amount) + word(BigInt(toChain)) + bytes32(recipient) + word(0n) + word(nonce),
    value: fee,
    label: `Bridge ${token.symbol}`,
  })
  return txs
}

export async function simulateEvmTx(w: EvmWallet, from: string, tx: EvmTxRequest) {
  try {
    await w.provider.request({ method: 'eth_call', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }, 'latest'] })
    return undefined
  } catch (e) {
    return errorText(e)
  }
}

export const sendEvmTx = (w: EvmWallet, from: string, tx: EvmTxRequest): Promise<string> =>
  w.provider.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] })

// Wormhole sequence from the core bridge's LogMessagePublished event emitted for the token bridge.
export function sequenceFromReceipt(chain: Chain, receipt: { logs: { address: string; topics: string[]; data: string }[] }) {
  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === chain.core.toLowerCase() &&
      l.topics[0]?.toLowerCase() === '0x' + LOG_MESSAGE_PUBLISHED &&
      l.topics[1]?.toLowerCase() === '0x' + addrWord(chain.tokenBridge),
  )
  if (!log) throw new Error('no Wormhole message in this transaction')
  return uintAt(log.data, 0)
}

export const evmEmitterHex = (chain: Chain) => addrWord(chain.tokenBridge)
