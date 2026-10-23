// Build the same transfer with our builder and print a canonical field summary for diffing against the SDK's.
import algosdk from 'algosdk'
import { listWrappedAssets, buildTransfer, describeTransfer, simulateUnsigned } from '../src/lib/algorand.ts'
const [sender, assetId, amount, toChain, toHex] = process.argv.slice(2)
const asset = (await listWrappedAssets(sender)).find((a) => a.assetId === BigInt(assetId))
if (!asset) throw new Error('sender does not hold that wrapped asset')
console.error('origin chain', asset.originChain, 'origin address', Buffer.from(asset.originAddress).toString('hex'))
const txns = await buildTransfer({ sender, asset, amount: BigInt(amount), toChain: Number(toChain), to: Uint8Array.from(Buffer.from(toHex, 'hex')) })
console.error('describe', describeTransfer(txns))
console.error('simulate failure:', (await simulateUnsigned(txns)) ?? 'none')
for (const t of txns) {
  const e = algosdk.decodeObj(algosdk.encodeUnsignedTransaction(t)) as Record<string, unknown>
  for (const k of ['fv', 'lv', 'gh', 'grp', 'gen', 'note']) delete e[k]
  console.log(JSON.stringify(e, (_, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : typeof v === 'bigint' ? v.toString() : v)))
}
