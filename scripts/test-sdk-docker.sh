#!/bin/sh
# npm run test:sdk inside a throwaway container, so the comparison libraries never run on this machine.
#
# The container sees a read-only copy of the repository and nothing else of this machine: no home directory, no
# credentials, no SSH agent. It runs as an unprivileged user with every Linux capability dropped, a read-only root
# filesystem, and limits on memory and processes. It keeps the network, because the diffs read mainnet. Everything it
# installs lives in memory and is gone when it exits.
#
# The image is pinned by digest, so a re-pushed tag cannot change what runs. Its Node.js matches .nvmrc.
set -eu
cd "$(dirname "$0")/.."
IMAGE=node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
docker run --rm --init \
  --read-only --tmpfs /tmp:rw,exec,size=512m --tmpfs /work:rw,exec,size=2g,uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 2g \
  --user node --env HOME=/tmp --env npm_config_cache=/tmp/npm-cache \
  --volume "$PWD":/src:ro \
  "$IMAGE" sh -euc '
    # Only the files the diffs need, without any packages installed on the host.
    tar -C /src --exclude=node_modules -cf - package.json package-lock.json .npmrc src test scripts | tar -C /work -xf -
    cd /work
    npm ci --omit=dev --no-audit --no-fund
    npm audit signatures
    sh scripts/test-sdk.sh
  '
