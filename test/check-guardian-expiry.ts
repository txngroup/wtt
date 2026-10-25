// The Redeem page's expired-signature check against mainnet, with three transfers out of Algorand signed by guardian
// sets 4, 6 and 7. For each, it asks every destination chain when that set's signatures stopped being accepted, then
// simulates a redeem on Ethereum and Algorand to show that the chains do refuse expired signatures. Last, a set 6
// transfer to Solana that was posted there before the set expired, which the check lets through.
// Usage: node test/check-guardian-expiry.ts
import algosdk from 'algosdk'
import { algod } from '../src/lib/algorand.ts'
import { buildAlgorandRedeem } from '../src/lib/algorand-redeem.ts'
import { signaturesExpired } from '../src/lib/activity.ts'
import { publicEvmReader, redeemCalldata, simulateEvmRedeem } from '../src/lib/evm.ts'
import { ALGORAND, CHAINS, b64ToBytes, chainById, chainName, parseVaa } from '../src/lib/wormhole.ts'

const SEQUENCES = [18000, 18701, 19033] // guardian sets 4, 6 and 7; the last two went to Ethereum
const vaaBytes = async (seq: number) =>
  b64ToBytes((await (await fetch(`https://api.wormholescan.io/api/v1/vaas/8/${ALGORAND.tokenBridgeEmitter}/${seq}`)).json()).data.vaa)
const day = (t: number | undefined) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'accepted')

console.log('## When each destination stopped accepting the signatures')
for (const seq of SEQUENCES) {
  const bytes = await vaaBytes(seq)
  const row: string[] = []
  for (const to of [ALGORAND.chainId, ...CHAINS.map((c) => c.id)]) {
    const v = parseVaa(bytes)
    v.transfer!.toChain = to // the check reads only the destination and the guardian set
    const result = chainById(to)?.platform === 'near' ? 'not checked' : await signaturesExpired(v).then(day, (e) => `could not check (${e.cause?.code ?? e.message})`)
    row.push(`${chainName(to)}: ${result}`)
  }
  console.log(`  ${seq}, set ${parseVaa(bytes).guardianSetIndex}:\n    ${row.join('\n    ')}`)
}

console.log('## Ethereum redeem simulation (expect "guardian set has expired" for sets 4 and 6)')
const eth = chainById(2)!
for (const seq of SEQUENCES) {
  const v = parseVaa(await vaaBytes(seq))
  const { data } = await redeemCalldata(publicEvmReader(eth), eth, v)
  console.log(`  ${seq}, set ${v.guardianSetIndex}: ${(await simulateEvmRedeem(publicEvmReader(eth), eth, '0x1111111111111111111111111111111111111111', data)) ?? 'would succeed'}`)
}

// The group is built as if the transfer paid the fee payer on Algorand. The signed bytes are unchanged, so the
// signature checks and verifyVAA are real, and completeTransfer then fails because the transfer goes elsewhere.
console.log('## Algorand redeem simulation (expect sets 4 and 6 to fail in verifyVAA, set 7 only in completeTransfer)')
const rich = await (await fetch('https://mainnet-idx.algonode.cloud/v2/accounts?currency-greater-than=100000000000&limit=5&exclude=all')).json()
const payer: string = rich.accounts.find((a: any) => !a['auth-addr'] && a.address !== 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA').address
for (const seq of SEQUENCES) {
  const v = parseVaa(await vaaBytes(seq))
  v.transfer!.toChain = ALGORAND.chainId
  v.transfer!.to = algosdk.decodeAddress(payer).publicKey
  const r = await buildAlgorandRedeem(payer, v)
  const txns = r.txns.map((txn, i) => {
    const l = r.lsigs.get(i)
    return l ? new algosdk.SignedTransaction({ txn, lsig: l.lsig }) : new algosdk.SignedTransaction({ txn })
  })
  const req = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns })],
    allowEmptySignatures: true,
    allowUnnamedResources: true,
  })
  const g = (await algod.simulateTransactions(req).do()).txnGroups[0]
  const at = g.failedAt ? r.txns[Number(g.failedAt[0])].applicationCall : undefined
  console.log(`  ${seq}, set ${v.guardianSetIndex}: fails in ${at ? new TextDecoder().decode(at.appArgs[0]) : 'nothing'} (${g.failureMessage?.match(/opcodes=[^;]*;[^;]*/)?.[0] ?? ''})`)
}

console.log('## Solana posted copy (expect posted, and the check to let it through)')
{
  const [{ Connection }, sol] = await Promise.all([import('../src/lib/solana-tx.ts'), import('../src/lib/solana.ts')])
  const v = parseVaa(await vaaBytes(18700)) // set 6, to Solana
  const posted = await sol.isPostedOnSolana(new Connection(sol.SOLANA_RPC, 'confirmed'), v)
  console.log(`  18700, set ${v.guardianSetIndex}: posted ${posted}, expired ${day(await signaturesExpired(v))}`)
}
