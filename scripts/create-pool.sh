#!/usr/bin/env bash
# Create the JOB/SOL liquidity pool on Raydium (CPMM) with the whole liquidity allocation
# and POOL_SEED_SOL of SOL (config/token.env). The ratio sets the starting price.
#
# Usage: scripts/create-pool.sh <localnet|devnet>
#   CONFIRM_POOL=pool   skips the interactive prompt (used by the test suite)
#
# Afterwards lock the LP tokens with scripts/lock-liquidity.sh.
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ "$CLUSTER" != mainnet ]] || die "mainnet pool creation must be signed by a hardware wallet or multisig; this script only handles localnet/devnet."
require_node_deps "@raydium-io/raydium-sdk-v2"
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
[[ -n "$(deployment_get_or_empty allocations.liquidity.signature)" ]] \
  || die "liquidity allocation not distributed yet; run scripts/distribute.sh $CLUSTER first"
existing="$(deployment_get_or_empty allocations.liquidity.pool.poolId)"
[[ -z "$existing" ]] || die "the liquidity pool already exists: $existing"

MINT="$(deployment_get mint)"
OWNER_KEYPAIR="$(allocation_keypair liquidity)"
WALLET="$(deployment_get allocations.liquidity.wallet)"
AMOUNT="$(allocation_amount liquidity)"
AMOUNT_BASE=$(( AMOUNT * UNITS ))
balance_base="$(token_balance_base "$WALLET")"
(( balance_base == AMOUNT_BASE )) || die "liquidity wallet holds $(( balance_base / UNITS )) JOB, expected $AMOUNT"

SEED_LAMPORTS="$(awk "BEGIN{printf \"%d\", $POOL_SEED_SOL * 1e9}")"
(( SEED_LAMPORTS > 0 )) || die "POOL_SEED_SOL must be greater than 0"
# Raydium charges a 0.15 SOL creation fee, plus rent for the pool accounts and later the
# lock NFT; keep a margin so no step fails halfway.
NEEDED=$(( SEED_LAMPORTS + 150000000 + 100000000 ))
have="$(lamports_of "$WALLET")"
if (( have < NEEDED )); then
  die "liquidity wallet has $(fmt_sol "$have") SOL but needs $(fmt_sol "$NEEDED") (seed $(fmt_sol "$SEED_LAMPORTS") + 0.15 Raydium fee + 0.1 for accounts). Fund it with:
  solana transfer $WALLET $(fmt_sol $(( NEEDED - have + 1000000 ))) --url $(redact_url "$RPC_URL") --allow-unfunded-recipient"
fi

cat <<EOF

  Create a public JOB/SOL pool on Raydium ($CLUSTER)
    Deposit:        $AMOUNT JOB + $(fmt_sol "$SEED_LAMPORTS") SOL (from $WALLET)
    Starting price: $(awk "BEGIN{printf \"%.12f\", $SEED_LAMPORTS / 1e9 / $AMOUNT}") SOL per JOB
                    ($(awk "BEGIN{printf \"%.0f\", $AMOUNT / ($SEED_LAMPORTS / 1e9)}") JOB per 1 SOL)
    Trading fee:    fee tier $POOL_FEE_CONFIG_INDEX (0 = 0.25% per trade)
    Raydium fee:    0.15 SOL, one-time
  Once created, anyone can trade against the pool.

EOF
answer="${CONFIRM_POOL:-}"
[[ -n "$answer" ]] || read -r -p "  Type 'pool' to create it: " answer
[[ "$answer" == "pool" ]] || die "not confirmed; nothing was created."

out="$(JC_RPC_URL="$RPC_URL" JC_OWNER_KEYPAIR="$OWNER_KEYPAIR" JC_MINT="$MINT" JC_DECIMALS="$TOKEN_DECIMALS" \
  JC_TOKEN_AMOUNT_BASE="$AMOUNT_BASE" JC_SOL_LAMPORTS="$SEED_LAMPORTS" \
  JC_FEE_CONFIG_INDEX="$POOL_FEE_CONFIG_INDEX" node "$REPO_ROOT/scripts/pool.mjs" create)"

deployment_merge_json allocations.liquidity.pool "$out"
deployment_set \
  allocations.liquidity.pool.dex "raydium-cpmm" \
  allocations.liquidity.pool.seedLamports "$SEED_LAMPORTS" \
  allocations.liquidity.pool.tokenAmount "$AMOUNT" \
  allocations.liquidity.pool.createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "Pool created: $(json_get "$out" poolId)"

"$(dirname "$0")/verify-token.sh" "$CLUSTER"
echo
info "Next: permanently lock the LP tokens with scripts/lock-liquidity.sh $CLUSTER"
