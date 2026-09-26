#!/usr/bin/env bash
# Lock the development allocation in an irrevocable Streamflow vesting contract:
# nothing unlocks for DEV_VESTING_CLIFF_DAYS, then it unlocks daily until
# DEV_VESTING_TOTAL_DAYS (see config/token.env). Nobody can cancel it.
#
# Usage: scripts/lock-development.sh <localnet|devnet>
#   VESTING_RECIPIENT=<address>  who receives unlocked tokens (default: the development wallet)
#   CONFIRM_LOCK=lock            skips the interactive prompt (used by the test suite)
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ "$CLUSTER" != mainnet ]] || die "mainnet vesting must be signed by a hardware wallet or multisig; this script only handles localnet/devnet."
command -v node >/dev/null || die "node not found (install Node.js 20+)"
[[ -d "$REPO_ROOT/node_modules/@streamflow/stream" ]] || die "dependencies missing: run 'npm ci' in $REPO_ROOT"
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"

MINT="$(deployment_get mint)"
WALLET="$(deployment_get_or_empty allocations.development.wallet)"
[[ -n "$WALLET" && -n "$(deployment_get_or_empty allocations.development.signature)" ]] \
  || die "development allocation not distributed yet; run scripts/distribute.sh $CLUSTER first"
existing="$(deployment_get_or_empty allocations.development.vesting.streamId)"
[[ -z "$existing" ]] || die "development allocation is already locked in stream $existing"

SENDER_KEYPAIR="$KEYS_DIR/$CLUSTER/wallets/development.json"
[[ -f "$SENDER_KEYPAIR" ]] || die "development wallet key not found at $SENDER_KEYPAIR"
[[ "$(solana-keygen pubkey "$SENDER_KEYPAIR")" == "$WALLET" ]] || die "key at $SENDER_KEYPAIR does not match the development wallet"
RECIPIENT="${VESTING_RECIPIENT:-$WALLET}"

AMOUNT="$(allocation_amount development)"
AMOUNT_BASE=$(( AMOUNT * UNITS ))
balance_base="$(token_balance_base "$WALLET")"
(( balance_base == AMOUNT_BASE )) || die "development wallet holds $(( balance_base / UNITS )) JOB, expected $AMOUNT"

# Streamflow charges a creation fee in SOL (~0.09) plus account rent; the development wallet pays it.
sol_lamports="$(sol balance "$WALLET" --lamports | awk '{print $1}')"
if (( sol_lamports < 150000000 )); then
  die "development wallet needs at least 0.15 SOL for Streamflow fees (has $(awk "BEGIN{printf \"%.3f\", $sol_lamports/1e9}") SOL). Fund it with:
  solana transfer $WALLET 0.2 --url $(redact_url "$RPC_URL") --allow-unfunded-recipient"
fi

# Schedule: unlocking starts after the cliff and runs daily until the end. The integer
# remainder (a few base units) is released at the start so the total is exact.
DAY=86400
(( DEV_VESTING_TOTAL_DAYS > DEV_VESTING_CLIFF_DAYS )) || die "DEV_VESTING_TOTAL_DAYS must exceed DEV_VESTING_CLIFF_DAYS"
NOW="$(date +%s)"
START=$(( NOW + DEV_VESTING_CLIFF_DAYS * DAY ))
PERIODS=$(( DEV_VESTING_TOTAL_DAYS - DEV_VESTING_CLIFF_DAYS ))
PER_PERIOD_BASE=$(( AMOUNT_BASE / PERIODS ))
CLIFF_AMOUNT_BASE=$(( AMOUNT_BASE - PER_PERIOD_BASE * PERIODS ))
END=$(( START + PERIODS * DAY ))

cat <<EOF

  Irrevocable vesting contract for the development allocation on $CLUSTER
    Amount:       $AMOUNT JOB (from $WALLET)
    Recipient:    $RECIPIENT
    Locked until: $(date -u -d "@$START" '+%Y-%m-%d %H:%M UTC')  (${DEV_VESTING_CLIFF_DAYS}-day cliff, nothing unlocks before)
    Then:         ~$(( PER_PERIOD_BASE / UNITS )) JOB unlocks per day
    Fully vested: $(date -u -d "@$END" '+%Y-%m-%d %H:%M UTC')
    Cancelable:   NO, by nobody. This cannot be undone.

EOF
answer="${CONFIRM_LOCK:-}"
[[ -n "$answer" ]] || read -r -p "  Type 'lock' to create the contract: " answer
[[ "$answer" == "lock" ]] || die "not confirmed; nothing was locked."

out="$(JC_RPC_URL="$RPC_URL" JC_SENDER_KEYPAIR="$SENDER_KEYPAIR" JC_RECIPIENT="$RECIPIENT" \
  JC_MINT="$MINT" JC_AMOUNT_BASE="$AMOUNT_BASE" JC_START="$START" JC_PERIOD="$DAY" \
  JC_CLIFF_AMOUNT_BASE="$CLIFF_AMOUNT_BASE" JC_AMOUNT_PER_PERIOD_BASE="$PER_PERIOD_BASE" \
  JC_NAME="JOB development vesting" node "$REPO_ROOT/scripts/vesting.mjs" create)"

deployment_set \
  allocations.development.vesting.provider "streamflow" \
  allocations.development.vesting.streamId "$(json_get "$out" streamId)" \
  allocations.development.vesting.signature "$(json_get "$out" signature)" \
  allocations.development.vesting.recipient "$RECIPIENT" \
  allocations.development.vesting.start "$START" \
  allocations.development.vesting.end "$END" \
  allocations.development.vesting.cliffDays "$DEV_VESTING_CLIFF_DAYS" \
  allocations.development.vesting.totalDays "$DEV_VESTING_TOTAL_DAYS"
info "Locked. Stream: $(json_get "$out" streamId)"

"$(dirname "$0")/verify-token.sh" "$CLUSTER"
