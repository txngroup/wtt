// Simulate the hand-rolled verify_signatures transactions for a real VAA on mainnet (no signing, no sending).
// Usage: node test/sim-verify.mjs <vaa.hex> [fee payer]
// The fee payer needs a little SOL; it defaults to the recipient of test/fixtures/sol-to-solana.vaa.hex.
import fs from 'node:fs'
import { Connection, Keypair, PublicKey, Transaction } from '../src/lib/solana-tx.ts'
import * as ours from '../src/lib/solana.ts'
import { parseVaa, fromHex } from '../src/lib/wormhole.ts'
const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/fixtures.json', import.meta.url), 'utf8'))
const payer = new PublicKey(process.argv[3] ?? fixtures['sol-to-solana'].recipientOwner)
const v = parseVaa(fromHex(fs.readFileSync(process.argv[2], 'utf8').trim()))
const keys = await ours.guardianKeys(conn, v.guardianSetIndex)
console.log(`guardian set ${v.guardianSetIndex}: ${keys.length} keys; VAA has ${v.signatures.length} signatures`)
const sigSet = Keypair.generate()
const ixs = ours.verifySignaturesInstructions(payer, v, keys, sigSet.publicKey)
for (let i = 0; i < ixs.length; i += 2) {
  const tx = new Transaction().add(ixs[i], ixs[i + 1])
  tx.feePayer = payer
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  const res = await conn.rpc('simulateTransaction', [Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }])
  const val = res.value
  console.log(`verify tx ${i / 2}: err=${JSON.stringify(val.err)} units=${val.unitsConsumed}`)
  console.log('   ' + (val.logs ?? []).filter((l) => /invoke|success|failed|Error/i.test(l)).join('\n   '))
}
