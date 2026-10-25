// The To Algorand page's EVM code for CELO with an empty token field, against Celo mainnet. Celo's token bridge has no
// wrapped gas token, so CELO has to go as its ERC-20 token, with an approval and then transferTokens. A made-up owner
// gets 100 CELO through eth_call state overrides, and an allowance too for simulating the bridge transfer.
// Usage: node test/check-celo-send.ts
import { keccak_256 } from '@noble/hashes/sha3'
import { algorandAssetForToken } from '../src/lib/algorand-redeem.ts'
import { rpcCall, type EvmWallet } from '../src/lib/evm.ts'
import { buildEvmTransfer, evmTokenInfo, nativeFeeReserve, simulateEvmTx, truncateTo8 } from '../src/lib/evm-send.ts'
import { ALGORAND, chainById, hex } from '../src/lib/wormhole.ts'

const celo = chainById(14)!
const OWNER = '0x1111111111111111111111111111111111111111'
const word = (h: string) => h.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16))
// The token's allowance mapping is in storage slot 3: allowance[owner][spender].
const allowanceSlot = '0x' + hex(keccak_256(fromHex(word(celo.tokenBridge) + hex(keccak_256(fromHex(word(OWNER) + word('3')))))))
const reader = (approved: boolean): EvmWallet => ({
  name: 'Celo public RPC with overrides',
  provider: {
    request: ({ method, params = [] }) => {
      if (method !== 'eth_call' && method !== 'eth_estimateGas') return rpcCall(celo, method, params)
      const o: Record<string, unknown> = { [OWNER]: { balance: '0x' + (100n * 10n ** 18n).toString(16) } }
      if (approved) o[celo.gasToken!] = { stateDiff: { [allowanceSlot]: '0x' + 'f'.repeat(64) } }
      return rpcCall(celo, method, [params[0], 'latest', o])
    },
  },
})

const t = await evmTokenInfo(reader(false), celo, OWNER, '')
console.log(`token ${t.symbol} at ${t.address}, gas coin ${t.gas}, balance ${Number(t.balance) / 1e18}, origin ${t.originChain}/${hex(t.originAddress).slice(24)}`)
console.log(`arrives on Algorand as ASA ${(await algorandAssetForToken(t.originChain, t.originAddress))?.assetId} (expect 1618598027)`)
const plan = await buildEvmTransfer(reader(false), celo, OWNER, t, truncateTo8(10n ** 18n, 18), ALGORAND.chainId, new Uint8Array(32).fill(7))
console.log(`plan: ${plan.map((p) => p.label).join(', then ')}`)
const [approve, bridge] = plan
console.log(`${approve.label}: ${(await simulateEvmTx(reader(false), OWNER, approve)) ?? 'would succeed'}`)
console.log(`${bridge.label} before the approval: ${(await simulateEvmTx(reader(false), OWNER, bridge)) ?? 'would succeed'}`)
console.log(`${bridge.label} after the approval: ${(await simulateEvmTx(reader(true), OWNER, bridge)) ?? 'would succeed'}`)
const gas = async (tx: typeof bridge, approved: boolean) =>
  BigInt(await reader(approved).provider.request({ method: 'eth_estimateGas', params: [{ from: OWNER, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] }))
const used = (await gas(approve, false)) + (await gas(bridge, true))
console.log(`gas for both: ${used} (the fee reserve assumes at most 250000); Max keeps back ${Number(await nativeFeeReserve(reader(false), celo)) / 1e18} CELO`)
