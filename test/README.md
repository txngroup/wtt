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
| `node test/check-near.ts` | NEAR bridge registry, wrapped ALGO on NEAR, redeem plans and status for the latest transfer into NEAR, and the sequence of the latest transfer out of NEAR against Wormholescan |

`<op id>` is a Wormholescan operation id, `<chain>/<emitter>/<sequence>`, as shown on wormholescan.io.

## SDK diffs

These diff our hand-written builders against the official libraries: the Wormhole SDK 6.1.5, `@solana/web3.js`
1.99.0 and `near-api-js` 1.1.0. Each script builds the same instructions or transactions with the library and with our
code, and prints `OK` or `DIFF` for each.

| Script | Compares |
|---|---|
| `compare-solana.mjs` | Every Solana redeem and send instruction, against the Wormhole SDK |
| `compare-solana-tx.mjs` | `src/lib/solana-tx.ts` against `@solana/web3.js`, byte for byte |
| `compare-algorand-redeem.mjs [<op id> ...]` | The Algorand redeem group against the SDK's `redeem()`, for the latest transfers to Algorand by default |
| `compare-near.mjs` | `src/lib/near-tx.ts` against `near-api-js`, byte for byte |

The libraries never reach the site. `test/sdk/` holds only their names, versions and hashes, in its own `package.json`
and lockfile. One command installs them, verifies them, runs every diff and deletes them again:

```sh
npm run test:sdk          # on this machine
npm run test:sdk:docker   # in a throwaway Docker container
```

The lockfile pins every library and every package under it by version and SHA-512, so `npm ci` refuses any download
that does not match, and no package runs code at install time. Their code does run during the diffs. To keep it off
your machine, use the Docker variant. It gives the libraries a read-only copy of the repository and nothing else of
your machine, runs them as an unprivileged user without capabilities, and keeps everything in memory. The image is
pinned by digest. Pull requests that touch `src/lib/` or `test/` also run the diffs on GitHub (`sdk-diffs.yml`).

The NEAR bridge calls themselves are checked by `check-near.ts`, against the values of `@certusone/wormhole-sdk`
0.10.18, the last Wormhole SDK with NEAR support. Those were compared call by call on 2026-10-23 and are written into
the check, so it needs no copy of that SDK.

## Fixtures

`test/fixtures/` holds public mainnet data from two strangers' transfers out of Algorand: their signed VAAs, and the
calldata of the Avalanche transaction that redeemed one of them. `fixtures.json` records where each came from. The
Solana scripts use the owner of the Solana recipient as their fee payer, so they need that wallet to still hold a
little SOL. If it runs dry, `sim-verify.mjs` takes another funded address as its second argument.

Never put your own wallet addresses or transactions in the tests. Pass them as arguments instead.
