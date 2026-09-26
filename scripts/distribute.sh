#!/usr/bin/env bash
# Send each allocation from the token holder's account to its wallet
# (created by create-wallets.sh), then verify the result.
#
# Usage: scripts/distribute.sh <localnet|devnet|mainnet>
#   CONFIRM_DISTRIBUTION=distribute skips the interactive prompt (used by the test suite).
#
# Safe to re-run: allocations with a recorded transfer, or whose wallet already holds the
# exact amount, are skipped. Any other non-zero balance stops the script for manual review.
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
allocations_check
MINT="$(deployment_get mint)"
HOLDER="$(solana-keygen pubkey "$KEYPAIR")"
[[ "$HOLDER" == "$(deployment_get authority)" ]] \
  || die "signer $HOLDER is not the token holder recorded in $DEPLOYMENT_FILE"

# The deployment record is a public file anyone could propose changes to, so never send to
# an address from it without an independent source: the matching private key on this
# machine, or (for hardware/multisig wallets) TRUSTED_WALLET_<NAME> set by you.
trust_wallet() {
  local name="$1" wallet="$2" key="$KEYS_DIR/$CLUSTER/wallets/$1.json" var
  var="TRUSTED_WALLET_$(tr '[:lower:]' '[:upper:]' <<<"$name")"
  if [[ -f "$key" ]]; then
    [[ "$(solana-keygen pubkey "$key")" == "$wallet" ]] \
      || die "recorded $name wallet $wallet does not match your key $key. The deployment file may have been tampered with; nothing was sent."
  elif [[ -n "${!var:-}" ]]; then
    [[ "${!var}" == "$wallet" ]] \
      || die "recorded $name wallet $wallet does not match $var=${!var}; nothing was sent."
  else
    die "cannot confirm the $name wallet $wallet: no key at $key and $var is not set; nothing was sent."
  fi
}

pending=()
pending_total=0
echo
printf "  %-12s %15s %15s   %s\n" ALLOCATION "TARGET JOB" "CURRENT JOB" WALLET
for name in $(allocation_names); do
  wallet="$(deployment_get_or_empty "allocations.$name.wallet")"
  [[ -n "$wallet" ]] || die "no $name wallet recorded; run scripts/create-wallets.sh $CLUSTER first"
  [[ "$wallet" != "$HOLDER" ]] || die "$name wallet is the holder itself"
  trust_wallet "$name" "$wallet"
  target="$(allocation_amount "$name")"
  current_base="$(token_balance_base "$wallet")"
  printf "  %-12s %15s %15s   %s\n" "$name" "$target" "$(( current_base / UNITS ))" "$wallet"

  # A recorded transfer is final, even if the tokens have since moved on (vesting, pool).
  if [[ -n "$(deployment_get_or_empty "allocations.$name.signature")" ]]; then
    continue
  elif (( current_base == target * UNITS )); then
    continue
  elif (( current_base == 0 )); then
    pending+=("$name")
    pending_total=$(( pending_total + target ))
  else
    die "$name wallet holds an unexpected amount; resolve manually before distributing"
  fi
done
echo

if (( ${#pending[@]} == 0 )); then
  info "All allocations are already distributed."
else
  holder_base="$(token_balance_base "$HOLDER")"
  (( holder_base >= pending_total * UNITS )) \
    || die "holder has $(( holder_base / UNITS )) JOB but $pending_total JOB is still to be sent"

  echo "  About to send ${pending_total} JOB from $HOLDER on $CLUSTER to: ${pending[*]}"
  answer="${CONFIRM_DISTRIBUTION:-}"
  [[ -n "$answer" ]] || read -r -p "  Type 'distribute' to send: " answer
  [[ "$answer" == "distribute" ]] || die "not confirmed; nothing was sent."

  for name in "${pending[@]}"; do
    wallet="$(deployment_get "allocations.$name.wallet")"
    amount="$(allocation_amount "$name")"
    info "Sending $amount JOB to $name ($wallet)"
    out="$(spl transfer "$MINT" "$amount" "$wallet" --fund-recipient --allow-unfunded-recipient --output json)"
    deployment_set "allocations.$name.signature" "$(json_get "$out" signature)"
  done
fi

[[ "$(deployment_get status)" == "finalized" ]] || deployment_set status "distributed"
"$(dirname "$0")/verify-token.sh" "$CLUSTER"
echo
info "Next: lock the development allocation (vesting), then scripts/finalize-mint.sh $CLUSTER"
