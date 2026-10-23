// Simulate an Algorand redeem group on mainnet: logic-signature txns really signed, user txns with empty signatures.
// Usage: node test/sim-algorand-redeem.ts <wormholescan op id>
import algosdk from 'algosdk'
import { algod } from '../src/lib/algorand.ts'
import { buildAlgorandRedeem, isRedeemedOnAlgorand } from '../src/lib/algorand-redeem.ts'
import { parseVaa, b64ToBytes } from '../src/lib/wormhole.ts'
const op = await (await fetch(`https://api.wormholescan.io/api/v1/operations/${process.argv[2]}`)).json()
const v = parseVaa(b64ToBytes(op.vaa.raw))
const receiver = algosdk.encodeAddress(v.transfer!.to)
console.log('already redeemed (bit check):', await isRedeemedOnAlgorand(v))
const r = await buildAlgorandRedeem(receiver, v)
const auth = (await algod.accountInformation(receiver).exclude('all').do()).authAddr
const signed = r.txns.map((txn, i) => {
  const lsig = r.lsigs.get(i)
  return lsig ? new algosdk.SignedTransaction({ txn, lsig: lsig.lsig }) : new algosdk.SignedTransaction({ txn, sgnr: auth })
})
const req = new algosdk.modelsv2.SimulateRequest({
  txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: signed })],
  allowEmptySignatures: true,
})
const g = (await algod.simulateTransactions(req).do()).txnGroups[0]
console.log(`group of ${r.txns.length}: failedAt=${JSON.stringify(g.failedAt)} message=${g.failureMessage ?? 'none'}`)
g.txnResults.forEach((t, i) => console.log(`  [${i}] ${r.lsigs.has(i) ? 'lsig' : 'user'} ${t.txnResult.txn.txn.type} app=${t.txnResult.txn.txn.applicationCall?.appIndex ?? ''} budget=${t.appBudgetConsumed ?? ''}`))
