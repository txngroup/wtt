// Dry-run evm-send.ts against mainnet with public RPCs standing in for the wallet (read-only eth_call).
// Usage: node test/check-evm-send.ts <evm address with at least 0.01 AVAX> <Ethereum token bridge transfer tx>
import algosdk from 'algosdk'
import { evmTokenInfo, buildEvmTransfer, simulateEvmTx, sequenceFromReceipt, truncateTo8 } from '../src/lib/evm-send.ts'
import { chainById, hex } from '../src/lib/wormhole.ts'
import { algorandAssetForToken } from '../src/lib/algorand-redeem.ts'
import type { EvmWallet } from '../src/lib/evm.ts'
const rpc = (url: string): EvmWallet => ({ name: url, provider: { request: async ({ method, params }) => {
  const j = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
  if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error })
  return j.result
} } })
const [owner, transferTx] = process.argv.slice(2)
if (!owner || !transferTx) throw new Error('usage: node test/check-evm-send.ts <evm address> <ethereum transfer tx>')
const algoRecipient = algosdk.decodeAddress(algosdk.ALGORAND_ZERO_ADDRESS_STRING).publicKey // never sent, only simulated

const avax = chainById(6)!, eth = chainById(2)!
const avaxW = rpc('https://api.avax.network/ext/bc/C/rpc'), ethW = rpc('https://ethereum-rpc.publicnode.com')

console.log('## native AVAX -> Algorand')
const n = await evmTokenInfo(avaxW, avax, owner)
console.log(`  ${n.symbol} balance ${Number(n.balance) / 1e18}, WETH ${n.address}, origin chain ${n.originChain}`)
const algoAsset = await algorandAssetForToken(n.originChain, n.originAddress)
console.log(`  arrives on Algorand as ASA ${algoAsset?.assetId} (expect 893309613, WAVAX)`)
const txs = await buildEvmTransfer(avaxW, avax, owner, n, truncateTo8(10n ** 16n, 18), 8, algoRecipient)
for (const tx of txs) console.log(`  ${tx.label}: ${tx.data.slice(0, 10)} value ${tx.value} -> simulate: ${(await simulateEvmTx(avaxW, owner, tx)) ?? 'would succeed'}`)

console.log('## LINK on Ethereum')
const link = await evmTokenInfo(ethW, eth, owner, '0x514910771AF9Ca656af840dff83E8264EcF986CA')
console.log(`  ${link.symbol} decimals ${link.decimals}, origin chain ${link.originChain} ${hex(link.originAddress).slice(24)}`)
console.log(`  arrives on Algorand as ASA ${(await algorandAssetForToken(link.originChain, link.originAddress))?.assetId} (expect 1200094857)`)
const receipt = await ethW.provider.request({ method: 'eth_getTransactionReceipt', params: [transferTx] })
const op = (await (await fetch(`https://api.wormholescan.io/api/v1/operations?txHash=${transferTx}`)).json()).operations?.[0]
console.log(`  sequence parsed from the transfer receipt: ${sequenceFromReceipt(eth, receipt)} (Wormholescan says ${op?.sequence})`)

console.log('## wrapped ALGO on Ethereum')
const wa = await ethW.provider.request({ method: 'eth_call', params: [{ to: eth.tokenBridge, data: '0x1ff1e286' + (8).toString(16).padStart(64, '0') + '0'.repeat(64) }, 'latest'] })
const waddr = '0x' + wa.slice(-40)
const w = await evmTokenInfo(ethW, eth, owner, waddr)
console.log(`  ${waddr}: ${w.symbol} decimals ${w.decimals}, origin chain ${w.originChain} (expect 8), origin address ${hex(w.originAddress)}`)
