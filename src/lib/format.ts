export const formatUnits = (amount: bigint, decimals: number) => {
  if (decimals === 0) return amount.toString()
  const s = amount.toString().padStart(decimals + 1, '0')
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, '')
}

export const parseUnits = (value: string, decimals: number) => {
  const v = value.trim()
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('enter a number')
  const [whole, frac = ''] = v.split('.')
  if (frac.length > decimals) throw new Error(`at most ${decimals} decimal places`)
  return BigInt(whole + frac.padEnd(decimals, '0'))
}

export const short = (s: string, n = 6) => (s.length > 2 * n + 3 ? `${s.slice(0, n)}...${s.slice(-n)}` : s)

// A readable message from whatever was thrown. Wallets and RPCs reject with Error objects, but also with plain
// JSON-RPC error objects ({ code, message, data }), nested errors or strings; String() of an object would show
// "[object Object]". A request the user turned down in the wallet gets one plain sentence.
const REJECTED = new Set([4001, 5000]) // EIP-1193 "user rejected", WalletConnect USER_REJECTED
export function errorText(e: unknown): string {
  if (REJECTED.has(Number((e as any)?.code ?? (e as any)?.error?.code))) return 'The request was rejected in the wallet.'
  return messageOf(e, 0) || 'Something went wrong, and the wallet or service gave no reason.'
}

function messageOf(e: unknown, depth: number): string {
  if (e == null || depth > 3) return ''
  if (typeof e === 'string') return e.trim()
  if (typeof e !== 'object') return String(e)
  const o = e as Record<string, any>
  // An EVM node's revert reason sits in data.message under a generic outer message ("Internal JSON-RPC error").
  for (const m of [o.data?.message, o.message, o.reason, o.details]) if (typeof m === 'string' && m.trim()) return m.trim()
  for (const inner of [o.error, o.cause]) {
    const m = messageOf(inner, depth + 1)
    if (m) return m
  }
  try {
    const json = JSON.stringify(e)
    if (json && json !== '{}') return json.length > 300 ? `${json.slice(0, 300)}...` : json
  } catch {
    // circular or not serializable
  }
  return ''
}

export const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// Base58 (Bitcoin alphabet), for Solana addresses, signatures and blockhashes.
export const base58 = (bytes: Uint8Array) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = bytes.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n)
  let s = ''
  while (n > 0n) {
    s = A[Number(n % 58n)] + s
    n /= 58n
  }
  for (const x of bytes) {
    if (x !== 0) break
    s = '1' + s
  }
  return s
}

export const base58Decode = (s: string) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const c of s) {
    const i = A.indexOf(c)
    if (i < 0) throw new Error('invalid base58')
    n = n * 58n + BigInt(i)
  }
  const bytes: number[] = []
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn))
    n >>= 8n
  }
  for (const c of s) {
    if (c !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}
