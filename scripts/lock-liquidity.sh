#!/usr/bin/env bash
# Permanently lock all LP tokens of the JOB/SOL pool with Raydium "Burn & Earn".
# The liquidity can never be withdrawn by anyone; trading fees stay claimable by whoever
# holds the Fee Key NFT, which is sent to the liquidity wallet. IRREVERSIBLE.
#
# Usage: scripts/lock-liquidity.sh <localnet|devnet>
#   CONFIRM_BURN=burn   skips the interactive prompt (used by the test suite)
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ "$CLUSTER" != mainnet ]] || die "mainnet LP locking must be signed by a hardware wallet or multisig; this script only handles localnet/devnet."
require_node_deps "@raydium-io/raydium-sdk-v2"
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
POOL_ID="$(deployment_get_or_empty allocations.liquidity.pool.poolId)"
[[ -n "$POOL_ID" ]] || die "no pool yet; run scripts/create-pool.sh $CLUSTER first"
[[ -z "$(deployment_get_or_empty allocations.liquidity.pool.lock.signature)" ]] \
  || die "the LP tokens are already locked"

OWNER_KEYPAIR="$(allocation_keypair liquidity)"
WALLET="$(deployment_get allocations.liquidity.wallet)"
(( $(lamports_of "$WALLET") >= 30000000 )) \
  || die "liquidity wallet needs at least 0.03 SOL for the lock transaction and Fee Key NFT"

pool="$(JC_RPC_URL="$RPC_URL" JC_POOL_ID="$POOL_ID" JC_OWNER="$WALLET" node "$REPO_ROOT/scripts/pool.mjs" info)"
LP="$(json_get "$pool" ownerLp)"
(( LP > 0 )) || die "the liquidity wallet holds no LP tokens for pool $POOL_ID"

cat <<EOF

  PERMANENT liquidity lock (Raydium Burn & Earn) on $CLUSTER
    Pool:        $POOL_ID
    LP tokens:   $LP (all of them, from $WALLET)
    After this:  the liquidity can NEVER be withdrawn, by anyone, including you.
    Fees:        trading fees stay claimable by the holder of the Fee Key NFT,
                 which goes to $WALLET. Losing that NFT loses the fees.

EOF
answer="${CONFIRM_BURN:-}"
[[ -n "$answer" ]] || read -r -p "  Type 'burn' to lock it forever: " answer
[[ "$answer" == "burn" ]] || die "not confirmed; nothing was locked."

out="$(JC_RPC_URL="$RPC_URL" JC_OWNER_KEYPAIR="$OWNER_KEYPAIR" JC_POOL_ID="$POOL_ID" \
  node "$REPO_ROOT/scripts/pool.mjs" lock)"
deployment_merge_json allocations.liquidity.pool.lock "$out"
deployment_set allocations.liquidity.pool.lock.lockedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "LP locked. Fee Key NFT: $(json_get "$out" nftMint 2>/dev/null || echo '(see deployment record)')"

"$(dirname "$0")/verify-token.sh" "$CLUSTER"
