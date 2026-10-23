// NEAR transactions in their borsh wire format, hand-written: the part of near-api-js the app needs, function calls
// only. Byte for byte the same as near-api-js (test/sdk/compare-near.mjs checks this).
import { base58Decode } from './format.ts'
import type { NearTx } from './near.ts'

class Writer {
  private parts: number[] = []
  u8(n: number) {
    this.parts.push(n & 0xff)
  }
  u32(n: number) {
    for (let i = 0; i < 4; i++) this.u8(n >>> (8 * i))
  }
  // Little-endian unsigned integer of `bytes` bytes (8 for u64, 16 for u128).
  uint(n: bigint, bytes: number) {
    if (n < 0n || n >= 1n << BigInt(8 * bytes)) throw new Error(`value out of range for u${8 * bytes}`)
    for (let i = 0; i < bytes; i++) this.u8(Number((n >> BigInt(8 * i)) & 0xffn))
  }
  fixed(b: Uint8Array) {
    for (const x of b) this.u8(x)
  }
  bytes(b: Uint8Array) {
    this.u32(b.length)
    this.fixed(b)
  }
  string(s: string) {
    this.bytes(new TextEncoder().encode(s))
  }
  done() {
    return Uint8Array.from(this.parts)
  }
}

// An unsigned transaction: signer, ed25519 public key, nonce, receiver, recent block hash, and its function calls
// (action variant 2). Wallets that fill in their own key and nonce still expect both fields to be present.
export function encodeNearTransaction(signerId: string, publicKey: Uint8Array, nonce: bigint, tx: NearTx, blockHash: string) {
  const hash = base58Decode(blockHash)
  if (publicKey.length !== 32 || hash.length !== 32) throw new Error('public key and block hash must be 32 bytes')
  const w = new Writer()
  w.string(signerId)
  w.u8(0) // ed25519
  w.fixed(publicKey)
  w.uint(nonce, 8)
  w.string(tx.receiverId)
  w.fixed(hash)
  w.u32(tx.actions.length)
  for (const a of tx.actions) {
    w.u8(2) // FunctionCall
    w.string(a.methodName)
    w.bytes(new TextEncoder().encode(JSON.stringify(a.args)))
    w.uint(a.gas, 8)
    w.uint(a.deposit, 16)
  }
  return w.done()
}
