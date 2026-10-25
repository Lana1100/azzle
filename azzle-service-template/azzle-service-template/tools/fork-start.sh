#!/usr/bin/env bash
# Start a fresh anvil fork of Base mainnet (chainId 8453) on :8545. Restart before every E2E run:
# the time-warp scenarios make the oracle stale for later posts.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
nohup anvil --fork-url "${FORK_URL:-https://mainnet.base.org}" --port 8545 --host 127.0.0.1 --silent > /tmp/anvil.log 2>&1 &
for i in $(seq 1 60); do cast chain-id -r http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 1; done
echo "anvil fork up: chainId $(cast chain-id -r http://127.0.0.1:8545) block $(cast block-number -r http://127.0.0.1:8545)"
