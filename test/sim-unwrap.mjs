// Simulate wrap-then-unwrap in one transaction for any wallet with SOL (nothing sent): wrap 0.01 SOL into the
// wallet's wSOL account, then unwrap 0.004 (partial) and, separately, everything (full).
// Usage: node test/sim-unwrap.mjs <wallet address>
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '../src/lib/solana-tx.ts'
import * as sol from '../src/lib/solana.ts'
const conn = new Connection(process.env.SOLANA_RPC ?? 'https://solana-rpc.publicnode.com', 'confirmed')
const owner = new PublicKey(process.argv[2])
const ata = sol.associatedTokenAddress(owner, sol.NATIVE_MINT)
const existing = (await sol.tokenAccountAmount(conn, ata)) ?? 0n
const wrap = 10_000_000n
const syncNative = new TransactionInstruction({ programId: sol.TOKEN_PROGRAM, keys: [{ pubkey: ata, isSigner: false, isWritable: true }], data: Uint8Array.of(17) })
const rent = await conn.getMinimumBalanceForRentExemption(165)
for (const amount of [4_000_000n, existing + wrap]) {
  const temp = Keypair.generate()
  const tx = new Transaction().add(
    sol.createAtaIdempotentInstruction(owner, ata, owner, sol.NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: wrap }),
    syncNative,
    ...sol.unwrapSolInstructions(owner, ata, amount, existing + wrap, temp, rent),
  )
  tx.feePayer = owner
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  const wire = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
  const r = (await conn.rpc('simulateTransaction', [wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [ata.toBase58()] } }])).value
  const after = r.accounts?.[0]
  const left = after && after.lamports > 0 ? Buffer.from(after.data[0], 'base64').readBigUInt64LE(64) : undefined
  console.log(`unwrap ${amount} of ${existing + wrap}: err=${JSON.stringify(r.err)} -> wSOL account ${left === undefined ? 'closed' : 'holds ' + left}`)
}
