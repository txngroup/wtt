// The route pages: one for each direction between Algorand and each chain in CHAINS, such as /near-algorand-bridge/
// (NEAR to Algorand) and /algorand-near-bridge/ (Algorand to NEAR), and an index of them at /bridges/.
//
// Every fact here was checked on mainnet on 25 October 2026:
// - Tokens: scripts/wrapped-assets.mjs, which wrote wrapped-assets.json. Each origin address was checked on
//   its chain (symbol() on EVM chains, the mint on Solana).
// - Wait times: Wormholescan's indexedAt less the VAA timestamp, over the 40 latest token bridge transfers from each
//   chain.
// - Governor limits: api.wormholescan.io/api/v1/governor/limit.
// - Wrapped ALGO: the token bridge's wrappedAsset(8, 0) on each EVM chain, the wrapped mint on Solana, and
//   get_foreign_asset on NEAR.
import { keccak_256 } from '@noble/hashes/sha3'
import { CHAINS, type Chain } from '../lib/wormhole.ts'
import wrapped from './wrapped-assets.json' with { type: 'json' }
import { esc, type Doc } from './doc.ts'

export const CHECKED = '25 October 2026'

export type Asset = (typeof wrapped.assets)[number]
const asset = (id: number) => {
  const a = wrapped.assets.find((a) => a.assetId === id)
  if (!a) throw new Error(`ASA ${id} is not in wrapped-assets.json`)
  return a
}
const fromChain = (chain: number) => wrapped.assets.filter((a) => a.originChain === chain)
export const usd = (n: number) => '$' + n.toLocaleString('en-US')
export const asaLink = (id: number) => `<a href="https://allo.info/asset/${id}" target="_blank" rel="noreferrer">ASA ${id}</a>`

// A token that can be sent from the chain to Algorand. Its address comes from the wrapped asset's origin; the chain's
// own coin (coin) needs none.
type Token = { label: string; assetId: number; coin?: boolean }

// EIP-55 mixed-case form of a 0x address.
export function checksum(address: string) {
  const a = address.toLowerCase().replace(/^0x/, '')
  const h = Array.from(keccak_256(new TextEncoder().encode(a)), (b) => b.toString(16).padStart(2, '0')).join('')
  return '0x' + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('')
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58(hex: string) {
  let n = BigInt('0x' + hex)
  let out = ''
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out
    n /= 58n
  }
  return '1'.repeat(hex.match(/^(00)*/)![0].length / 2) + out
}
// A token's address on its own chain, in that chain's usual form.
const originAddress = (c: Chain, a: Asset) =>
  c.platform === 'evm' ? checksum(a.originAddress.slice(24)) : c.platform === 'solana' ? base58(a.originAddress) : a.originAddress
export const external = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`
// The original token of a wrapped asset, linked to its chain's explorer where this site supports the chain, else its
// 32-byte Wormhole address. NEAR's own coin has no token address.
export function originalToken(a: Asset) {
  const c = CHAINS.find((c) => c.id === a.originChain)
  if (c?.platform === 'near' && /^0+$/.test(a.originAddress)) return 'NEAR (the native coin)'
  if (c?.platform === 'evm' || c?.platform === 'solana') {
    const address = originAddress(c, a)
    return external(c.explorerTx.replace(/\/tx\/$/, '/token/') + address, `<code>${address}</code>`)
  }
  return `<code>${a.originAddress}</code>`
}
const wrappedAlgoAddress = (c: Chain, f: Facts) => (f.wrappedAlgo && c.platform === 'evm' ? checksum(f.wrappedAlgo) : f.wrappedAlgo)

type Facts = {
  wallets: string // how a wallet on the chain connects
  wait: string // how long the guardians take to sign a transfer from the chain
  governor: [number, number] // Wormhole Governor: one transfer, and all transfers in 24 hours, in USD
  tokenInput: string // what to paste on the To Algorand page for a token other than the chain's own coin
  redeem: string // what redeeming on the chain takes
  wrappedAlgo?: string // Wormhole-wrapped ALGO on the chain
  to: { intro: string; tokens: Token[]; notes: string[] } // to Algorand
  from: { intro: string; assets: number[]; notes: string[] } // from Algorand
}

const EVM_WALLETS =
  'any browser wallet that supports EIP-6963, such as MetaMask or Rabby, or a phone wallet through WalletConnect'
const evmRedeem = (gas: string) =>
  `The redeem is one transaction on the destination chain, and the wallet that sends it pays the gas in ${gas}. Any ` +
  'wallet can redeem: the tokens always go to the recipient in the transfer.'
const FAST = 'Wormhole guardians usually sign a transfer from this chain within about 15 seconds.'
// For the chains that wait for Ethereum finality (Chain.slow).
const final = (median: number, lo: number, hi: number) =>
  `Wormhole guardians sign a transfer from this chain only once its block is final on Ethereum. In recent transfers ` +
  `that took about ${median} minutes (from ${lo} to ${hi}).`
const ERC20 = 'To send an ERC-20 token, paste its contract address on the To Algorand page.'
const USDC_NOTE = (id: number, from: string) =>
  `USDC from ${from} arrives as ${asaLink(id)}, Wormhole-wrapped USDC. It is not Circle's native USDC on Algorand ` +
  '(ASA 31566704), so Algorand apps that expect native USDC may not accept it. It can only go back to ' +
  `${from}.`
const ERC20_STEPS =
  'An ERC-20 token takes two transactions: an approval for the bridge, then the transfer. The chain\'s own coin takes one.'

export const FACTS: Record<number, Facts> = {
  1: {
    wallets: 'any Solana browser wallet that supports the Wallet Standard, such as Phantom, Solflare or Backpack, or a phone wallet through WalletConnect',
    wait: FAST,
    governor: [1_000_000, 20_000_000],
    tokenInput: 'To send an SPL token, paste its mint address on the To Algorand page. Token-2022 tokens are not supported.',
    redeem:
      'The redeem on Solana pays transaction fees and the rent for the accounts it opens, including your token account ' +
      'for the token if you do not have one yet. SOL arrives as plain SOL, not wSOL.',
    wrappedAlgo: 'B5WHK5yNkr6dUC9TPZSCegLTBxLXu9n6weyXefcj3xVh',
    to: {
      intro:
        'Send SOL, USDC, USDT and other SPL tokens from Solana to Algorand through the Wormhole Token Bridge. Each ' +
        'token arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to Solana.',
      tokens: [
        { label: 'SOL', assetId: 887648583, coin: true },
        { label: 'USDC', assetId: 898230074 },
        { label: 'USDT', assetId: 925661512 },
        { label: 'BONK', assetId: 1002794461 },
        { label: 'PYTH', assetId: 1684682524 },
        { label: 'W (Wormhole)', assetId: 1703994770 },
      ],
      notes: [
        'SOL or an SPL token goes in a single Solana transaction, which the page simulates before your wallet signs it.',
        USDC_NOTE(898230074, 'Solana'),
        'Max on SOL keeps back enough for the transaction fee and the rent of the temporary accounts the transfer uses.',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Solana tokens held on Algorand, such as SOL, USDC or BONK, back to Solana. Only tokens ' +
        'that came from Solana can go there.',
      assets: [887648583, 898230074, 1002794461, 1684682524, 1703994770],
      notes: [
        'The recipient is a Solana wallet address. The tokens go to that wallet\'s associated token account for the token.',
      ],
    },
  },
  2: {
    wallets: EVM_WALLETS,
    wait: final(16, 14, 19),
    governor: [1_000_000, 10_000_000],
    tokenInput: ERC20,
    redeem: evmRedeem('ETH'),
    wrappedAlgo: '0xe31cfcd36fed044ae4cf9405b577fe875762194f',
    to: {
      intro:
        'Send ETH, USDC, USDT, WBTC and other ERC-20 tokens from Ethereum to Algorand through the Wormhole Token ' +
        'Bridge. Each token arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to Ethereum.',
      tokens: [
        { label: 'ETH', assetId: 887406851, coin: true },
        { label: 'USDC', assetId: 887407002 },
        { label: 'USDT', assetId: 893504888 },
        { label: 'WBTC', assetId: 1058926737 },
        { label: 'DAI', assetId: 1071084947 },
        { label: 'LINK', assetId: 1200094857 },
        { label: 'PEPE', assetId: 1091928613 },
        { label: 'SHIB', assetId: 956153949 },
      ],
      notes: [ERC20_STEPS, USDC_NOTE(887407002, 'Ethereum'), 'ETH arrives on Algorand as Wormhole-wrapped WETH.'],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Ethereum tokens held on Algorand, such as WETH, USDC, USDT or WBTC, back to Ethereum. ' +
        'Only tokens that came from Ethereum can go there.',
      assets: [887406851, 887407002, 893504888, 1058926737, 1071084947, 1200094857, 1091928613, 956153949],
      notes: ['WETH arrives on Ethereum as ETH: the redeem unwraps it.'],
    },
  },
  4: {
    wallets: EVM_WALLETS,
    wait: FAST,
    governor: [100_000, 1_000_000],
    tokenInput: ERC20,
    redeem: evmRedeem('BNB'),
    wrappedAlgo: '0x096efaa51e00eafbb1851e2a7a81f9621597920e',
    to: {
      intro:
        'Send BNB, USDT, USDC and other BEP-20 tokens from BNB Smart Chain to Algorand through the Wormhole Token ' +
        'Bridge. Each token arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to BNB Smart Chain.',
      tokens: [
        { label: 'BNB', assetId: 891648844, coin: true },
        { label: 'USDT', assetId: 977475199 },
        { label: 'USDC', assetId: 921966766 },
        { label: 'BUSD', assetId: 981907882 },
        { label: 'ETH (Binance-Peg)', assetId: 1638573600 },
      ],
      notes: [
        ERC20_STEPS,
        USDC_NOTE(921966766, 'BNB Smart Chain'),
        'BNB arrives on Algorand as Wormhole-wrapped WBNB.',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped BNB Smart Chain tokens held on Algorand, such as WBNB, USDT or USDC, back to BNB Smart ' +
        'Chain. Only tokens that came from BNB Smart Chain can go there.',
      assets: [891648844, 977475199, 921966766, 981907882, 1229063012, 1403001477],
      notes: ['WBNB arrives on BNB Smart Chain as BNB: the redeem unwraps it.'],
    },
  },
  5: {
    wallets: EVM_WALLETS,
    wait: FAST,
    governor: [100_000, 1_000_000],
    tokenInput: ERC20,
    redeem: evmRedeem('POL'),
    wrappedAlgo: '0x3e91754ad5672b3f5e524357bf5806b172d708d0',
    to: {
      intro:
        'Send POL, USDC and USDT0 from Polygon to Algorand through the Wormhole Token Bridge. Each token arrives on ' +
        'Algorand as a Wormhole-wrapped ASA, which can later go back to Polygon.',
      tokens: [
        { label: 'POL', assetId: 891396362, coin: true },
        { label: 'USDC', assetId: 1236031277 },
        { label: 'USDC.e (bridged USDC)', assetId: 898611351 },
        { label: 'USDT0 (formerly USDT)', assetId: 965049717 },
      ],
      notes: [
        ERC20_STEPS,
        'POL arrives on Algorand as the ASA named Wrapped Matic. Polygon renamed MATIC to POL, and the bridge still ' +
          'uses the same wrapped token contract.',
        'Polygon has two USDC tokens, Circle\'s native USDC and the older bridged USDC.e. Each has its own ASA on ' +
          'Algorand, and neither is Circle\'s native USDC on Algorand (ASA 31566704).',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Polygon tokens held on Algorand, such as Wrapped Matic (POL) or USDC, back to Polygon. ' +
        'Only tokens that came from Polygon can go there.',
      assets: [891396362, 1236031277, 898611351, 965049717],
      notes: ['Wrapped Matic arrives on Polygon as POL: the redeem unwraps it.'],
    },
  },
  6: {
    wallets: EVM_WALLETS,
    wait: FAST,
    governor: [100_000, 1_000_000],
    tokenInput: ERC20,
    redeem: evmRedeem('AVAX'),
    wrappedAlgo: '0x8dffa282355630e348509ffdc25ac56376e6ec59',
    to: {
      intro:
        'Send AVAX, USDC and USDT from Avalanche C-Chain to Algorand through the Wormhole Token Bridge. Each token ' +
        'arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to Avalanche.',
      tokens: [
        { label: 'AVAX', assetId: 893309613, coin: true },
        { label: 'USDC', assetId: 1007352535 },
        { label: 'USDt', assetId: 2058544621 },
        { label: 'USDT.e (bridged USDT)', assetId: 890260652 },
      ],
      notes: [ERC20_STEPS, USDC_NOTE(1007352535, 'Avalanche'), 'AVAX arrives on Algorand as Wormhole-wrapped WAVAX.'],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Avalanche tokens held on Algorand, such as WAVAX or USDC, back to Avalanche C-Chain. Only ' +
        'tokens that came from Avalanche can go there.',
      assets: [893309613, 1007352535],
      notes: ['WAVAX arrives on Avalanche as AVAX: the redeem unwraps it.'],
    },
  },
  14: {
    wallets: EVM_WALLETS,
    wait: final(23, 15, 29),
    governor: [10_000, 10_000],
    tokenInput: ERC20,
    redeem: evmRedeem('CELO'),
    wrappedAlgo: '0xd3a1310e7c8c4608b774fab2985e50532ce9aecb',
    to: {
      intro:
        'Send CELO and EURm from Celo to Algorand through the Wormhole Token Bridge. They are the only Celo tokens ' +
        'with a wrapped asset on Algorand, and each can later go back to Celo.',
      tokens: [
        { label: 'CELO', assetId: 1618598027 },
        { label: 'EURm (formerly cEUR)', assetId: 891408509 },
      ],
      notes: [
        'Paste CELO\'s token address to send CELO. Celo\'s token bridge has no wrapped gas token, so CELO travels as ' +
          'the ERC-20 token it also is, with an approval and then the transfer.',
        'Celo\'s dollar stablecoin (USDm, formerly cUSD) has no wrapped asset on Algorand, so it cannot be sent there.',
        'Celo has the lowest Governor limits of the chains here, so a transfer over $10,000 waits a day.',
      ],
    },
    from: {
      intro:
        'Only Celo tokens can go from Algorand to Celo: CELO and EURm that were bridged to Algorand earlier. Few ' +
        'are on Algorand, so check the asset links below for the amounts before you count on this route.',
      assets: [1618598027, 891408509],
      notes: [],
    },
  },
  15: {
    wallets: 'Meteor or HOT, as a browser extension, Meteor\'s web wallet, or the HOT app through a QR code. WalletConnect is not offered for NEAR',
    wait: FAST,
    governor: [10_000, 100_000],
    tokenInput:
      'For a Wormhole token on NEAR, paste its token account, which ends in .contract.portalbridge.near, on the To ' +
      'Algorand page.',
    redeem:
      'The recipient\'s NEAR account must already exist. The first time an account receives through the bridge, it ' +
      'registers with it, which costs 0.002 NEAR, and the recipient has to sign that redeem. The redeem makes two ' +
      'bridge calls under one wallet approval and attaches 0.1 NEAR to each; the bridge keeps only what it uses.',
    wrappedAlgo: '9.contract.portalbridge.near',
    to: {
      intro:
        'Send NEAR from NEAR to Algorand through the Wormhole Token Bridge, along with Wormhole tokens held on NEAR ' +
        'such as wrapped ALGO. NEAR arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to NEAR.',
      tokens: [{ label: 'NEAR', assetId: 901137853, coin: true }],
      notes: [
        'NEAR\'s own fungible tokens, such as the USDC issued on NEAR, have no wrapped asset on Algorand, so they ' +
          'cannot be sent there. Only NEAR itself and Wormhole tokens can.',
        'NEAR cannot simulate a transaction before it is sent. The page checks your balance and your bridge ' +
          'registration instead.',
        'The bridge carries at most 8 decimals, so amounts go in steps of 0.00000001 NEAR. Max keeps back 0.05 NEAR ' +
          'for gas.',
        'Sending a Wormhole token needs your account to be registered with the bridge. If it is not, the page ' +
          'registers it first, for 0.002 NEAR.',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped NEAR held on Algorand back to NEAR, where it arrives as native NEAR. It is the only ' +
        'NEAR token with a wrapped asset on Algorand.',
      assets: [901137853],
      notes: [
        'The recipient is a NEAR account id, such as alice.near. The page checks that the account exists before you ' +
          'sign, so a typo cannot strand the tokens.',
        'Wormholescan does not record redeems on NEAR, so the Activity page asks the NEAR bridge itself whether a ' +
          'transfer was redeemed.',
      ],
    },
  },
  23: {
    wallets: EVM_WALLETS,
    wait: final(18, 14, 23),
    governor: [250_000, 2_500_000],
    tokenInput: ERC20,
    redeem: evmRedeem('ETH'),
    wrappedAlgo: '0x0a4bd325e4fc8cf8e5de9eb306d6cca94b257d85',
    to: {
      intro:
        'Send ETH, USDC, ARB and other tokens from Arbitrum One to Algorand through the Wormhole Token Bridge. Each ' +
        'token arrives on Algorand as a Wormhole-wrapped ASA, which can later go back to Arbitrum.',
      tokens: [
        { label: 'ETH', assetId: 1169529421, coin: true },
        { label: 'USDC', assetId: 1272612695 },
        { label: 'USDC.e (bridged USDC)', assetId: 1057583502 },
        { label: 'ARB', assetId: 1221549217 },
        { label: 'WBTC', assetId: 2308394287 },
      ],
      notes: [
        ERC20_STEPS,
        'ETH from Arbitrum arrives as its own WETH asset on Algorand, ' + asaLink(1169529421) + '. It is not the ' +
          'same as WETH from Ethereum (ASA 887406851), and it can only go back to Arbitrum.',
        'USDC from Arbitrum arrives as Wormhole-wrapped USDC, not Circle\'s native USDC on Algorand (ASA 31566704).',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Arbitrum tokens held on Algorand, such as USDC or ARB, back to Arbitrum One. Only ' +
        'tokens that came from Arbitrum can go there.',
      assets: [1272612695, 1057583502, 1221549217, 1169529421],
      notes: ['WETH from Arbitrum arrives back on Arbitrum as ETH: the redeem unwraps it.'],
    },
  },
  24: {
    wallets: EVM_WALLETS,
    wait: final(21, 17, 27),
    governor: [100_000, 1_000_000],
    tokenInput: ERC20,
    redeem: evmRedeem('ETH'),
    to: {
      intro:
        'Send USDC from Optimism to Algorand through the Wormhole Token Bridge. Optimism\'s two USDC tokens are the ' +
        'only Optimism tokens with a wrapped asset on Algorand.',
      tokens: [
        { label: 'USDC', assetId: 1370611785 },
        { label: 'USDC.e (bridged USDC)', assetId: 1046873545 },
      ],
      notes: [
        'ETH cannot be sent from Optimism to Algorand. Optimism\'s WETH has no wrapped asset on Algorand, so the page ' +
          'refuses it.',
        'USDC from Optimism arrives as Wormhole-wrapped USDC, not Circle\'s native USDC on Algorand (ASA 31566704).',
        `Wormhole-wrapped Algorand USDC on Optimism (<code>${checksum('0x677257b6bd2835cf8fb4724e46eb3f8149e20ea4')}</code>) can come home too, ` +
          'and arrives as native Algorand USDC.',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped USDC from Optimism, held on Algorand, back to Optimism. Only tokens that came from ' +
        'Optimism can go there.',
      assets: [1370611785, 1046873545],
      notes: [],
    },
  },
  30: {
    wallets: EVM_WALLETS,
    wait: final(21, 17, 24),
    governor: [250_000, 2_500_000],
    tokenInput: ERC20,
    redeem: evmRedeem('ETH'),
    wrappedAlgo: '0x1f2810159e1a95e501580fdace2d1651a9dd5db0',
    to: {
      intro:
        'Send ETH, USDC and DEGEN from Base to Algorand through the Wormhole Token Bridge. Each token arrives on ' +
        'Algorand as a Wormhole-wrapped ASA, which can later go back to Base.',
      tokens: [
        { label: 'ETH', assetId: 1265059965, coin: true },
        { label: 'USDC', assetId: 1282456869 },
        { label: 'DEGEN', assetId: 1764662853 },
      ],
      notes: [
        ERC20_STEPS,
        'ETH from Base arrives as its own WETH asset on Algorand, ' + asaLink(1265059965) + '. It is not the same as ' +
          'WETH from Ethereum (ASA 887406851), and it can only go back to Base.',
        'USDC from Base arrives as Wormhole-wrapped USDC, not Circle\'s native USDC on Algorand (ASA 31566704).',
      ],
    },
    from: {
      intro:
        'Send Wormhole-wrapped Base tokens held on Algorand, such as WETH or DEGEN, back to Base. Only tokens that came ' +
        'from Base can go there.',
      assets: [1265059965, 1764662853, 1282456869],
      notes: ['WETH from Base arrives back on Base as ETH: the redeem unwraps it.'],
    },
  },
}

export const toPath = (c: Chain) => `/${c.slug}-algorand-bridge/`
export const fromPath = (c: Chain) => `/algorand-${c.slug}-bridge/`

export const ALGORAND_GOVERNOR: [number, number] = [10_000, 100_000]
const governor = (from: string, [one, day]: [number, number]) =>
  `<p>Wormhole's Governor holds a single transfer worth more than ${usd(one)} from ${from} for 24 hours. When more ` +
  `than ${usd(day)} in all has left ${from} in the past 24 hours, later transfers wait until there is room again. ` +
  'A held transfer is not lost: the guardians sign it when the hold ends, and you redeem it as usual. (Limits on ' +
  `${CHECKED}.)</p>`

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '')
// A table whose cells stack on a phone, unless it is narrow enough to keep (keep).
export const table = (head: string[], rows: string[][], keep = false) =>
  `<div class="scroll"><table${keep ? ' class="keep"' : ''}><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((d, i) => `<td data-label="${head[i]}">${d}</td>`).join('')}</tr>`).join('') +
  '</tbody></table></div>'
const others = (c: Chain) => `<p>Going the other way? See the <a href="${fromPath(c)}">Algorand to ${c.name} bridge</a>.</p>`
const back = (c: Chain) => `<p>Going the other way? See the <a href="${toPath(c)}">${c.name} to Algorand bridge</a>.</p>`
const STUCK = '<p>A transfer that did not arrive can be finished later. See <a href="/stuck-transfers/">stuck transfers</a>.</p>'
const OPT_IN =
  'An Algorand account has to opt in to an asset before it can hold it, which sets aside 0.1 ALGO of minimum ' +
  'balance. The page checks the recipient and offers the opt-in if it is needed.'

function toAlgorand(c: Chain): Doc {
  const f = FACTS[c.id]
  const total = fromChain(c.id).length
  const rows = f.to.tokens.map((t) => {
    const a = asset(t.assetId)
    return [esc(t.label), t.coin ? 'No address needed' : `<code>${originAddress(c, a)}</code>`, `${esc(a.unitName)}, ${asaLink(a.assetId)}`]
  })
  const coin = f.to.tokens.find((t) => t.coin)
  const home = f.wrappedAlgo
    ? `<p>Tokens that left Algorand through Wormhole go home the same way. Wormhole-wrapped ALGO on ${c.name} ` +
      `(<code>${wrappedAlgoAddress(c, f)}</code>) arrives on Algorand as ALGO.</p>`
    : ''
  const html = `<p>${f.to.intro}</p>
<p><a class="button primary" href="/to-algorand/?from=${c.slug}">Send from ${c.name} to Algorand</a></p>
<h2>Tokens you can send</h2>
<p>A token can go to Algorand only if it already has a Wormhole-wrapped asset there. On ${CHECKED}, ${total === 1 ? 'one token' : `${total} tokens`} from ${c.name} did${total > f.to.tokens.length ? ', and these are the best known' : ''}:</p>
${table(['Token', `Address on ${c.name}`, 'Arrives on Algorand as'], rows)}
<p>${coin ? `${esc(coin.label)} is ${c.name}'s own coin and needs no address. ` : ''}${f.tokenInput} The <a href="/wrapped-assets/#${c.slug}">wrapped assets</a> page lists every ${c.name} token on Algorand.</p>
${home}
<h2>How long it takes</h2>
<p>${f.wait} Then you redeem the transfer on Algorand, which takes a few seconds.</p>
<h2>How to send from ${c.name} to Algorand</h2>
<ol>
<li>Connect a wallet for ${c.name} in the wallet bar: ${f.wallets}. Connect your Algorand wallet too, Pera or Lute, to redeem.</li>
<li>On the <a href="/to-algorand/?from=${c.slug}">To Algorand</a> page, choose the token and amount, and enter the Algorand address that should receive it. ${OPT_IN}</li>
<li>Review the transfer and approve it in your ${c.name} wallet. You pay ${c.name}'s network fee; this site charges nothing.</li>
<li>Wait for the guardians to sign the transfer. The page shows when it is ready.</li>
<li>Redeem it on Algorand. The fees are usually under 0.01 ALGO, and any Algorand account can pay them. If the recipient has not opted in yet, the recipient has to redeem, because the opt-in goes into the same group.</li>
</ol>
<h2>Large transfers</h2>
${governor(c.name, f.governor)}
<h2>Good to know</h2>
${list(f.to.notes)}
${STUCK}
${others(c)}`
  const names = f.to.tokens.slice(0, 3).map((t) => t.label.replace(/ \(.*/, ''))
  return {
    path: toPath(c),
    title: `${c.name} to Algorand Bridge (Wormhole) - Algorand WTT`,
    heading: `${c.name} to Algorand bridge`,
    description:
      `Bridge ${total > names.length ? `${names.join(', ')} and more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} ` +
      `from ${c.name} to Algorand with the Wormhole Token ` +
      `Bridge: which tokens work, how long it takes (${c.slow ? '15 to 30 minutes' : 'under a minute'}) and the steps.`,
    html,
    crumbs: true,
  }
}

function fromAlgorand(c: Chain): Doc {
  const f = FACTS[c.id]
  const shown = f.from.assets.map(asset)
  const rest = fromChain(c.id).length - shown.length
  const rows = shown.map((a) => [`${esc(a.unitName)}, ${asaLink(a.assetId)}`, esc(a.name), originalToken(a)])
  const tokens = `<p>${rest ? `The best known of the ${shown.length + rest}` : shown.length === 1 ? 'The one' : shown.length === 2 ? 'Both' : `All ${shown.length}`} Wormhole-wrapped ${c.name} ${shown.length + rest === 1 ? 'asset' : 'assets'} on Algorand${rest ? ` are below; the <a href="/wrapped-assets/#${c.slug}">wrapped assets</a> page lists the rest` : ` ${shown.length === 1 ? 'is' : 'are'} below`}. Follow an asset's link for how much of it is on Algorand now. The From Algorand page lists the ones your account holds.</p>
${table(['Asset on Algorand', 'Name', `Original token on ${c.name}`], rows)}`
  const html = `<p>${f.from.intro}</p>
<p><a class="button primary" href="/from-algorand/">Send from Algorand</a></p>
<h2>What can go from Algorand to ${c.name}</h2>
<p>Each Wormhole-wrapped asset on Algorand can only go back to the chain it came from. ALGO, Circle's native USDC on Algorand and other Algorand assets cannot be sent out on this site.</p>
${tokens}
<h2>How long it takes</h2>
<p>Wormhole guardians usually sign a transfer from Algorand within about 15 seconds. Then you redeem it on ${c.name}.</p>
<h2>How to send from Algorand to ${c.name}</h2>
<ol>
<li>Connect your Algorand wallet, Pera or Lute, in the wallet bar. The <a href="/from-algorand/">From Algorand</a> page lists the Wormhole-wrapped assets it holds.</li>
<li>Choose the asset and amount, and enter the recipient on ${c.name}.</li>
<li>Review the transfer. The page simulates the Algorand transactions before your wallet signs them. The fees are a few thousandths of an ALGO; this site charges nothing.</li>
<li>Wait for the guardians to sign the transfer. The page shows when it is ready.</li>
<li>Redeem it on ${c.name} with a wallet there: ${f.wallets}.</li>
</ol>
<p>${f.redeem}</p>
<h2>Large transfers</h2>
${governor('Algorand', ALGORAND_GOVERNOR)}
${f.from.notes.length ? `<h2>Good to know</h2>\n${list(f.from.notes)}` : ''}
${STUCK}
${back(c)}`
  return {
    path: fromPath(c),
    title: `Algorand to ${c.name} Bridge (Wormhole) - Algorand WTT`,
    heading: `Algorand to ${c.name} bridge`,
    description:
      `Send Wormhole-wrapped ${shown.slice(0, 3).map((a) => a.unitName).join(', ')} from Algorand back to ${c.name} ` +
      `with the Wormhole Token Bridge: what can go, how long it takes, and how to redeem on ${c.name}.`,
    html,
    crumbs: true,
  }
}

function index(): Doc {
  const rows = CHAINS.map((c) => [
    esc(c.name),
    `<a href="${toPath(c)}">${esc(c.name)} to Algorand</a>`,
    `<a href="${fromPath(c)}">Algorand to ${esc(c.name)}</a>`,
    c.slow ? '15 to 30 minutes' : 'Under a minute',
  ])
  const html = `<p>This site bridges tokens between Algorand and ${CHAINS.length} other chains through the Wormhole Token Bridge. Each route has its own page: which tokens can go, how long it takes, and the steps.</p>
${table(['Chain', 'To Algorand', 'From Algorand', 'Signing wait'], rows)}
<p>The signing wait is how long Wormhole guardians take to sign a transfer from that chain. Transfers from Algorand are signed in under a minute. Chains that settle on Ethereum, such as Arbitrum or Base, wait for Ethereum finality.</p>
<h2>Two rules that apply everywhere</h2>
<ul>
<li>A token can go to Algorand only if it already has a Wormhole-wrapped asset there.</li>
<li>From Algorand, only Wormhole-wrapped assets can be sent, each back to the chain it came from.</li>
</ul>
<p>Every Wormhole-wrapped asset on Algorand, with its original token, is on the <a href="/wrapped-assets/">wrapped assets</a> page. Questions are answered in the <a href="/faq/">FAQ</a>. If a transfer did not arrive, see <a href="/stuck-transfers/">stuck transfers</a>.</p>`
  return {
    path: '/bridges/',
    title: 'Algorand Bridge Routes by Chain - Algorand WTT',
    heading: 'Algorand bridge routes',
    description:
      `Every Wormhole Token Bridge route to and from Algorand on this site: Ethereum, Solana, NEAR, Base, Arbitrum, ` +
      'Avalanche, BNB Smart Chain, Polygon, Optimism and Celo.',
    html,
  }
}

// The route index, which the route pages' breadcrumbs lead back to.
export const ROUTES = index()
export const ROUTE_DOCS: Doc[] = [ROUTES, ...CHAINS.flatMap((c) => [toAlgorand(c), fromAlgorand(c)])]
