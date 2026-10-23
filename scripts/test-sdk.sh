#!/bin/sh
# The SDK diffs: install the pinned comparison libraries in test/sdk, verify them, run every diff against mainnet, and
# remove the libraries again.
#
#   npm run test:sdk           on this machine (the site's own packages must be installed: npm ci)
#   npm run test:sdk:docker    the same, inside a throwaway container (scripts/test-sdk-docker.sh)
#
# test/sdk/package-lock.json pins every library and every package under it by version and SHA-512, so npm ci refuses
# any download that does not match, and test/sdk/.npmrc stops packages running code at install time. Their code does
# run during the diffs; that is what a diff is. The site's build never installs any of it.
set -eu
cd "$(dirname "$0")/.."
[ -d node_modules ] || { echo "install the site's packages first: npm ci" >&2; exit 1; }
cd test/sdk
trap 'rm -rf node_modules' EXIT
npm ci --no-audit --no-fund
npm audit signatures
status=0
for diff in compare-solana.mjs compare-solana-tx.mjs compare-algorand-redeem.mjs compare-near.mjs; do
  printf '\n== %s\n' "$diff"
  node "$diff" || status=1
done
[ "$status" = 0 ] && printf '\nALL SDK DIFFS PASSED\n' || printf '\nSOME SDK DIFFS FAILED\n'
exit "$status"
