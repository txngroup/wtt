// Oracle test for src/lib/solana-tx.ts, the hand-written replacement for @solana/web3.js: build the same
// keys, PDAs, instructions and transactions with both and diff them byte for byte. Also checks that our signatures
// verify under web3.js and that both RPC clients read the same chain state.
// Run from test/sdk after npm ci: node compare-solana-tx.mjs
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import * as w3 from '@solana/web3.js'
import * as ours from '../../src/lib/solana-tx.ts'
import * as sol from '../../src/lib/solana.ts'
import { parseVaa, fromHex } from '../../src/lib/wormhole.ts'

const RPC = 'https://api.mainnet-beta.solana.com'
const w3conn = new w3.Connection(RPC, 'confirmed')
const conn = new ours.Connection(RPC, 'confirmed')
const hex = (b) => Buffer.from(b).toString('hex')
const toW3 = (k) => new w3.PublicKey(k.toBytes())
const ixToW3 = (ix) => new w3.TransactionInstruction({
  programId: toW3(ix.programId),
  keys: ix.keys.map((k) => ({ ...k, pubkey: toW3(k.pubkey) })),
  data: Buffer.from(ix.data),
})

let failures = 0
const check = (label, a, b) => {
  if (a === b) return console.log(`OK    ${label}`)
  failures++
  console.log(`DIFF  ${label}\n  web3: ${a}\n  ours: ${b}`)
}

// Keys: base58 both ways, for random keys and keys with leading zero bytes.
let keyDiffs = 0
for (let i = 0; i < 2000; i++) {
  const b = randomBytes(32)
  if (i % 4 === 0) b.fill(0, 0, i % 7)
  const a = new w3.PublicKey(b).toBase58()
  if (a !== new ours.PublicKey(b).toBase58() || hex(new ours.PublicKey(a).toBytes()) !== hex(b)) keyDiffs++
}
check('base58 encode/decode of 2000 keys', 0, keyDiffs)

// PDAs: random seeds against random programs, which exercises bumps below 255 and the on-curve test.
let pdaDiffs = 0
let lowBumps = 0
for (let i = 0; i < 3000; i++) {
  const program = randomBytes(32)
  const seeds = Array.from({ length: 1 + (i % 3) }, (_, j) => randomBytes(1 + ((i + j) % 32)))
  const [a, an] = w3.PublicKey.findProgramAddressSync(seeds, new w3.PublicKey(program))
  const [b, bn] = ours.PublicKey.findProgramAddressSync(seeds, new ours.PublicKey(program))
  if (a.toBase58() !== b.toBase58() || an !== bn) pdaDiffs++
  if (an < 255) lowBumps++
}
check(`findProgramAddressSync for 3000 random seed sets (${lowBumps} needed a bump below 255)`, 0, pdaDiffs)

// Fixed constants.
for (const name of ['SYSVAR_CLOCK_PUBKEY', 'SYSVAR_INSTRUCTIONS_PUBKEY', 'SYSVAR_RENT_PUBKEY']) check(name, w3[name].toBase58(), ours[name].toBase58())
check('Secp256k1Program.programId', w3.Secp256k1Program.programId.toBase58(), ours.Secp256k1Program.programId.toBase58())
check('SystemProgram.programId', w3.SystemProgram.programId.toBase58(), ours.SystemProgram.programId.toBase58())

// System program instructions.
const a1 = w3.Keypair.generate().publicKey
const a2 = w3.Keypair.generate().publicKey
const normIx = (ix) => JSON.stringify({ p: ix.programId.toBase58(), k: ix.keys.map((k) => `${k.pubkey.toBase58()}:${+k.isSigner}${+k.isWritable}`), d: hex(ix.data) })
check('SystemProgram.createAccount',
  normIx(w3.SystemProgram.createAccount({ fromPubkey: a1, newAccountPubkey: a2, lamports: 2039280, space: 165, programId: toW3(sol.TOKEN_PROGRAM) })),
  normIx(ours.SystemProgram.createAccount({ fromPubkey: new ours.PublicKey(a1.toBytes()), newAccountPubkey: new ours.PublicKey(a2.toBytes()), lamports: 2039280, space: 165, programId: sol.TOKEN_PROGRAM })))
check('SystemProgram.transfer',
  normIx(w3.SystemProgram.transfer({ fromPubkey: a1, toPubkey: a2, lamports: 123456789012n })),
  normIx(ours.SystemProgram.transfer({ fromPubkey: new ours.PublicKey(a1.toBytes()), toPubkey: new ours.PublicKey(a2.toBytes()), lamports: 123456789012n })))

// Whole transactions: every plan the app builds, compiled by both libraries from the same instructions.
const { blockhash } = await w3conn.getLatestBlockhash('confirmed')
function compareTx(label, tx) {
  const ref = new w3.Transaction().add(...tx.instructions.map(ixToW3))
  ref.feePayer = toW3(tx.feePayer)
  ref.recentBlockhash = tx.recentBlockhash
  check(`${label}: message`, hex(ref.serializeMessage()), hex(tx.compile().message))
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const parsed = w3.Transaction.from(Buffer.from(wire))
  check(`${label}: signer order`, ref.compileMessage().accountKeys.slice(0, ref.compileMessage().header.numRequiredSignatures).join(','), tx.compile().signers.join(','))
  check(`${label}: our ${parsed.signatures.filter((s) => s.signature).length} partial signature(s) verify under web3.js`, true, parsed.verifySignatures(false))
  check(`${label}: web3.js re-serializes our wire bytes unchanged`, hex(wire), hex(parsed.serialize({ requireAllSignatures: false, verifySignatures: false })))
}
// The owner of the recipient account in test/fixtures/sol-to-solana.vaa.hex, a public transfer (see fixtures.json).
const fixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/fixtures.json', import.meta.url), 'utf8'))
const owner = new ours.PublicKey(fixtures['sol-to-solana'].recipientOwner)
const vaa = parseVaa(fromHex(fs.readFileSync(new URL('../fixtures/sol-to-solana.vaa.hex', import.meta.url), 'utf8').trim()))

// Redeem: verify_signatures pairs signed by the signature-set key, post_vaa, complete + ATA + close. The real VAA was
// redeemed long ago, so build the pieces planRedeem would build rather than calling it.
const keys = await sol.guardianKeys(conn, vaa.guardianSetIndex)
const sigSet = ours.Keypair.generate()
const verifyIxs = sol.verifySignaturesInstructions(owner, vaa, keys, sigSet.publicKey)
const newTx = (...ixs) => {
  const tx = new ours.Transaction().add(...ixs)
  tx.feePayer = owner
  tx.recentBlockhash = blockhash
  return tx
}
for (let i = 0; i < verifyIxs.length; i += 2) {
  const tx = newTx(verifyIxs[i], verifyIxs[i + 1])
  tx.partialSign(sigSet)
  compareTx(`redeem verify ${i / 2}`, tx)
}
compareTx('redeem post_vaa', newTx(sol.postVaaInstruction(owner, vaa, sigSet.publicKey)))
const mint = sol.destinationMint(vaa)
const ata = sol.associatedTokenAddress(owner, mint)
compareTx('redeem complete + unwrap', newTx(sol.createAtaIdempotentInstruction(owner, ata, owner, mint), sol.completeTransferInstruction(owner, vaa), sol.closeAccountInstruction(ata, owner, owner)))

// Send to Algorand: SOL (temp wSOL account, two extra signers) and an SPL token, as planSolanaTransfer builds them.
const target = new Uint8Array(32).fill(7)
compareTx('send SOL', (await sol.planSolanaTransfer(conn, owner, undefined, 10_000_000n, target, 8)).tx)
compareTx('send USDC', (await sol.planSolanaTransfer(conn, owner, new ours.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 1234n, target, 8)).tx)

// Unwrap wSOL, partial (temp account signer) and full.
const temp = ours.Keypair.generate()
const wsolAta = sol.associatedTokenAddress(owner, sol.NATIVE_MINT)
const partial = newTx(...sol.unwrapSolInstructions(owner, wsolAta, 4_000_000n, 10_000_000n, temp, 2039280))
partial.partialSign(temp)
compareTx('unwrap partial', partial)
compareTx('unwrap full', newTx(...sol.unwrapSolInstructions(owner, wsolAta, 10_000_000n, 10_000_000n, temp, 2039280)))

// A WalletConnect wallet that answers with its signature only: our addSignatureToWire against web3.js addSignature.
const wallet = w3.Keypair.generate()
const walletKey = new ours.PublicKey(wallet.publicKey.toBytes())
const extra = ours.Keypair.generate()
const wcTx = new ours.Transaction().add(ours.SystemProgram.createAccount({ fromPubkey: walletKey, newAccountPubkey: extra.publicKey, lamports: 1, space: 0, programId: ours.SystemProgram.programId }))
wcTx.feePayer = walletKey
wcTx.recentBlockhash = blockhash
wcTx.partialSign(extra)
const unsigned = wcTx.serialize({ requireAllSignatures: false, verifySignatures: false })
const ref = w3.Transaction.from(Buffer.from(unsigned))
const signature = (await import('@noble/curves/ed25519')).ed25519.sign(ref.serializeMessage(), wallet.secretKey.slice(0, 32))
ref.addSignature(wallet.publicKey, Buffer.from(signature))
check('WalletConnect: signature added to the wire', hex(ref.serialize()), hex(ours.addSignatureToWire(unsigned, walletKey, signature)))
let rejected = false
try {
  ours.addSignatureToWire(unsigned, walletKey, new Uint8Array(64).fill(1))
} catch {
  rejected = true
}
check('WalletConnect: a bad signature is rejected', true, rejected)

// A WalletConnect wallet that answers solana_signAllTransactions with whole signed transactions: our check accepts
// each one signed by web3.js, and refuses one with a changed message or a missing signature.
const fullySigned = Buffer.from(ref.serialize())
check('WalletConnect batch: a fully signed transaction is accepted', hex(fullySigned), hex(ours.checkSignedWire(unsigned, fullySigned)))
const refuses = (label, f) => {
  let threw = false
  try { f() } catch { threw = true }
  check(`WalletConnect batch: ${label} is refused`, true, threw)
}
const changed = w3.Transaction.from(Buffer.from(unsigned))
changed.recentBlockhash = (await w3conn.getLatestBlockhash('finalized')).blockhash
changed.signatures = changed.signatures.map((s) => ({ ...s, signature: null }))
changed.partialSign(wallet)
refuses('a transaction with a changed message', () => ours.checkSignedWire(unsigned, Buffer.from(changed.serialize({ requireAllSignatures: false }))))
refuses('a transaction missing a signature', () => ours.checkSignedWire(unsigned, unsigned))

// RPC: the same reads through both clients.
const guardianSet = sol.guardianSetKey(vaa.guardianSetIndex)
const [ai1, ai2] = [await w3conn.getAccountInfo(toW3(guardianSet)), await conn.getAccountInfo(guardianSet)]
check('getAccountInfo data', hex(ai1.data), hex(ai2.data))
check('getAccountInfo owner', ai1.owner.toBase58(), ai2.owner.toBase58())
check('getAccountInfo of a missing account', String(await w3conn.getAccountInfo(w3.Keypair.generate().publicKey)), String(await conn.getAccountInfo(ours.Keypair.generate().publicKey)))
check('getMinimumBalanceForRentExemption(165)', String(await w3conn.getMinimumBalanceForRentExemption(165)), String(await conn.getMinimumBalanceForRentExemption(165)))
check('mintDecimals(USDC)', '6', String(await sol.mintDecimals(conn, new ours.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'))))
check('mintDecimals(a non-mint account) is undefined', 'undefined', String(await sol.mintDecimals(conn, guardianSet)))
const sim = await conn.simulateTransaction((await sol.planSolanaTransfer(conn, owner, undefined, 1_000n, target, 8)).tx, [owner])
console.log(`simulate send SOL: err=${JSON.stringify(sim.value.err)} accounts=${sim.value.accounts?.length} units=${sim.value.unitsConsumed}`)

console.log(failures ? `\n${failures} DIFFERENCES` : '\nSOLANA-TX MATCHES @solana/web3.js')
process.exit(failures ? 1 : 0)
