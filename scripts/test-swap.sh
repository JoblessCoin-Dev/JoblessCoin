#!/usr/bin/env bash
# Make a TEST trade against the JOB/SOL pool from your main wallet, to watch the price move
# and trading fees accumulate. Localnet/devnet only.
#
# Usage: scripts/test-swap.sh <localnet|devnet> buy  <SOL to spend>
#        scripts/test-swap.sh <localnet|devnet> sell <JOB to sell>
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"
SIDE="${2:-}"
AMOUNT="${3:-}"

# On mainnet the team trading its own token looks like (and can be) market manipulation.
[[ "$CLUSTER" != mainnet ]] || die "test swaps are for localnet/devnet only; the team does not trade JOB on mainnet."
require_node_deps "@raydium-io/raydium-sdk-v2"
[[ "$SIDE" == buy || "$SIDE" == sell ]] && [[ "$AMOUNT" =~ ^[0-9]+([.][0-9]+)?$ ]] \
  || die "usage: $(basename "$0") <localnet|devnet> <buy SOL-amount | sell JOB-amount>"
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
POOL_ID="$(deployment_get_or_empty allocations.liquidity.pool.poolId)"
[[ -n "$POOL_ID" ]] || die "no pool yet; run scripts/create-pool.sh $CLUSTER first"
MINT="$(deployment_get mint)"
TRADER="$(solana-keygen pubkey "$KEYPAIR")"

if [[ "$SIDE" == buy ]]; then
  AMOUNT_BASE="$(awk "BEGIN{printf \"%d\", $AMOUNT * 1e9}")"
  (( $(lamports_of "$TRADER") >= AMOUNT_BASE + 20000000 )) || die "$TRADER needs more than $AMOUNT SOL (plus fees)"
else
  AMOUNT_BASE="$(awk "BEGIN{printf \"%d\", $AMOUNT * $UNITS}")"
  (( $(token_balance_base "$TRADER") >= AMOUNT_BASE )) || die "$TRADER holds less than $AMOUNT JOB"
fi

show() {
  local p
  p="$(JC_RPC_URL="$RPC_URL" JC_POOL_ID="$POOL_ID" node "$REPO_ROOT/scripts/pool.mjs" info)"
  python3 - "$p" "$MINT" "$1" <<'PY'
import json, sys
p, mint, label = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]
job, sol = (int(p["reserveA"]), int(p["reserveB"])) if p["mintA"] == mint else (int(p["reserveB"]), int(p["reserveA"]))
print(f"  {label:<7} pool {job / 1e9:>15,.0f} JOB + {sol / 1e9:>9.4f} SOL   price {job / sol:>13,.0f} JOB per SOL")
PY
}

echo
show before
out="$(JC_RPC_URL="$RPC_URL" JC_OWNER_KEYPAIR="$KEYPAIR" JC_POOL_ID="$POOL_ID" JC_MINT="$MINT" \
  JC_SIDE="$SIDE" JC_AMOUNT_BASE="$AMOUNT_BASE" node "$REPO_ROOT/scripts/pool.mjs" swap)"
show after
python3 - "$out" <<'PY'
import json, sys
o = json.loads(sys.argv[1])
got = int(o["outputAmount"]) / 1e9
fee = int(o["tradeFee"]) / 1e9
if o["side"] == "buy":
    print(f"  bought ~{got:,.0f} JOB for {int(o['inputAmount']) / 1e9:.4f} SOL (fee {fee:.6f} SOL)")
else:
    print(f"  sold {int(o['inputAmount']) / 1e9:,.0f} JOB for ~{got:.6f} SOL (fee {fee:,.0f} JOB)")
print(f"  tx {o['signature']}")
PY
