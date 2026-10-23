// The part of @solana/web3.js this app uses, hand-written on @noble/curves and @noble/hashes: public keys and
// program-derived addresses, throwaway keypairs, legacy transactions, and a JSON-RPC client over fetch.
// Names and behaviour follow web3.js 1.x, and the account order matches its compileMessage, so the serialized
// transactions are byte-for-byte the same (test/sdk/compare-solana-tx.mjs checks this).
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import { base58, base58Decode, fromBase64, toBase64 } from './format.ts'

const PACKET_DATA_SIZE = 1232 // largest serialized transaction the network accepts

type PublicKeyLike = { toBytes(): Uint8Array }

export class PublicKey {
  readonly bytes: Uint8Array
  constructor(value: string | Uint8Array | PublicKeyLike) {
    const b = typeof value === 'string' ? base58Decode(value) : value instanceof Uint8Array ? value : value.toBytes()
    if (b.length !== 32) throw new Error(`invalid public key: ${typeof value === 'string' ? value : `${b.length} bytes`}`)
    this.bytes = Uint8Array.from(b)
  }
  toBytes() {
    return Uint8Array.from(this.bytes)
  }
  toBase58() {
    return base58(this.bytes)
  }
  toString() {
    return this.toBase58()
  }
  toJSON() {
    return this.toBase58()
  }
  equals(other: PublicKeyLike) {
    return sameBytes(this.bytes, other.toBytes())
  }

  // sha256(seeds | program | "ProgramDerivedAddress"), which must not be a valid ed25519 point.
  static createProgramAddressSync(seeds: Uint8Array[], program: PublicKeyLike) {
    if (seeds.some((s) => s.length > 32)) throw new Error('Max seed length exceeded')
    const hash = sha256(concat(...seeds, program.toBytes(), new TextEncoder().encode('ProgramDerivedAddress')))
    if (isOnCurve(hash)) throw new Error('Invalid seeds, address must fall off the curve')
    return new PublicKey(hash)
  }

  // The first address off the curve, trying bump seeds 255 down to 0.
  static findProgramAddressSync(seeds: Uint8Array[], program: PublicKeyLike): [PublicKey, number] {
    for (let bump = 255; bump > 0; bump--) {
      try {
        return [PublicKey.createProgramAddressSync([...seeds, Uint8Array.of(bump)], program), bump]
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('Invalid seeds')) throw e
      }
    }
    throw new Error('Unable to find a viable program address nonce')
  }
}

const isOnCurve = (bytes: Uint8Array) => {
  try {
    ed25519.ExtendedPoint.fromHex(bytes)
    return true
  } catch {
    return false
  }
}

// A one-off signer: the signature-set account of a redeem, the message account of a send, a temporary wSOL account.
export class Keypair {
  readonly publicKey: PublicKey
  readonly #secret: Uint8Array
  private constructor(secret: Uint8Array) {
    this.#secret = secret
    this.publicKey = new PublicKey(ed25519.getPublicKey(secret))
  }
  static generate() {
    return new Keypair(ed25519.utils.randomPrivateKey())
  }
  sign(message: Uint8Array) {
    return ed25519.sign(message, this.#secret)
  }
}

export type AccountMeta = { pubkey: PublicKeyLike & { toBase58(): string }; isSigner: boolean; isWritable: boolean }

export class TransactionInstruction {
  programId: PublicKey
  keys: AccountMeta[]
  data: Uint8Array
  constructor(o: { programId: PublicKey; keys: AccountMeta[]; data: Uint8Array }) {
    this.programId = o.programId
    this.keys = o.keys
    this.data = o.data
  }
}

export const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111')
export const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111')
export const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111')
export const Secp256k1Program = { programId: new PublicKey('KeccakSecp256k11111111111111111111111111111') }

// System program CreateAccount (0) and Transfer (2): u32 instruction index, then u64 fields (little-endian).
export const SystemProgram = {
  programId: new PublicKey('11111111111111111111111111111111'),
  createAccount(p: { fromPubkey: PublicKey; newAccountPubkey: PublicKey; lamports: number; space: number; programId: PublicKey }) {
    const data = new Uint8Array(52)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 0, true)
    dv.setBigUint64(4, BigInt(p.lamports), true)
    dv.setBigUint64(12, BigInt(p.space), true)
    data.set(p.programId.toBytes(), 20)
    return new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: p.fromPubkey, isSigner: true, isWritable: true },
        { pubkey: p.newAccountPubkey, isSigner: true, isWritable: true },
      ],
      data,
    })
  },
  transfer(p: { fromPubkey: PublicKey; toPubkey: PublicKey; lamports: bigint | number }) {
    const data = new Uint8Array(12)
    const dv = new DataView(data.buffer)
    dv.setUint32(0, 2, true)
    dv.setBigUint64(4, BigInt(p.lamports), true)
    return new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: p.fromPubkey, isSigner: true, isWritable: true },
        { pubkey: p.toPubkey, isSigner: false, isWritable: true },
      ],
      data,
    })
  },
}

// Legacy (unversioned) transaction. Signatures are kept per signer and dropped if the message changes after signing.
export class Transaction {
  instructions: TransactionInstruction[] = []
  feePayer?: PublicKey
  recentBlockhash?: string
  private signatures = new Map<string, Uint8Array>()
  private signed?: Uint8Array

  add(...ixs: TransactionInstruction[]) {
    this.instructions.push(...ixs)
    return this
  }

  // The message bytes that signatures cover, and the signer keys in signature order.
  compile() {
    const { message, signers } = compileMessage(this)
    if (this.signed && !sameBytes(this.signed, message)) this.signatures.clear()
    this.signed = message
    return { message, signers }
  }

  partialSign(...signers: Keypair[]) {
    const { message, signers: keys } = this.compile()
    for (const s of signers) {
      if (!keys.some((k) => k.equals(s.publicKey))) throw new Error(`unknown signer: ${s.publicKey.toBase58()}`)
      this.signatures.set(s.publicKey.toBase58(), s.sign(message))
    }
  }

  serialize({ requireAllSignatures = true, verifySignatures = true } = {}) {
    const { message, signers } = this.compile()
    const sigs = signers.map((k) => this.signatures.get(k.toBase58()))
    if (verifySignatures) checkSignatures(message, signers, sigs, requireAllSignatures)
    return wire(message, sigs)
  }
}

// A serialized transaction split into its message, the signer keys and their signature slots (undefined when empty).
function parseWire(tx: Uint8Array) {
  const [count, n] = decodeLength(tx, 0)
  const message = tx.subarray(n + count * 64)
  const required = message[0]
  const [keyCount, m] = decodeLength(message, 3)
  const keys = Array.from({ length: keyCount }, (_, i) => new PublicKey(message.subarray(3 + m + i * 32, 3 + m + (i + 1) * 32)))
  if (count !== required) throw new Error('transaction signature count does not match its message')
  const sigs = Array.from({ length: count }, (_, i) => tx.slice(n + i * 64, n + (i + 1) * 64) as Uint8Array | undefined)
  return { message, signers: keys.slice(0, required), sigs: sigs.map((s) => (s?.some((x) => x !== 0) ? s : undefined)) }
}

// Add one signature to an already serialized transaction (a WalletConnect wallet may answer with the signature
// alone), then require every signature to be present and valid.
export function addSignatureToWire(tx: Uint8Array, signer: PublicKey, signature: Uint8Array) {
  if (signature.length !== 64) throw new Error(`signature has ${signature.length} bytes, not 64`)
  const { message, signers, sigs } = parseWire(tx)
  const index = signers.findIndex((k) => k.equals(signer))
  if (index < 0) throw new Error(`unknown signer: ${signer.toBase58()}`)
  sigs[index] = signature
  checkSignatures(message, signers, sigs, true)
  return wire(message, sigs)
}

// A transaction a wallet returned fully signed: it must be the message the wallet was given, with every signature
// present and valid. A wallet that changed the transaction would also break the signatures the site added itself.
export function checkSignedWire(sent: Uint8Array, signed: Uint8Array) {
  const { message, signers, sigs } = parseWire(signed)
  if (!sameBytes(message, parseWire(sent).message)) throw new Error('the wallet changed the transaction it was asked to sign')
  checkSignatures(message, signers, sigs, true)
  return signed
}

function checkSignatures(message: Uint8Array, signers: PublicKey[], sigs: (Uint8Array | undefined)[], requireAll: boolean) {
  const missing = signers.filter((_, i) => !sigs[i])
  const invalid = signers.filter((k, i) => sigs[i] && !ed25519.verify(sigs[i]!, message, k.toBytes()))
  if (invalid.length || (requireAll && missing.length)) {
    let msg = 'Signature verification failed.'
    if (invalid.length) msg += ` Invalid signature for ${invalid.map((k) => k.toBase58()).join(', ')}.`
    if (requireAll && missing.length) msg += ` Missing signature for ${missing.map((k) => k.toBase58()).join(', ')}.`
    throw new Error(msg)
  }
}

const wire = (message: Uint8Array, sigs: (Uint8Array | undefined)[]) => {
  const out = concat(encodeLength(sigs.length), ...sigs.map((s) => s ?? new Uint8Array(64)), message)
  if (out.length > PACKET_DATA_SIZE) throw new Error(`Transaction too large: ${out.length} > ${PACKET_DATA_SIZE}`)
  return out
}

// web3.js Transaction.compileMessage: merge duplicate accounts, sort signers then writable accounts first (ties by
// base58 string), move the fee payer to the front, then encode header, keys, blockhash and instructions.
function compileMessage(tx: Transaction) {
  if (!tx.recentBlockhash) throw new Error('Transaction recentBlockhash required')
  if (!tx.feePayer) throw new Error('Transaction fee payer required')
  const metas: { key: string; isSigner: boolean; isWritable: boolean }[] = []
  const programIds: string[] = []
  for (const ix of tx.instructions) {
    for (const k of ix.keys) metas.push({ key: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })
    const p = ix.programId.toBase58()
    if (!programIds.includes(p)) programIds.push(p)
  }
  for (const p of programIds) metas.push({ key: p, isSigner: false, isWritable: false })
  const unique: typeof metas = []
  for (const m of metas) {
    const u = unique.find((x) => x.key === m.key)
    if (u) {
      u.isWritable ||= m.isWritable
      u.isSigner ||= m.isSigner
    } else unique.push({ ...m })
  }
  const collation = { localeMatcher: 'best fit', usage: 'sort', sensitivity: 'variant', ignorePunctuation: false, numeric: false, caseFirst: 'lower' } as const
  unique.sort((x, y) =>
    x.isSigner !== y.isSigner ? (x.isSigner ? -1 : 1) : x.isWritable !== y.isWritable ? (x.isWritable ? -1 : 1) : x.key.localeCompare(y.key, 'en', collation),
  )
  const payer = tx.feePayer.toBase58()
  const at = unique.findIndex((x) => x.key === payer)
  if (at >= 0) unique.splice(at, 1)
  unique.unshift({ key: payer, isSigner: true, isWritable: true })

  const keys = unique.map((m) => m.key)
  const header = Uint8Array.of(
    unique.filter((m) => m.isSigner).length,
    unique.filter((m) => m.isSigner && !m.isWritable).length,
    unique.filter((m) => !m.isSigner && !m.isWritable).length,
  )
  const instructions = tx.instructions.map((ix) =>
    concat(
      Uint8Array.of(keys.indexOf(ix.programId.toBase58())),
      encodeLength(ix.keys.length),
      Uint8Array.from(ix.keys.map((k) => keys.indexOf(k.pubkey.toBase58()))),
      encodeLength(ix.data.length),
      ix.data,
    ),
  )
  const message = concat(
    header,
    encodeLength(keys.length),
    ...keys.map((k) => base58Decode(k)),
    new PublicKey(tx.recentBlockhash).toBytes(),
    encodeLength(instructions.length),
    ...instructions,
  )
  const signers = unique.filter((m) => m.isSigner).map((m) => new PublicKey(m.key))
  return { message, signers }
}

// Solana's compact-u16 ("shortvec") length prefix: 7 bits per byte, high bit set on all but the last.
function encodeLength(n: number) {
  const out: number[] = []
  for (;;) {
    const b = n & 0x7f
    n >>= 7
    if (n === 0) return Uint8Array.from([...out, b])
    out.push(b | 0x80)
  }
}

function decodeLength(bytes: Uint8Array, offset: number): [number, number] {
  let len = 0
  for (let size = 0; ; size++) {
    const b = bytes[offset + size]
    len |= (b & 0x7f) << (size * 7)
    if ((b & 0x80) === 0) return [len, size + 1]
  }
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

type Commitment = 'processed' | 'confirmed' | 'finalized'
export type AccountInfo = { data: Uint8Array; owner: PublicKey; lamports: number }
export type SimulationResult = { err: unknown; logs: string[] | null; accounts?: ({ lamports: number } | null)[] | null; unitsConsumed?: number }

// JSON-RPC over fetch, with the method names and result shapes of web3.js's Connection.
export class Connection {
  readonly endpoint: string
  readonly commitment: Commitment
  constructor(endpoint: string, commitment: Commitment = 'confirmed') {
    this.endpoint = endpoint
    this.commitment = commitment
  }

  async rpc(method: string, params: unknown[]): Promise<any> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from ${new URL(this.endpoint).host}`)
    const { result, error } = await res.json()
    if (error) {
      const logs: string[] = error.data?.logs ?? []
      throw new Error(`${method}: ${error.message}${logs.length ? ' ' + logs.slice(-3).join(' ') : ''}`)
    }
    return result
  }

  async getAccountInfo(key: PublicKey, commitment = this.commitment): Promise<AccountInfo | null> {
    const { value } = await this.rpc('getAccountInfo', [key.toBase58(), { encoding: 'base64', commitment }])
    return value && { data: fromBase64(value.data[0]), owner: new PublicKey(value.owner), lamports: value.lamports }
  }

  async getBalance(key: PublicKey): Promise<number> {
    return (await this.rpc('getBalance', [key.toBase58(), { commitment: this.commitment }])).value
  }

  async getMinimumBalanceForRentExemption(size: number): Promise<number> {
    return this.rpc('getMinimumBalanceForRentExemption', [size, { commitment: this.commitment }])
  }

  async getLatestBlockhash(commitment = this.commitment): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return (await this.rpc('getLatestBlockhash', [{ commitment }])).value
  }

  async getSignatureStatuses(signatures: string[]): Promise<{ value: ({ err: unknown; confirmationStatus?: Commitment } | null)[] }> {
    return this.rpc('getSignatureStatuses', [signatures])
  }

  async sendRawTransaction(tx: Uint8Array, opts: { skipPreflight?: boolean; maxRetries?: number } = {}): Promise<string> {
    return this.rpc('sendTransaction', [toBase64(tx), { encoding: 'base64', preflightCommitment: this.commitment, ...opts }])
  }

  // Signatures are not checked, and the RPC swaps in a current blockhash, so unsigned or stale transactions simulate.
  // `includeAccounts` returns those accounts' state after the transaction.
  async simulateTransaction(tx: Transaction, includeAccounts?: PublicKey[]): Promise<{ value: SimulationResult }> {
    const config: Record<string, unknown> = { encoding: 'base64', commitment: this.commitment, sigVerify: false, replaceRecentBlockhash: true }
    if (includeAccounts) config.accounts = { encoding: 'base64', addresses: includeAccounts.map((k) => k.toBase58()) }
    return this.rpc('simulateTransaction', [toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })), config])
  }
}
