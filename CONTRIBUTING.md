# Contributing

Issues and pull requests are welcome. For anything larger than a small fix, open an issue first so we can agree on
the approach.

## Setup

```sh
npm ci
npm run dev
```

`npm run check` type-checks the project and `npm run build` must pass; CI runs both on every pull request.

## Conventions

- Keep the dependency list short. The Wormhole SDK, `@solana/web3.js`, ethers and viem are deliberately not used;
  `src/lib/` holds hand-written equivalents of the parts the app needs.
- A change to a transaction builder in `src/lib/` needs a matching check in `test/`. For the Solana and Algorand
  redeem builders, run the SDK diffs in `test/sdk/` and include their output in the pull request.
- New dependencies are pinned to an exact version at least 14 days old. `.npmrc` enforces this for `npm install`.
- A new RPC, API or wallet host must also be added to `connect-src` in the Content-Security-Policy in `vite.config.ts`.
- Match the style of the surrounding code: two-space indent, no semicolons, single quotes, lines up to about 120
  characters, and short comments that say why.
