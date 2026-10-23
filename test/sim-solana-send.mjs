// Simulate a native-SOL transfer to Algorand on Solana mainnet (no signing checks, nothing sent) and check the
// sequence written into the message account against the token bridge emitter's sequence counter.
import algosdk from 'algosdk'
import { Connection, PublicKey } from '../src/lib/solana-tx.ts'
import * as sol from '../src/lib/solana.ts'
const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const owner = new PublicKey(process.argv[2])
const target = algosdk.decodeAddress(process.argv[3]).publicKey
const plan = await sol.planSolanaTransfer(conn, owner, undefined, 10_000_000n, target, 8)
const seqPda = PublicKey.findProgramAddressSync([new TextEncoder().encode('Sequence'), PublicKey.findProgramAddressSync([new TextEncoder().encode('emitter')], sol.TOKEN_BRIDGE)[0].toBytes()], sol.CORE)[0]
const before = Buffer.from((await conn.getAccountInfo(seqPda)).data).readBigUInt64LE(0)
const wire = Buffer.from(plan.tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
const res = await conn.rpc('simulateTransaction', [wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [plan.message.publicKey.toBase58(), owner.toBase58()] } }])
const v = res.value
console.log(`err=${JSON.stringify(v.err)} units=${v.unitsConsumed}`)
console.log((v.logs ?? []).filter((l) => /Sequence|success|failed|Error|insufficient/i.test(l)).map((l) => '  ' + l).join('\n'))
if (!v.err) {
  const msg = Buffer.from(v.accounts[0].data[0], 'base64')
  console.log(`emitter sequence counter before: ${before}; message account sequence (offset 49): ${msg.readBigUInt64LE(49)}; payload type ${msg[msg.length - 133]}`)
  console.log(`message account emitter chain ${msg.readUInt16LE(57)} (expect 1); wallet lamports after: ${v.accounts[1].lamports / 1e9}`)
}
