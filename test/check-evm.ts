// Check evm.ts against Avalanche mainnet using the public RPC as a stand-in wallet provider (read-only calls).
// Usage: node test/check-evm.ts <vaa.hex> <calldata.hex>, with the calldata of the transaction that redeemed it
import fs from 'node:fs'
import { redeemCalldata, isRedeemedOnEvm, simulateEvmRedeem, type EvmWallet } from '../src/lib/evm.ts'
import { parseVaa, fromHex, chainById, hex } from '../src/lib/wormhole.ts'
const rpc: EvmWallet = {
  name: 'avalanche rpc',
  provider: {
    request: async ({ method, params }) => {
      const r = await fetch('https://api.avax.network/ext/bc/C/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const j = await r.json()
      if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error })
      return j.result
    },
  },
}
const avax = chainById(6)!
const vaa = parseVaa(fromHex(fs.readFileSync(process.argv[2], 'utf8').trim()))
const { data, unwrap } = await redeemCalldata(rpc, avax, vaa)
const expected = fs.readFileSync(process.argv[3], 'utf8').trim()
console.log('unwrap to native AVAX:', unwrap)
console.log('calldata identical to the real redeem transaction:', data === expected)
console.log('already redeemed:', await isRedeemedOnEvm(rpc, avax, vaa))
console.log('simulation from recipient:', (await simulateEvmRedeem(rpc, avax, '0x' + hex(vaa.transfer.to).slice(24), data)) ?? 'would succeed')
