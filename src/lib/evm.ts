// EVM side: redeem a token-bridge VAA through an injected wallet (EIP-6963 / EIP-1193). No dependencies.
import { keccak_256 } from '@noble/hashes/sha3'
import { hex, type Chain, type Vaa } from './wormhole.ts'
import { errorText } from './format.ts'

export type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<any> }
export type EvmWallet = { name: string; icon?: string; rdns?: string; topic?: string; provider: Eip1193 } // topic: WalletConnect session

const selector = (sig: string) => hex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4))
const SEL = {
  completeTransfer: selector('completeTransfer(bytes)'),
  completeTransferAndUnwrapETH: selector('completeTransferAndUnwrapETH(bytes)'),
  isTransferCompleted: selector('isTransferCompleted(bytes32)'),
  WETH: selector('WETH()'),
}

// ABI encoding of a single `bytes` argument.
const encodeBytesArg = (b: Uint8Array) => {
  const word = (n: number) => n.toString(16).padStart(64, '0')
  const padded = hex(b).padEnd(Math.ceil(b.length / 32) * 64, '0')
  return word(32) + word(b.length) + padded
}

// Wallets announced via EIP-6963, falling back to window.ethereum.
export function discoverEvmWallets(timeoutMs = 300): Promise<EvmWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, EvmWallet>()
    const onAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent).detail ?? {}
      if (info?.uuid && provider) found.set(info.uuid, { name: info.name, icon: info.icon, rdns: info.rdns, provider })
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
      const list = [...found.values()]
      const legacy = (window as any).ethereum as Eip1193 | undefined
      if (!list.length && legacy) list.push({ name: 'Browser wallet', provider: legacy })
      resolve(list)
    }, timeoutMs)
  })
}

export async function connectEvm(w: EvmWallet): Promise<string> {
  const [account] = await w.provider.request({ method: 'eth_requestAccounts' })
  if (!account) throw new Error('wallet returned no account')
  return account
}

export async function ensureEvmChain(w: EvmWallet, chain: Chain) {
  const want = '0x' + chain.evmChainId!.toString(16)
  const current = await w.provider.request({ method: 'eth_chainId' })
  if (current?.toLowerCase() === want) return
  try {
    await w.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] })
  } catch (e: any) {
    if (e?.code === 4902) throw new Error(`${chain.name} is not configured in this wallet; add it there first`)
    throw e
  }
}

const ethCall = (w: EvmWallet, to: string, data: string, from?: string) =>
  w.provider.request({ method: 'eth_call', params: [{ to, data, ...(from ? { from } : {}) }, 'latest'] })

export async function isRedeemedOnEvm(w: EvmWallet, chain: Chain, vaa: Vaa) {
  const r = await ethCall(w, chain.tokenBridge, '0x' + SEL.isTransferCompleted + hex(vaa.digest))
  return BigInt(r) === 1n
}

// completeTransferAndUnwrapETH when the token is this chain's wrapped gas token, so the recipient gets native coin.
export async function redeemCalldata(w: EvmWallet, chain: Chain, vaa: Vaa) {
  const t = vaa.transfer!
  let unwrap = false
  if (t.tokenChain === chain.id) {
    const weth = (await ethCall(w, chain.tokenBridge, '0x' + SEL.WETH)).toLowerCase().replace(/^0x/, '')
    unwrap = weth === hex(t.tokenAddress)
  }
  const sel = unwrap ? SEL.completeTransferAndUnwrapETH : SEL.completeTransfer
  return { data: '0x' + sel + encodeBytesArg(vaa.bytes), unwrap }
}

// Simulate with eth_call from the user's account; returns a revert reason or undefined if it would succeed.
export async function simulateEvmRedeem(w: EvmWallet, chain: Chain, from: string, data: string) {
  try {
    await ethCall(w, chain.tokenBridge, data, from)
    return undefined
  } catch (e) {
    return errorText(e)
  }
}

export async function sendEvmRedeem(w: EvmWallet, chain: Chain, from: string, data: string): Promise<string> {
  return w.provider.request({ method: 'eth_sendTransaction', params: [{ from, to: chain.tokenBridge, data }] })
}

export async function waitForEvmReceipt(w: EvmWallet, txHash: string) {
  for (;;) {
    const r = await w.provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (r) {
      if (r.status !== '0x1') throw new Error(`transaction ${txHash} reverted`)
      return r
    }
    await new Promise((res) => setTimeout(res, 3000))
  }
}

// Left-pad a 0x address to the 32-byte form the token bridge uses.
export function evmAddressTo32(address: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('not a valid 0x address')
  const out = new Uint8Array(32)
  out.set(Uint8Array.from(address.slice(2).match(/../g)!, (x) => parseInt(x, 16)), 12)
  return out
}

// ---- Unwrapping the chain's wrapped gas token (WETH, WAVAX, WBNB, WPOL, ...) with WETH9's withdraw(uint256) ----

export async function wrappedGasToken(w: EvmWallet, chain: Chain, owner: string) {
  const weth = '0x' + (await ethCall(w, chain.tokenBridge, '0x' + SEL.WETH)).slice(-40)
  if (/^0x0+$/.test(weth)) return undefined
  const bal = await ethCall(w, weth, '0x' + selector('balanceOf(address)') + owner.toLowerCase().replace(/^0x/, '').padStart(64, '0'))
  return { address: weth, balance: BigInt(bal), symbol: 'W' + chain.nativeSymbol }
}

export const withdrawCalldata = (amount: bigint) => '0x' + selector('withdraw(uint256)') + amount.toString(16).padStart(64, '0')

// ---- Reads without a wallet, through the chain's public RPC ----

export async function rpcCall(chain: Chain, method: string, params: unknown[] = []) {
  if (!chain.rpc) throw new Error(`no public RPC configured for ${chain.name}`)
  const r = await fetch(chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = await r.json()
  if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error })
  return j.result
}

// A read-only stand-in for a wallet, for checks such as isRedeemedOnEvm when no EVM wallet is connected.
export const publicEvmReader = (chain: Chain): EvmWallet => ({
  name: `${chain.name} public RPC`,
  provider: { request: ({ method, params = [] }) => rpcCall(chain, method, params) },
})
