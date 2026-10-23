// Oracle test for src/lib/near-tx.ts, the hand-written NEAR transaction encoder: encode every kind of transaction the
// app builds (registration, storage deposit, both redeem calls, sending NEAR and sending a bridge token) with ours and
// with near-api-js 1.1.0, using random keys, nonces and block hashes, and diff the borsh bytes. Reads NEAR mainnet for
// the plans; signs and sends nothing. The bridge calls themselves are checked in test/check-near.ts.
// Run from test/sdk after npm ci: node compare-near.mjs
import { randomBytes } from 'node:crypto'
import nearApi from 'near-api-js'
import BN from 'bn.js'
import * as near from '../../src/lib/near.ts'
import { encodeNearTransaction } from '../../src/lib/near-tx.ts'
import { WORMHOLESCAN_API, b64ToBytes, parseVaa } from '../../src/lib/wormhole.ts'

// A transfer into NEAR, re-addressed to an account the bridge has never seen, so the redeem plan has every step.
const ops = (await (await fetch(`${WORMHOLESCAN_API}/operations?targetChain=15&appId=PORTAL_TOKEN_BRIDGE&pageSize=10`)).json()).operations
const sample = parseVaa(b64ToBytes(ops.find((o) => o.vaa?.raw).vaa.raw))
const newcomer = 'wtt-compare-near-newcomer.near'
const unseen = Uint8Array.from(sample.bytes)
unseen.set([0x77, 0x74, 0x74, 0x21], unseen.length - sample.body.length + 4) // new nonce: a VAA the bridge has not seen
unseen.set(near.accountHash(newcomer), unseen.length - sample.payload.length + 67) // recipient
const redeem = await near.planNearRedeem(newcomer, parseVaa(unseen))
const wrappedAlgo = await near.foreignAsset(8, new Uint8Array(32))
const algorandRecipient = new Uint8Array(32).fill(7)
const txs = [
  ...redeem.txs,
  near.nearTransferTx(15n * 10n ** 23n, algorandRecipient, 8, 0n),
  ...(await near.planWrappedTransfer(newcomer, wrappedAlgo, 500000n, algorandRecipient, 8)),
]
console.log(`transactions: ${txs.map((t) => `${t.receiverId}.${t.actions[0].methodName}`).join(', ')}`)

let failures = 0
let identical = 0
for (const tx of txs) {
  for (let i = 0; i < 4; i++) {
    // Block hashes that start with zero bytes are where base58 handling usually breaks.
    const key = randomBytes(32), hash = randomBytes(32), nonce = BigInt('0x' + randomBytes(7).toString('hex'))
    if (i < 2) hash.fill(0, 0, i + 1)
    const ref = nearApi.transactions.createTransaction(
      newcomer,
      new nearApi.utils.PublicKey({ keyType: 0, data: key }),
      tx.receiverId,
      new BN(nonce.toString()),
      tx.actions.map((a) => nearApi.transactions.functionCall(a.methodName, a.args, new BN(a.gas.toString()), new BN(a.deposit.toString()))),
      hash,
    )
    const a = Buffer.from(ref.encode()).toString('hex')
    const b = Buffer.from(encodeNearTransaction(newcomer, key, nonce, tx, nearApi.utils.serialize.base_encode(hash))).toString('hex')
    if (a === b) identical++
    else {
      failures++
      console.log(`DIFF  ${tx.receiverId}.${tx.actions[0].methodName}\n  near-api-js: ${a}\n  ours:        ${b}`)
    }
  }
}
console.log(`${identical} of ${txs.length * 4} encodings identical`)
console.log(failures ? `\n${failures} DIFFERENCES` : '\nALL NEAR TRANSACTIONS IDENTICAL TO NEAR-API-JS')
process.exit(failures ? 1 : 0)
