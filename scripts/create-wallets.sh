#!/usr/bin/env bash
# Create one wallet per allocation in config/token.env (liquidity, community, development)
# and record their public addresses in deployments/<cluster>.json.
#
# Usage: scripts/create-wallets.sh <localnet|devnet>
#
# Safe to re-run: existing wallets are reused, never overwritten.
# Keys are stored outside the repo in $KEYS_DIR/<cluster>/wallets/ (chmod 600).
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ "$CLUSTER" != mainnet ]] || die "on mainnet, allocation wallets must be hardware wallets or a Squads multisig, not generated key files."
[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE; run create-token.sh $CLUSTER first"
allocations_check

WALLETS_DIR="$KEYS_DIR/$CLUSTER/wallets"
mkdir -p "$WALLETS_DIR"
chmod 700 "$KEYS_DIR" "$KEYS_DIR/$CLUSTER" "$WALLETS_DIR"

echo
printf "  %-12s %5s %15s   %s\n" ALLOCATION "%" "JOB" WALLET
for name in $(allocation_names); do
  keypair="$WALLETS_DIR/$name.json"
  [[ -f "$keypair" ]] || solana-keygen new --no-bip39-passphrase --silent -o "$keypair" >/dev/null
  chmod 600 "$keypair"
  address="$(solana-keygen pubkey "$keypair")"

  recorded="$(deployment_get_or_empty "allocations.$name.wallet")"
  [[ -z "$recorded" || "$recorded" == "$address" ]] \
    || die "deployment record already has a different $name wallet ($recorded); refusing to change it"

  deployment_set \
    "allocations.$name.wallet" "$address" \
    "allocations.$name.percent" "$(allocation_percent "$name")" \
    "allocations.$name.amount" "$(allocation_amount "$name")"
  printf "  %-12s %5s %15s   %s\n" "$name" "$(allocation_percent "$name")" "$(allocation_amount "$name")" "$address"
done

echo
info "Wallets recorded in $DEPLOYMENT_FILE"
info "Private keys: $WALLETS_DIR (outside the repo, owner-only permissions)"
info "Next: scripts/distribute.sh $CLUSTER"
