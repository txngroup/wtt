// Solana side of the Wormhole Token Bridge, hand-rolled on ./solana-tx.ts (a small subset of @solana/web3.js):
// verify guardian signatures, post the VAA, and complete the transfer (native or wrapped).
// Instruction layouts are checked byte-for-byte against @wormhole-foundation/sdk-solana-* in test/sdk/compare-solana.mjs.
import {
  Connection,
  Keypair,
  PublicKey,
  Secp256k1Program,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from './solana-tx.ts'
import type { Vaa } from './wormhole.ts'

export const SOLANA_RPC = 'https://solana-rpc.publicnode.com' // accepts browser (CORS) requests
export const CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth')
export const TOKEN_BRIDGE = new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb')
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')
export const SOLANA_CHAIN_ID = 1

const enc = (s: string) => new TextEncoder().encode(s)
const u16be = (n: number) => Uint8Array.of(n >> 8, n & 0xff)
const u32be = (n: number) => Uint8Array.of(n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
const u64be = (n: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n)
  return b
}
const pda = (seeds: Uint8Array[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0]
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength)

// PDAs
export const guardianSetKey = (index: number) => pda([enc('GuardianSet'), u32be(index)], CORE)
export const bridgeKey = () => pda([enc('Bridge')], CORE)
export const postedVaaKey = (hash: Uint8Array) => pda([enc('PostedVAA'), hash], CORE)
const tbConfigKey = () => pda([enc('config')], TOKEN_BRIDGE)
const claimKey = (v: Vaa) => pda([v.emitterAddress, u16be(v.emitterChain), u64be(v.sequence)], TOKEN_BRIDGE)
const endpointKey = (chain: number, emitter: Uint8Array) => pda([u16be(chain), emitter], TOKEN_BRIDGE)
const custodyKey = (mint: PublicKey) => pda([mint.toBytes()], TOKEN_BRIDGE)
const custodySignerKey = () => pda([enc('custody_signer')], TOKEN_BRIDGE)
const mintSignerKey = () => pda([enc('mint_signer')], TOKEN_BRIDGE)
export const wrappedMintKey = (tokenChain: number, tokenAddress: Uint8Array) => pda([enc('wrapped'), u16be(tokenChain), tokenAddress], TOKEN_BRIDGE)
const wrappedMetaKey = (mint: PublicKey) => pda([enc('meta'), mint.toBytes()], TOKEN_BRIDGE)
export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) => pda([owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()], ATA_PROGRAM)

// The SPL mint a transfer pays out on Solana: the original mint if it came from Solana, else the bridge's wrapped mint.
export const destinationMint = (v: Vaa) => {
  const t = v.transfer!
  return t.tokenChain === SOLANA_CHAIN_ID ? new PublicKey(t.tokenAddress) : wrappedMintKey(t.tokenChain, t.tokenAddress)
}

// Guardian set account: index u32, keys Vec<[u8; 20]>, creation_time u32, expiration_time u32 (little-endian borsh).
export async function guardianKeys(conn: Connection, index: number): Promise<Uint8Array[]> {
  const info = await conn.getAccountInfo(guardianSetKey(index))
  if (!info) throw new Error(`guardian set ${index} not found`)
  const d = info.data
  const n = view(d).getUint32(4, true)
  return Array.from({ length: n }, (_, i) => Uint8Array.from(d.subarray(8 + i * 20, 28 + i * 20)))
}

// When the core program stops accepting a guardian set's signatures, in Unix seconds, or 0 for the current set.
export async function guardianSetExpiryOnSolana(conn: Connection, index: number) {
  const info = await conn.getAccountInfo(guardianSetKey(index))
  if (!info) return 0
  const n = view(info.data).getUint32(4, true)
  return view(info.data).getUint32(8 + n * 20 + 4, true)
}

// Whether the VAA was already verified and posted, so the redeem only has to complete it from the posted copy.
export const isPostedOnSolana = async (conn: Connection, vaa: Vaa) => (await conn.getAccountInfo(postedVaaKey(vaa.hash))) !== null

// secp256k1 precompile data: count, then per signature 11 bytes of offsets, then [sig(65) | eth key(20)]..., then message.
export function secp256k1Data(signatures: Uint8Array[], keys: Uint8Array[], message: Uint8Array) {
  const n = signatures.length
  const dataLoc = 1 + n * 11
  const msgOffset = dataLoc + n * 85
  const out = new Uint8Array(msgOffset + 32)
  const dv = new DataView(out.buffer)
  out[0] = n
  signatures.forEach((sig, i) => {
    const sigOffset = dataLoc + 85 * i
    dv.setUint16(1 + i * 11, sigOffset, true)
    out[3 + i * 11] = 0
    dv.setUint16(4 + i * 11, sigOffset + 65, true)
    out[6 + i * 11] = 0
    dv.setUint16(7 + i * 11, msgOffset, true)
    dv.setUint16(9 + i * 11, 32, true)
    out[10 + i * 11] = 0
    out.set(sig, sigOffset)
    out.set(keys[i], sigOffset + 65)
  })
  out.set(message, msgOffset)
  return out
}

// Pairs of [secp256k1, verify_signatures] instructions, 7 signatures per pair.
export function verifySignaturesInstructions(payer: PublicKey, vaa: Vaa, keys: Uint8Array[], signatureSet: PublicKey) {
  const ixs: TransactionInstruction[] = []
  for (let start = 0; start < vaa.signatures.length; start += 7) {
    const batch = vaa.signatures.slice(start, start + 7)
    const status = new Int8Array(19).fill(-1)
    batch.forEach((s, j) => (status[s.guardianIndex] = j))
    ixs.push(
      new TransactionInstruction({
        programId: Secp256k1Program.programId,
        keys: [],
        data: secp256k1Data(batch.map((s) => s.signature), batch.map((s) => keys[s.guardianIndex]), vaa.hash),
      }),
      new TransactionInstruction({
        programId: CORE,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: guardianSetKey(vaa.guardianSetIndex), isSigner: false, isWritable: false },
          { pubkey: signatureSet, isSigner: true, isWritable: true },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Uint8Array.from([7, ...new Uint8Array(status.buffer)]),
      }),
    )
  }
  return ixs
}

// post_vaa: version u8, guardian_set_index u32, timestamp u32, nonce u32, emitter_chain u16, emitter [32],
// sequence u64, consistency_level u8, payload Vec<u8> (borsh, little-endian).
export function postVaaInstruction(payer: PublicKey, vaa: Vaa, signatureSet: PublicKey) {
  const p = vaa.payload
  const data = new Uint8Array(1 + 1 + 4 + 4 + 4 + 2 + 32 + 8 + 1 + 4 + p.length)
  const dv = new DataView(data.buffer)
  let o = 0
  data[o++] = 2
  data[o++] = 1
  dv.setUint32(o, vaa.guardianSetIndex, true); o += 4
  dv.setUint32(o, vaa.timestamp, true); o += 4
  dv.setUint32(o, vaa.nonce, true); o += 4
  dv.setUint16(o, vaa.emitterChain, true); o += 2
  data.set(vaa.emitterAddress, o); o += 32
  dv.setBigUint64(o, vaa.sequence, true); o += 8
  data[o++] = vaa.consistencyLevel
  dv.setUint32(o, p.length, true); o += 4
  data.set(p, o)
  return new TransactionInstruction({
    programId: CORE,
    keys: [
      { pubkey: guardianSetKey(vaa.guardianSetIndex), isSigner: false, isWritable: false },
      { pubkey: bridgeKey(), isSigner: false, isWritable: false },
      { pubkey: signatureSet, isSigner: false, isWritable: false },
      { pubkey: postedVaaKey(vaa.hash), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

// complete_native (2) for tokens that originate on Solana, complete_wrapped (3) for everything else.
export function completeTransferInstruction(payer: PublicKey, vaa: Vaa) {
  const t = vaa.transfer!
  if (t.toChain !== SOLANA_CHAIN_ID) throw new Error('VAA is not addressed to Solana')
  const to = new PublicKey(t.to)
  const common = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: tbConfigKey(), isSigner: false, isWritable: false },
    { pubkey: postedVaaKey(vaa.hash), isSigner: false, isWritable: false },
    { pubkey: claimKey(vaa), isSigner: false, isWritable: true },
    { pubkey: endpointKey(vaa.emitterChain, vaa.emitterAddress), isSigner: false, isWritable: false },
    { pubkey: to, isSigner: false, isWritable: true },
    { pubkey: to, isSigner: false, isWritable: true }, // fee recipient: the recipient itself (no relayer)
  ]
  const tail = [
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: CORE, isSigner: false, isWritable: false },
  ]
  if (t.tokenChain === SOLANA_CHAIN_ID) {
    const mint = new PublicKey(t.tokenAddress)
    return new TransactionInstruction({
      programId: TOKEN_BRIDGE,
      keys: [
        ...common,
        { pubkey: custodyKey(mint), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: custodySignerKey(), isSigner: false, isWritable: false },
        // The SDK (and the redeems that worked) mark rent writable here; the runtime demotes sysvars anyway.
        { ...tail[0], isWritable: true },
        ...tail.slice(1),
      ],
      data: Uint8Array.of(2),
    })
  }
  const mint = wrappedMintKey(t.tokenChain, t.tokenAddress)
  return new TransactionInstruction({
    programId: TOKEN_BRIDGE,
    keys: [
      ...common,
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: wrappedMetaKey(mint), isSigner: false, isWritable: false },
      { pubkey: mintSignerKey(), isSigner: false, isWritable: false },
      ...tail,
    ],
    data: Uint8Array.of(3),
  })
}

// Associated token account creation (idempotent variant) and SPL CloseAccount.
export const createAtaIdempotentInstruction = (payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) =>
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  })

export const closeAccountInstruction = (account: PublicKey, destination: PublicKey, owner: PublicKey) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.of(9),
  })

export type RedeemPlan = {
  verify: { tx: Transaction; signatureSet: Keypair }[] // already partially signed by the signature-set keypair
  post?: Transaction
  complete: Transaction
  recipientAta: PublicKey
  mint: PublicKey
  unwrapsSol: boolean
}

// Build every transaction needed to redeem a transfer VAA, paid and signed by `owner` (who must own the recipient ATA).
export async function planRedeem(conn: Connection, owner: PublicKey, vaa: Vaa): Promise<RedeemPlan> {
  const t = vaa.transfer
  if (!t || t.payloadType !== 1) throw new Error('only plain token transfers (payload 1) are supported')
  const mint = destinationMint(vaa)
  const recipientAta = associatedTokenAddress(owner, mint)
  if (!new PublicKey(t.to).equals(recipientAta)) {
    throw new Error(`this transfer pays ${new PublicKey(t.to).toBase58()}, which is not the connected wallet's token account ${recipientAta.toBase58()}`)
  }
  const { blockhash } = await conn.getLatestBlockhash('confirmed')
  const newTx = (...ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs)
    tx.feePayer = owner
    tx.recentBlockhash = blockhash
    return tx
  }
  const verify: RedeemPlan['verify'] = []
  let post: Transaction | undefined
  if (!(await isPostedOnSolana(conn, vaa))) {
    const keys = await guardianKeys(conn, vaa.guardianSetIndex)
    const signatureSet = Keypair.generate()
    const ixs = verifySignaturesInstructions(owner, vaa, keys, signatureSet.publicKey)
    for (let i = 0; i < ixs.length; i += 2) {
      const tx = newTx(ixs[i], ixs[i + 1])
      tx.partialSign(signatureSet)
      verify.push({ tx, signatureSet })
    }
    post = newTx(postVaaInstruction(owner, vaa, signatureSet.publicKey))
  }
  const unwrapsSol = mint.equals(NATIVE_MINT)
  const complete = newTx(
    createAtaIdempotentInstruction(owner, recipientAta, owner, mint),
    completeTransferInstruction(owner, vaa),
    ...(unwrapsSol ? [closeAccountInstruction(recipientAta, owner, owner)] : []),
  )
  return { verify, post, complete, recipientAta, mint, unwrapsSol }
}

export async function isRedeemedOnSolana(conn: Connection, vaa: Vaa) {
  return (await conn.getAccountInfo(claimKey(vaa))) !== null
}

// ---- Sending from Solana (to Algorand or any chain) ----

const emitterKey = () => pda([enc('emitter')], TOKEN_BRIDGE)
const sequenceKey = (emitter: PublicKey) => pda([enc('Sequence'), emitter.toBytes()], CORE)
const feeCollectorKey = () => pda([enc('fee_collector')], CORE)
const authoritySignerKey = () => pda([enc('authority_signer')], TOKEN_BRIDGE)

// transfer_native (5) / transfer_wrapped (4) data: nonce u32, amount u64, fee u64, target [32], target_chain u16 (LE).
function transferData(discriminator: number, nonce: number, amount: bigint, target: Uint8Array, targetChain: number) {
  const data = new Uint8Array(1 + 4 + 8 + 8 + 32 + 2)
  const dv = new DataView(data.buffer)
  data[0] = discriminator
  dv.setUint32(1, nonce, true)
  dv.setBigUint64(5, amount, true)
  dv.setBigUint64(13, 0n, true) // relayer fee
  data.set(target, 21)
  dv.setUint16(53, targetChain, true)
  return data
}

const sendTail = (payer: PublicKey, message: PublicKey) => [
  { pubkey: bridgeKey(), isSigner: false, isWritable: true },
  { pubkey: message, isSigner: true, isWritable: true },
  { pubkey: emitterKey(), isSigner: false, isWritable: false },
  { pubkey: sequenceKey(emitterKey()), isSigner: false, isWritable: true },
  { pubkey: feeCollectorKey(), isSigner: false, isWritable: true },
  { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
  { pubkey: CORE, isSigner: false, isWritable: false },
]

export function transferNativeInstruction(payer: PublicKey, message: PublicKey, from: PublicKey, mint: PublicKey, amount: bigint, target: Uint8Array, targetChain: number, nonce = 0) {
  return new TransactionInstruction({
    programId: TOKEN_BRIDGE,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: tbConfigKey(), isSigner: false, isWritable: false },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: custodyKey(mint), isSigner: false, isWritable: true },
      { pubkey: authoritySignerKey(), isSigner: false, isWritable: false },
      { pubkey: custodySignerKey(), isSigner: false, isWritable: false },
      ...sendTail(payer, message),
    ],
    data: transferData(5, nonce, amount, target, targetChain),
  })
}

export function transferWrappedInstruction(payer: PublicKey, message: PublicKey, from: PublicKey, fromOwner: PublicKey, tokenChain: number, tokenAddress: Uint8Array, amount: bigint, target: Uint8Array, targetChain: number, nonce = 0) {
  const mint = wrappedMintKey(tokenChain, tokenAddress)
  return new TransactionInstruction({
    programId: TOKEN_BRIDGE,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: tbConfigKey(), isSigner: false, isWritable: false },
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: fromOwner, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: wrappedMetaKey(mint), isSigner: false, isWritable: false },
      { pubkey: authoritySignerKey(), isSigner: false, isWritable: false },
      ...sendTail(payer, message),
    ],
    data: transferData(4, nonce, amount, target, targetChain),
  })
}

// SPL Approve (4): let the bridge's authority signer move `amount` out of `account`.
export const approveAuthoritySignerInstruction = (account: PublicKey, owner: PublicKey, amount: bigint) => {
  const data = new Uint8Array(9)
  data[0] = 4
  new DataView(data.buffer).setBigUint64(1, amount, true)
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: authoritySignerKey(), isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  })
}

// SPL InitializeAccount (1) of a fresh wSOL account owned by `owner`.
const initializeAccountInstruction = (account: PublicKey, mint: PublicKey, owner: PublicKey) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  })

export type SolanaSendPlan = { tx: Transaction; message: Keypair; extraSigners: Keypair[] }

// One transaction that bridges SOL (via a temporary wSOL account), a Solana-native SPL token, or a wrapped token.
// `token` undefined means native SOL; amounts are in the token's own base units (lamports for SOL).
export async function planSolanaTransfer(conn: Connection, owner: PublicKey, token: PublicKey | undefined, amount: bigint, target: Uint8Array, targetChain: number): Promise<SolanaSendPlan> {
  const message = Keypair.generate()
  const ixs: TransactionInstruction[] = []
  const extraSigners: Keypair[] = [message]
  if (!token) {
    const temp = Keypair.generate()
    extraSigners.push(temp)
    const rent = await conn.getMinimumBalanceForRentExemption(165)
    ixs.push(
      SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: temp.publicKey, lamports: rent, space: 165, programId: TOKEN_PROGRAM }),
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: temp.publicKey, lamports: amount }),
      initializeAccountInstruction(temp.publicKey, NATIVE_MINT, owner),
      approveAuthoritySignerInstruction(temp.publicKey, owner, amount),
      transferNativeInstruction(owner, message.publicKey, temp.publicKey, NATIVE_MINT, amount, target, targetChain),
      closeAccountInstruction(temp.publicKey, owner, owner),
    )
  } else {
    const from = associatedTokenAddress(owner, token)
    const meta = await wrappedMetaOf(conn, token)
    ixs.push(approveAuthoritySignerInstruction(from, owner, amount))
    ixs.push(
      meta
        ? transferWrappedInstruction(owner, message.publicKey, from, owner, meta.chain, meta.address, amount, target, targetChain)
        : transferNativeInstruction(owner, message.publicKey, from, token, amount, target, targetChain),
    )
  }
  const tx = new Transaction().add(...ixs)
  tx.feePayer = owner
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
  tx.partialSign(...extraSigners)
  return { tx, message, extraSigners }
}

// What sending SOL costs on top of the amount, in lamports: rent for the temporary wSOL account (returned in the same
// transaction, but needed while it runs) and for the bridge's message account (228 bytes: a 95-byte header and the
// 133-byte transfer payload), the minimum balance that keeps the wallet's own account open, and fees.
export async function solSendReserve(conn: Connection) {
  const rents = await Promise.all([165, 228, 0].map((size) => conn.getMinimumBalanceForRentExemption(size)))
  return BigInt(rents.reduce((a, b) => a + b, 0) + 100_000)
}

// Wrapped-asset metadata account: chain u16 LE, token_address [32], original_decimals u8. Undefined if not wrapped.
export async function wrappedMetaOf(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(wrappedMetaKey(mint))
  if (!info) return undefined
  return { chain: view(info.data).getUint16(0, true), address: Uint8Array.from(info.data.subarray(2, 34)), decimals: info.data[34] }
}

// The sequence a Solana token-bridge transfer emitted, from the posted message account (sequence u64 LE at offset 49).
export async function sequenceFromMessage(conn: Connection, message: PublicKey) {
  const info = await conn.getAccountInfo(message, 'confirmed')
  if (!info) throw new Error('message account not found')
  return view(info.data).getBigUint64(49, true)
}

export const solanaEmitterHex = () => Array.from(emitterKey().toBytes(), (x) => x.toString(16).padStart(2, '0')).join('')

// ---- Unwrapping wSOL ----

// SPL Transfer (3): move `amount` from one token account to another.
export const splTransferInstruction = (source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint) => {
  const data = new Uint8Array(9)
  data[0] = 3
  new DataView(data.buffer).setBigUint64(1, amount, true)
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  })
}

// Instructions to unwrap `amount` lamports of wSOL from `ata`. Unwrapping the whole balance closes the wSOL account
// (its rent comes back too); a partial unwrap moves the amount into a temporary account and closes that.
export function unwrapSolInstructions(owner: PublicKey, ata: PublicKey, amount: bigint, balance: bigint, temp: Keypair, rent: number) {
  if (amount >= balance) return [closeAccountInstruction(ata, owner, owner)]
  if (amount <= 0n) throw new Error('enter an amount above zero')
  return [
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: temp.publicKey, lamports: rent, space: 165, programId: TOKEN_PROGRAM }),
    initializeAccountInstruction(temp.publicKey, NATIVE_MINT, owner),
    splTransferInstruction(ata, temp.publicKey, owner, amount),
    closeAccountInstruction(temp.publicKey, owner, owner),
  ]
}

// Unwrap `amount` lamports of wSOL (all of it if undefined or >= the balance).
export async function planUnwrapSol(conn: Connection, owner: PublicKey, amount?: bigint) {
  const ata = associatedTokenAddress(owner, NATIVE_MINT)
  const balance = await tokenAccountAmount(conn, ata)
  if (balance === undefined) throw new Error('this wallet has no wSOL account')
  const amt = amount === undefined || amount > balance ? balance : amount
  const temp = Keypair.generate()
  const ixs = unwrapSolInstructions(owner, ata, amt, balance, temp, await conn.getMinimumBalanceForRentExemption(165))
  const full = ixs.length === 1
  const tx = new Transaction().add(...ixs)
  tx.feePayer = owner
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
  if (!full) tx.partialSign(temp)
  return { tx, balance, amount: amt, full, ata }
}

// SPL token account balance read from the account bytes (amount: u64 LE at offset 64), or undefined if the account
// does not exist. Public RPCs refuse getTokenAccountBalance ("indexed" request) but serve plain getAccountInfo.
export async function tokenAccountAmount(conn: Connection, account: PublicKey): Promise<bigint | undefined> {
  const info = await conn.getAccountInfo(account)
  if (!info) return undefined
  if (!info.owner.equals(TOKEN_PROGRAM) || info.data.length < 72) throw new Error(`${account.toBase58()} is not an SPL token account`)
  return view(info.data).getBigUint64(64, true)
}

// SPL mint decimals (u8 at offset 44, after the mint authority option and the supply), or undefined if the account
// is not a classic SPL token mint.
export async function mintDecimals(conn: Connection, mint: PublicKey): Promise<number | undefined> {
  const info = await conn.getAccountInfo(mint)
  if (!info || !info.owner.equals(TOKEN_PROGRAM) || info.data.length !== 82) return undefined
  return info.data[44]
}
