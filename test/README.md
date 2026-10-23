# Tests

These scripts check the hand-written transaction builders in `src/lib/` against mainnet and against the official
SDKs. All of them are read-only: they build and simulate transactions but never sign or send one.

Run them from the repository root with Node 22.18 or later, which runs TypeScript files directly. Install the app's
packages first with `npm ci`.

## Mainnet checks

| Command | Checks |
|---|---|
| `node test/compare-algorand.ts <sender> <asset> <amount> <chain> <to-hex>` | Algorand `sendTransfer` builder: prints a canonical field summary and simulates it |
| `node test/sim-algorand-redeem.ts <op id>` | Algorand redeem group simulation: signature checks and `verifyVAA` pass |
| `node test/check-evm.ts test/fixtures/wavax-to-avalanche.vaa.hex test/fixtures/wavax-to-avalanche.avax-calldata.hex` | EVM redeem calldata matches the real Avalanche redeem of that transfer, and redemption status |
| `node test/check-evm-send.ts <evm address> <eth transfer tx>` | EVM send dry-run from an address holding at least 0.01 AVAX, origin resolution, and the sequence parsed from any Ethereum token bridge transfer, compared with Wormholescan |
| `node test/sim-verify.mjs test/fixtures/sol-to-solana.vaa.hex [fee payer]` | Solana signature verification simulation |
| `node test/sim-solana-send.mjs <owner> <algorand address>` | Solana send simulation and message sequence |
| `node test/sim-unwrap.mjs <wallet>` | Partial and full wSOL unwrap (wrap then unwrap, simulated) |
| `node --env-file-if-exists=.env test/check-walletconnect.mjs` | Your WalletConnect project id is accepted by the relay |

`<op id>` is a Wormholescan operation id, `<chain>/<emitter>/<sequence>`, as shown on wormholescan.io.

## SDK diffs

`test/sdk/` has its own `package.json` with the Wormhole SDK 6.1.5 and `@solana/web3.js` 1.99.0, so the app itself
never depends on them. Each script builds the same instructions or transactions with the SDK and with our code, and
prints `OK` or `DIFF` for each.

```sh
cd test/sdk
npm ci
node compare-solana.mjs                       # every Solana redeem and send instruction
node compare-solana-tx.mjs                    # src/lib/solana-tx.ts against @solana/web3.js, byte for byte
node compare-algorand-redeem.mjs <op id> ...  # the Algorand redeem group against the SDK's redeem()
```

## Fixtures

`test/fixtures/` holds public mainnet data from two strangers' transfers out of Algorand: their signed VAAs, and the
calldata of the Avalanche transaction that redeemed one of them. `fixtures.json` records where each came from. The
Solana scripts use the owner of the Solana recipient as their fee payer, so they need that wallet to still hold a
little SOL. If it runs dry, `sim-verify.mjs` takes another funded address as its second argument.

Never put your own wallet addresses or transactions in the tests. Pass them as arguments instead.
