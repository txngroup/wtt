// Oracle test: build every Solana redeem instruction with the official Wormhole SDK and with the hand-rolled
// src/lib/solana.ts, for real VAAs plus a synthetic wrapped-token VAA, and diff them.
// Run from test/sdk after npm ci: node compare-solana.mjs
import fs from 'node:fs'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferInstruction } from '@solana/spl-token'
import { deserialize } from '@wormhole-foundation/sdk-definitions'
import { utils as coreUtils } from '@wormhole-foundation/sdk-solana-core'
import { createCompleteTransferNativeInstruction, createCompleteTransferWrappedInstruction, createTransferNativeInstruction, createTransferWrappedInstruction, createApproveAuthoritySignerInstruction } from '@wormhole-foundation/sdk-solana-tokenbridge'
import * as ours from '../../src/lib/solana.ts'
import { parseVaa, fromHex } from '../../src/lib/wormhole.ts'

const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const CORE = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth'
const TB = 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb'
// The owner of the recipient account in test/fixtures/sol-to-solana.vaa.hex, a public transfer (see fixtures.json).
const fixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/fixtures.json', import.meta.url), 'utf8'))
const payer = new PublicKey(fixtures['sol-to-solana'].recipientOwner)
const signatureSet = Keypair.generate().publicKey
// ours returns its own PublicKey type (solana-tx.ts); the SDK wants web3.js keys.
const w3 = (k) => new PublicKey(k.toBytes())

const norm = (ix) => ({
  program: ix.programId.toBase58(),
  keys: ix.keys.map((k) => `${k.pubkey.toBase58()}:${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`),
  data: Buffer.from(ix.data).toString('hex'),
})
let failures = 0
const check = (label, a, b) => {
  const [x, y] = [JSON.stringify(norm(a)), JSON.stringify(norm(b))]
  if (x === y) console.log(`OK    ${label}`)
  else {
    failures++
    console.log(`DIFF  ${label}\n  sdk:  ${x}\n  ours: ${y}`)
  }
}

// A synthetic VAA: same signatures/body framing, but the payload says token chain 6 (WAVAX) -> Solana, to the payer's ATA.
function withPayload(vaaBytes, tokenChain, tokenAddress, toChain, to) {
  const v = parseVaa(vaaBytes)
  const p = Uint8Array.from(v.payload)
  p.set(tokenAddress, 33)
  p[65] = tokenChain >> 8; p[66] = tokenChain & 0xff
  p.set(to, 67)
  p[99] = toChain >> 8; p[100] = toChain & 0xff
  const out = Uint8Array.from(vaaBytes)
  out.set(p, vaaBytes.length - p.length)
  return out
}

const cases = [['native SOL (real VAA, seq 18250)', fromHex(fs.readFileSync(new URL('../fixtures/sol-to-solana.vaa.hex', import.meta.url), 'utf8').trim())]]
const wavaxAddr = fromHex('000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7')
const wrappedMint = ours.wrappedMintKey(6, wavaxAddr)
const synthetic = withPayload(cases[0][1], 6, wavaxAddr, 1, ours.associatedTokenAddress(payer, wrappedMint).toBytes())
cases.push(['wrapped WAVAX on Solana (synthetic payload)', synthetic])

for (const [label, bytes] of cases) {
  console.log(`\n## ${label}`)
  const sdkVaa = deserialize('TokenBridge:Transfer', bytes)
  const v = parseVaa(bytes)
  console.log(`hash matches SDK: ${Buffer.from(v.hash).equals(Buffer.from(sdkVaa.hash))}`)

  const sdkVerify = await coreUtils.createVerifySignaturesInstructions(conn, CORE, payer, sdkVaa, signatureSet)
  const keys = await ours.guardianKeys(conn, v.guardianSetIndex)
  const ourVerify = ours.verifySignaturesInstructions(payer, v, keys, signatureSet)
  console.log(`verify instruction count: sdk ${sdkVerify.length}, ours ${ourVerify.length}`)
  sdkVerify.forEach((ix, i) => check(`verify[${i}] ${i % 2 ? 'verify_signatures' : 'secp256k1'}`, ix, ourVerify[i]))

  check('post_vaa', coreUtils.createPostVaaInstruction(conn, CORE, payer, sdkVaa, signatureSet), ours.postVaaInstruction(payer, v, signatureSet))

  const sdkComplete = v.transfer.tokenChain === 1
    ? createCompleteTransferNativeInstruction(conn, TB, CORE, payer, sdkVaa, undefined, w3(ours.TOKEN_PROGRAM))
    : createCompleteTransferWrappedInstruction(conn, TB, CORE, payer, sdkVaa, undefined)
  check(v.transfer.tokenChain === 1 ? 'complete_native' : 'complete_wrapped', sdkComplete, ours.completeTransferInstruction(payer, v))

  const mint = ours.destinationMint(v)
  const ata = ours.associatedTokenAddress(payer, mint)
  console.log(`recipient in VAA is the payer's ATA: ${new PublicKey(v.transfer.to).equals(w3(ata))}`)
  check('create ATA (idempotent)', createAssociatedTokenAccountIdempotentInstruction(payer, w3(ata), payer, w3(mint)), ours.createAtaIdempotentInstruction(payer, ata, payer, mint))
  check('close account', createCloseAccountInstruction(w3(ata), payer, payer), ours.closeAccountInstruction(ata, payer, payer))
}
// Sending from Solana to Algorand: transfer_native (SOL and a native SPL token), transfer_wrapped (wrapped ALGO).
console.log('\n## sending to Algorand')
const message = Keypair.generate().publicKey
const algoTarget = Buffer.alloc(32, 7)
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const usdcAta = ours.associatedTokenAddress(payer, usdcMint)
check('transfer_native (USDC)',
  createTransferNativeInstruction(conn, TB, CORE, payer, message, w3(usdcAta), usdcMint, w3(ours.TOKEN_PROGRAM), 0, 1234n, 0n, algoTarget, 8),
  ours.transferNativeInstruction(payer, message, usdcAta, usdcMint, 1234n, algoTarget, 8))
check('transfer_native (wSOL temp account)',
  createTransferNativeInstruction(conn, TB, CORE, payer, message, signatureSet, w3(ours.NATIVE_MINT), w3(ours.TOKEN_PROGRAM), 0, 5000n, 0n, algoTarget, 8),
  ours.transferNativeInstruction(payer, message, signatureSet, ours.NATIVE_MINT, 5000n, algoTarget, 8))
const algoMint = ours.wrappedMintKey(8, new Uint8Array(32))
const algoAta = ours.associatedTokenAddress(payer, algoMint)
check('transfer_wrapped (wrapped ALGO)',
  createTransferWrappedInstruction(conn, TB, CORE, payer, message, w3(algoAta), payer, 8, new Uint8Array(32), w3(ours.TOKEN_PROGRAM), 0, 777n, 0n, algoTarget, 8),
  ours.transferWrappedInstruction(payer, message, algoAta, payer, 8, new Uint8Array(32), 777n, algoTarget, 8))
check('approve authority signer', createApproveAuthoritySignerInstruction(TB, w3(usdcAta), payer, 1234n, w3(ours.TOKEN_PROGRAM)), ours.approveAuthoritySignerInstruction(usdcAta, payer, 1234n))
check('spl transfer (partial unwrap)', createTransferInstruction(w3(usdcAta), signatureSet, payer, 4242n), ours.splTransferInstruction(usdcAta, signatureSet, payer, 4242n))
console.log(failures ? `\n${failures} DIFFERENCES` : '\nALL INSTRUCTIONS IDENTICAL TO THE SDK')
process.exit(failures ? 1 : 0)
