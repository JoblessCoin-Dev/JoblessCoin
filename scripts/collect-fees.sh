#!/usr/bin/env bash
# Show, and optionally collect, the trading fees earned by the locked liquidity. Fees go to
# the Fee Key NFT holder (the liquidity wallet); the locked liquidity itself never moves.
#
# Usage: scripts/collect-fees.sh <localnet|devnet>           # show what's claimable
#        scripts/collect-fees.sh <localnet|devnet> --collect # collect it
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"
COLLECT=0
[[ "${2:-}" == "--collect" ]] && COLLECT=1

[[ "$CLUSTER" != mainnet ]] || die "mainnet fee collection must be signed by the hardware wallet holding the Fee Key NFT; this script only handles localnet/devnet."
require_node_deps "@raydium-io/raydium-sdk-v2"
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
LOCK_PDA="$(deployment_get_or_empty allocations.liquidity.pool.lock.lockPda)"
[[ -n "$LOCK_PDA" ]] || die "the LP tokens aren't locked yet; run scripts/lock-liquidity.sh $CLUSTER first"
WALLET="$(deployment_get allocations.liquidity.wallet)"

f="$(JC_RPC_URL="$RPC_URL" JC_LOCK_PDA="$LOCK_PDA" node "$REPO_ROOT/scripts/pool.mjs" fees)"
LP="$(json_get "$f" claimableLp)"
echo
echo "  Claimable trading fees (Fee Key holder: $WALLET)"
python3 - "$f" "$TOKEN_DECIMALS" <<'PY'
import json, sys
f, d = json.loads(sys.argv[1]), 10 ** int(sys.argv[2])
print(f"    ~{int(f['estJob']) / d:,.0f} JOB + ~{int(f['estSol']) / 1e9:.6f} SOL  ({f['claimableLp']} LP units)")
PY
echo

if (( ! COLLECT )); then
  info "Run with --collect to claim them."
  exit 0
fi
(( LP > 0 )) || die "nothing to collect yet"

OWNER_KEYPAIR="$(allocation_keypair liquidity)"
(( $(lamports_of "$WALLET") >= 10000000 )) || die "liquidity wallet needs at least 0.01 SOL for the transaction"
out="$(JC_RPC_URL="$RPC_URL" JC_OWNER_KEYPAIR="$OWNER_KEYPAIR" JC_LOCK_PDA="$LOCK_PDA" \
  node "$REPO_ROOT/scripts/pool.mjs" harvest)"
deployment_set \
  allocations.liquidity.pool.lastFeeClaim.signature "$(json_get "$out" signature)" \
  allocations.liquidity.pool.lastFeeClaim.lpAmount "$(json_get "$out" lpFeeAmount)" \
  allocations.liquidity.pool.lastFeeClaim.at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "Collected. tx $(json_get "$out" signature)"

"$(dirname "$0")/verify-token.sh" "$CLUSTER"
