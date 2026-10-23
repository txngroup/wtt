# Algorand WTT

[![Live check](https://github.com/txngroup/wtt/actions/workflows/live-check.yml/badge.svg)](https://github.com/txngroup/wtt/actions/workflows/live-check.yml)

A static web app for moving tokens between Algorand and other chains through the Wormhole Token Bridge (Wrapped Token
Transfers), and for redeeming those transfers on the destination chain. It runs at https://wtt.txn.group.

The app runs entirely in the browser. It has no backend, holds no funds and needs no API keys. It decodes every
transaction from its own bytes for review, and simulates it before the wallet is asked to sign wherever the chain
allows. Every deploy is built in public by GitHub Actions, and anyone can check that the live site serves exactly that
build (see [Verifying the site](#verifying-the-site)).

This project is not affiliated with or endorsed by Wormhole, Portal or the Wormhole Foundation. Bridging cannot be
undone, so send a small test amount first.

## Features

| Page | What it does |
|---|---|
| `/` | Overview: what the site does, how a transfer works, supported chains and wallets, limits |
| `/to-algorand/` | Send from an EVM chain (gas coin or ERC-20) or Solana (SOL or SPL) to Algorand, for tokens that already have a wrapped asset there. Offers the recipient's ASA opt-in first. |
| `/from-algorand/` | Send a Wormhole-wrapped asset held on Algorand back to its origin chain |
| `/redeem/?tx=<txid>` or `/redeem/?vaa=<chain/emitter/seq>` | Look up any transfer and redeem it on Algorand, an EVM chain or Solana |
| `/activity/` | Token Bridge transfers to or from Algorand for the connected wallets or any address, with on-chain redeem status and a Continue link for unfinished ones |
| `/unwrap/` | Unwrap a chain's wrapped gas token: wSOL (partial or full), or WETH, WAVAX, WBNB and WPOL |

Chains: Algorand, Solana, Ethereum, BNB Smart Chain, Polygon, Avalanche, Celo, Arbitrum, Optimism, Base and NEAR.

Wallets: Pera and Lute on Algorand, any EIP-6963 browser wallet on EVM chains, any Wallet Standard browser wallet on
Solana, phone wallets on EVM and Solana through WalletConnect, and Meteor and HOT on NEAR (each as a browser extension,
or through its web wallet or phone app).

## Quick start

You need Node.js 22.18 or later. `.nvmrc` names the exact version the official builds use.

```sh
git clone https://github.com/txngroup/wtt.git
cd wtt
npm ci
npm run dev
```

The dev server runs at http://localhost:5173. Browser wallets work right away. WalletConnect needs a project id; see
[Configuration](#configuration).

| Command | Does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm run check` | Type-check the TypeScript and Svelte code |
| `npm run verify -- <url> [dir]` | Check that a site serves exactly the files of a build (default `dist/`) |
| `npm run og-image` | Regenerate `public/og.png`, the social preview card, with your domain on it (needs Chrome) |

## Configuration

Copy `.env.example` to `.env` and fill in what you need. Both settings are optional. The build reads them, so rebuild
after a change.

| Variable | Used for |
|---|---|
| `SITE_URL` | The public address of your copy, such as `https://wtt.example.org`. The build uses it for canonical links, the social card image, `robots.txt` and `sitemap.xml`, and leaves them out without it. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables WalletConnect for phone wallets. Create a free project at https://dashboard.reown.com and add your domain, and `http://localhost:5173` for development, to its allowlist. Without it, only browser wallets are offered. |

Each site needs its own WalletConnect project id, because WalletConnect's relay only accepts the domains listed for
the project.

The app reads chain data from public endpoints: Nodely for Algorand, PublicNode for Solana and for EVM reads over
WalletConnect, and Wormholescan for signed transfers. They are set in `src/lib/algorand.ts`, `src/lib/solana.ts` and
`src/lib/wormhole.ts`.

## Verifying the site

Each push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) in public. It builds the site once,
publishes that build as a [GitHub Release](https://github.com/txngroup/wtt/releases), and uploads the same files to
the host. Releases are named by their UTC build time, such as `v2026.10.23-115029`, and each one holds:

- `wtt-<release>.zip`: the whole site, exactly as uploaded.
- `SHA256SUMS`: the SHA-256 of every file in it.
- The IPFS CID of the site, and the build settings, in the release notes.
- A GitHub build attestation, which proves the zip came from that workflow and commit.

There are three ways to check the site, from quickest to strongest.

**Compare the live site with a release.** This needs a clone of the repository and the GitHub CLI (`gh`):

```sh
gh release download --repo txngroup/wtt --pattern 'wtt-*.zip'
gh attestation verify wtt-*.zip --repo txngroup/wtt
unzip -q wtt-*.zip -d release
npm run verify -- https://wtt.txn.group release
```

The last command downloads every file the way a browser would and compares it with the release. The live check
badge at the top runs the same check every hour and after every deploy.

**Rebuild it yourself.** Check out the release's commit, use the Node version in `.nvmrc`, and set the two settings
from the release notes in `.env`. Then build and compare with the release's `SHA256SUMS`:

```sh
npm ci && npm run build
(cd dist && find . -type f | LC_ALL=C sort | xargs shasum -a 256) | diff - SHA256SUMS && echo identical
```

The same commit, settings and Node version give byte-identical files. With IPFS's `ipfs` command (kubo) you can also
compute the CID without any network access and compare it with the release notes:
`ipfs add --only-hash --recursive --cid-version=1 --quieter dist`.

**Run your own copy.** The app has no backend, so a copy on your own computer works like the hosted one. Build it from
source with the [quick start](#quick-start) and `npm run build && npm run preview`, or unzip a verified release and
serve the folder with any static file server, such as `python3 -m http.server 8080 -d release`. Browser wallets work
on `localhost`. WalletConnect only works on addresses its project lists.

## Hosting your own copy

`npm run build` writes a plain static site to `dist/`. Each page is pre-rendered as `<page>/index.html`, so any static
host works without rewrite rules.

Serve the site over HTTPS with the security headers in `dist/_headers`. The most important is the
Content-Security-Policy. It limits scripts to the site's own files, and network requests to the APIs and wallet
services the app uses, so a compromised dependency cannot send data anywhere else. The policy is defined in
`vite.config.ts`. Every page also carries it as a `<meta>` tag, for hosts that cannot send headers.

### Cloudflare Pages, deployed by GitHub Actions

This is how https://wtt.txn.group runs, and it works the same for a fork. Cloudflare Pages' free plan covers it.

1. Fork this repository.
2. In Cloudflare, create a Pages project for direct upload, for example with
   `npx wrangler pages project create <name> --production-branch main`. Then create an API token with the
   "Cloudflare Pages: Edit" permission.
3. In your fork's Settings, under Secrets and variables, then Actions, add:
   - Secrets: `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` (shown on the Cloudflare dashboard).
   - Variables: `CLOUDFLARE_PAGES_PROJECT` (the project name), `SITE_URL`, and optionally `WALLETCONNECT_PROJECT_ID`.
     Set `LIVE_CHECK_URL` to your site's address to turn on the hourly live check.
4. Push to `main`, or run the CI workflow by hand. The site appears at `https://<project>.pages.dev`.
5. To use your own domain, add it to the Pages project under Custom domains, and point a `CNAME` record at
   `<project>.pages.dev` with your DNS provider.

Leave Cloudflare's features that change pages turned off, such as Web Analytics injection, so the live site keeps
matching the release.

### Any other static host

Upload the contents of `dist/`. Netlify reads `dist/_headers` as Cloudflare does. Elsewhere, send the same headers
from the host's configuration, and serve `404.html` with a 404 status for any address that does not exist, so search
engines do not index mistyped links. With nginx, for example:

```nginx
server {
    listen 443 ssl;
    server_name wtt.example.org;
    root /var/www/wtt;  # the contents of dist/
    error_page 404 /404.html;

    # One add_header line per header under "/*" in dist/_headers, for example:
    add_header Content-Security-Policy "<the policy from dist/_headers>" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
}
```

In nginx, a `location` with its own `add_header` drops the server-level ones, so a fuller config repeats the security
headers there too.

## How it works

The Wormhole SDK, `@solana/web3.js`, ethers, viem and the Wallet Standard packages are deliberately not used. The
parts of them the app needs are hand-written in `src/lib/`, and checked byte for byte against the official libraries
(see [Tests](#tests)).

| File | Contents |
|---|---|
| `src/lib/wormhole.ts` | Chain list, VAA parser, Wormholescan lookups |
| `src/lib/algorand.ts` | Wrapped-asset discovery and the `sendTransfer` group builder |
| `src/lib/algorand-redeem.ts` | Storage logic signatures, and the `verifySigs`, `verifyVAA` and `completeTransfer` redeem group |
| `src/lib/evm.ts` | EIP-6963 discovery, `completeTransfer` and `completeTransferAndUnwrapETH` calldata, simulation |
| `src/lib/evm-send.ts` | Token info, `wrapAndTransferETH`, `approve` and `transferTokens`, sequence from the receipt |
| `src/lib/solana.ts` | Redeem (`verify_signatures`, `post_vaa`, `complete_*`) and send (`transfer_native`, `transfer_wrapped`) |
| `src/lib/solana-tx.ts` | The `@solana/web3.js` subset the app uses: `PublicKey` and PDAs, `Keypair`, legacy `Transaction`, a fetch-based `Connection` |
| `src/lib/solana-wallets.ts` | Wallet Standard discovery and signing |
| `src/lib/walletconnect.ts` | WalletConnect v2 sessions, exposed as an EIP-1193 provider or a Wallet Standard-like Solana wallet |
| `src/lib/near.ts` | NEAR token bridge: account registry, redeem (`submit_vaa`) and send (`send_transfer_near`, `send_transfer_wormhole_token`), sequence from the publish event |
| `src/lib/near-tx.ts` | NEAR transactions in their borsh wire format, the near-api-js subset the app uses |
| `src/lib/near-wallets.ts` | Meteor (extension or web wallet popup) and HOT (extension, or the HOT app through its relay and a QR code) |
| `src/lib/activity.ts` | Transfer history from Wormholescan, re-checked on the destination chain when Wormholescan has no redeem |
| `src/lib/config.ts` | Build-time settings from `.env` |

The pages are listed once, in `src/pages.ts`. `src/lib/router.svelte.ts` switches between them in place. At build time
a plugin in `vite.config.ts` writes a pre-rendered `<page>/index.html` for each page with its own title, description,
social card tags and readable text, so every page can be linked and indexed. The same plugin writes `_headers`,
`robots.txt` and `sitemap.xml`. The overview text lives in `src/overview.html`.

A wallet bar at the top holds one Algorand, one EVM and one Solana connection for the whole site. The EVM and Solana
choices are remembered in the browser and restored on the next visit. Amount fields start empty with a Max button,
and Max on a chain's own coin keeps back an estimate of the fees the transfer needs.

When the receiver signs an Algorand redeem, the app adds the receiver's ASA opt-in to the redeem group.

### Dependencies

Runtime: `algosdk`, `@txnlab/use-wallet` with its Svelte, Pera and Lute packages, `@noble/hashes` and `@noble/curves`,
and `@walletconnect/sign-client` with `qrcode-generator`. The Solana and WalletConnect code is loaded only when it is
needed. Build: `vite`, `svelte` and `@sveltejs/vite-plugin-svelte`. Deploy: `wrangler`, kept in
`deploy/cloudflare/` so that building the site never installs it.

Every package is pinned to an exact version at least two weeks old. `.npmrc` enforces this for every npm command in
the project: no install scripts run, new packages are saved at an exact version, and npm resolves only versions
published at least 14 days ago. `npm audit signatures` checks the installed packages against the registry's
signatures, and CI runs it too. The GitHub Actions in the workflows are pinned to commits.

## Tests

`test/` has read-only checks against mainnet, and the SDK diffs compare the hand-written builders with the Wormhole SDK
6.1.5, `@solana/web3.js` 1.99.0 and `near-api-js` 1.1.0. Every Solana instruction and transaction, the Algorand redeem
group and every NEAR transaction came out identical. `npm run test:sdk` installs those libraries, at pinned versions
checked by hash, runs the diffs and removes them again, and `npm run test:sdk:docker` does the same in a throwaway
container. The site itself never installs them. [test/README.md](test/README.md) lists the commands.

## Limits

- From Algorand, only Wormhole-wrapped assets can be sent, each back to its origin chain. Native Algorand assets such
  as ALGO or USDC cannot be sent out.
- A token can only be sent to Algorand if it already has a wrapped asset there. An attest flow (`attestToken` on the
  origin chain, then `createWrapped` on Algorand) would add the rest.
- Only plain token transfers are supported, not transfers that carry a payload for another app.
- Algorand wallets connect through use-wallet's own Pera and Lute adapters, not WalletConnect.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
