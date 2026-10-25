// The FAQ and the stuck transfers page. Facts checked on mainnet on 25 October 2026, as in routes.ts. The guardian set
// dates come from the Ethereum core contract's getGuardianSet(): set 6 expired on 27 June 2026, a day after set 7
// replaced it, and the Algorand core contract enforces the same expiry (wormhole_core.py checks it in verifySigs).
import { CHAINS } from '../lib/wormhole.ts'
import { CHECKED } from './routes.ts'
import type { Doc } from './doc.ts'
import { REPO_URL } from '../pages.ts'

const SLOW = CHAINS.filter((c) => [2, 14, 23, 24, 30].includes(c.id)).map((c) => c.name)
const FAST = ['Algorand', ...CHAINS.filter((c) => !SLOW.includes(c.name)).map((c) => c.name)]
const names = (l: string[]) => l.slice(0, -1).join(', ') + ' and ' + l.at(-1)

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is this the official Wormhole Portal bridge?',
    a: 'No. Algorand WTT is an unofficial, open-source web app for the Wormhole Token Bridge. It calls the same ' +
      'token bridge contracts that Portal used, from your own wallets. It is not affiliated with or endorsed by ' +
      'Wormhole, Portal or the Wormhole Foundation.',
  },
  {
    q: 'Can I still use the Wormhole bridge with Algorand?',
    a: 'Yes. The Portal website no longer supports Algorand, but the token bridge contracts on Algorand and the ' +
      'other chains still work. This site calls them directly, so you can send tokens, redeem transfers and finish ' +
      'old ones.',
  },
  {
    q: 'Which chains can I bridge to and from Algorand?',
    a: `${names(CHAINS.map((c) => c.name))}. The <a href="/bridges/">bridge routes</a> page has a page for each ` +
      'direction, with the tokens that can go.',
  },
  {
    q: 'Which tokens can I send to Algorand?',
    a: 'A token can go to Algorand only if it already has a Wormhole-wrapped asset there. Most chains\' own coins and ' +
      'stablecoins do, such as ETH, SOL, AVAX, BNB, POL, NEAR, USDC and USDT, but not all of them: ETH on Optimism ' +
      'does not. Each route page lists the tokens for its chain.',
  },
  {
    q: 'Can I bridge ALGO or Algorand USDC to Ethereum or Solana?',
    a: 'Not on this site. From Algorand it sends only Wormhole-wrapped assets, each back to the chain it came from. ' +
      'Wormhole-wrapped ALGO that is already on another chain can come back to Algorand as ALGO.',
  },
  {
    q: 'Why did my USDC arrive as a different asset from Algorand\'s USDC?',
    a: 'A token bridged to Algorand arrives as a Wormhole-wrapped asset, one for each token on each chain. USDC from ' +
      'Ethereum is ASA 887407002, and USDC from Solana is ASA 898230074. Neither is Circle\'s native USDC on Algorand ' +
      '(ASA 31566704), so apps that expect native USDC may not accept them. A wrapped asset can only go back to the ' +
      'chain it came from. The <a href="/wrapped-assets/">wrapped assets</a> page lists them all.',
  },
  {
    q: 'What is the asset opt-in, and why does it cost 0.1 ALGO?',
    a: 'An Algorand account has to opt in to an asset before it can hold it. Each asset an account holds raises its ' +
      'minimum balance by 0.1 ALGO, which stays in the account and comes back if it later opts out. The To Algorand ' +
      'page checks the recipient and offers the opt-in. A redeem by the recipient adds the opt-in itself.',
  },
  {
    q: 'How long does a transfer take?',
    a: `Wormhole guardians sign a transfer from ${names(FAST)} within about 15 seconds. From ${names(SLOW)} they ` +
      `wait until it is final on Ethereum, which took 15 to 30 minutes in recent transfers (${CHECKED}). Then you ` +
      'redeem it on the destination chain.',
  },
  {
    q: 'What does it cost?',
    a: 'This site charges nothing. You pay the network fees on the source chain to send, and on the destination ' +
      'chain to redeem. A redeem on Algorand usually costs under 0.01 ALGO. Now and then a redeem is the first in a ' +
      'new range of transfers and also funds a bridge storage account with about 1 ALGO; the review shows it before ' +
      'you sign.',
  },
  {
    q: 'Why is my transfer held for 24 hours?',
    a: 'Wormhole\'s Governor holds a transfer when it is worth more than a set amount, or when too much value has left ' +
      'the source chain in the past 24 hours. From Algorand the limits are $10,000 for one transfer and $100,000 a day. ' +
      'The guardians sign a held transfer when the hold ends, and you redeem it as usual.',
  },
  {
    q: 'Can someone else redeem my transfer?',
    a: 'Yes. A redeem always pays the recipient written in the transfer, so any wallet can send it and pay its fee. ' +
      'Two cases need the recipient: an Algorand account that has not opted in to the asset, and a NEAR account that ' +
      'has not registered with the bridge.',
  },
  {
    q: 'Is it safe to use?',
    a: 'The site runs in your browser and has no backend, so it never holds your funds or keys. Your own wallet ' +
      'signs every transaction, and the site simulates transactions before you sign them wherever the chain allows. ' +
      'Bridging cannot be undone, so send a small test amount first and check the destination address.',
  },
  {
    q: 'Where is the source code?',
    a: `On GitHub at <a href="${REPO_URL}">github.com/txngroup/wtt</a>, under the MIT license. GitHub Actions builds ` +
      'every release in public, and the README explains how to check that this site serves exactly that build, or ' +
      'how to run your own copy.',
  },
  {
    q: 'My transfer never arrived. What do I do?',
    a: 'See <a href="/stuck-transfers/">stuck transfers</a>. Most can be finished on this site.',
  },
]

const text = (html: string) => html.replace(/<[^>]+>/g, '')

const faq: Doc = {
  path: '/faq/',
  title: 'Algorand Bridge FAQ (Wormhole) - Algorand WTT',
  heading: 'Algorand bridge FAQ',
  description:
    'Answers about bridging to and from Algorand with the Wormhole Token Bridge: which tokens can go, wrapped USDC, ' +
    'the ASA opt-in, timing, costs, 24-hour holds and safety.',
  html: FAQ.map((f) => `<h2>${f.q}</h2>\n<p>${f.a}</p>`).join('\n'),
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: text(f.a) } })),
  },
}

const stuck: Doc = {
  path: '/stuck-transfers/',
  title: 'Finish a Stuck Wormhole Transfer (Algorand) - Algorand WTT',
  heading: 'Finish a stuck Wormhole transfer',
  description:
    'A Wormhole Token Bridge transfer to or from Algorand that never arrived, such as one left unfinished on Portal, ' +
    'can usually still be redeemed. Find it, see why it stopped, and finish it.',
  html: `<p>A Wormhole transfer happens in two parts. The tokens leave the source chain first. Then someone redeems the signed transfer on the destination chain, which releases the tokens there. If the second part never happened, the tokens have left one chain and not arrived on the other. This is how most transfers left on Portal ended up, after Portal stopped supporting Algorand.</p>
<p>Most of these can be finished here, from your own wallets.</p>
<h2>1. Find the transfer</h2>
<ul>
<li>On the <a href="/activity/">Activity</a> page, enter the sending or receiving address, or connect the wallets. It lists Token Bridge transfers to and from Algorand, checks on chain whether each one was redeemed, and has a Continue link for the ones that were not.</li>
<li>On the <a href="/redeem/">Redeem</a> page, paste the source transaction hash, the Wormholescan ID (chain/emitter/sequence) or the signed VAA.</li>
</ul>
<h2>2. See why it stopped</h2>
<h3>It is not signed yet</h3>
<p>The guardians sign a transfer from ${names(SLOW)} only once it is final on Ethereum, which takes 15 to 30 minutes. Other chains take seconds. A transfer can also be held for up to 24 hours by Wormhole's Governor, when it is large or when a lot of value has left the source chain that day. Wait, then try again: the transfer is signed when the wait ends.</p>
<h3>It is signed but not redeemed</h3>
<p>Redeem it on the Redeem page with a wallet on the destination chain. Any wallet can pay for the redeem, and the tokens always go to the recipient in the transfer. Two cases need the recipient's own wallet:</p>
<ul>
<li>On Algorand, a recipient that has not opted in to the asset. Redeem from the recipient's account, and the opt-in goes into the redeem. It sets aside 0.1 ALGO of minimum balance.</li>
<li>On NEAR, a recipient that has not registered with the bridge. The recipient's redeem registers it, for 0.002 NEAR.</li>
</ul>
<p>The wallet also needs the destination chain's coin for fees: ALGO on Algorand, ETH on Ethereum, SOL on Solana, and so on.</p>
<h3>It was signed before late June 2026</h3>
<p>Wormhole replaced its guardian set in late June 2026, and the bridge contracts stopped accepting signatures from the old set a day later. Algorand, the EVM chains and Solana all enforce this. A transfer signed before then cannot be redeemed with its original signatures.</p>
<p>The current guardians have to sign it again first. 16 of the 19 current guardians were also in the previous set, so for a transfer signed by that set, Wormholescan's records may hold enough current signatures to rebuild a valid VAA. Older sets share fewer: in the older transfers we checked, at most 11 current guardians had signed, short of the 13 a VAA needs. Those need the guardians to observe the source transaction again. This site cannot do either yet. Ask Wormhole whether the guardians can sign the transfer again, and include the source transaction and the Wormholescan ID.</p>
<h3>It carries a payload for another app</h3>
<p>Some transfers carry extra data for an app on the destination chain, such as a swap. This site redeems only plain token transfers. Use the app that sent the transfer.</p>
<h3>It was already redeemed</h3>
<p>The Activity page shows the redeem, and the tokens are in the recipient's account. On Algorand they are a Wormhole-wrapped asset, so the wallet may list them under the token's own name, such as WETH or USDC, with a different asset ID from the one you expected.</p>
<h2>What cannot be undone</h2>
<p>A transfer cannot be cancelled or sent back once it has left the source chain. It can only be redeemed, to the recipient written in it. A transfer to a wrong address on the right chain pays that address.</p>
<p>More answers are in the <a href="/faq/">FAQ</a>.</p>`,
}

export const HELP_DOCS: Doc[] = [faq, stuck]
