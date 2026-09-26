#!/usr/bin/env bash
# Permanently disable the mint authority, fixing the JOB supply forever. IRREVERSIBLE.
# Only run this after every intended mint/distribution step on this cluster is done.
#
# Usage: scripts/finalize-mint.sh <localnet|devnet|mainnet>
#   CONFIRM_MINT=<mint address> skips the interactive prompt (used by the test suite).
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
MINT="$(deployment_get mint)"
current="$(json_get "$(spl display "$MINT" --output json)" mintAuthority)"
if [[ -z "$current" ]]; then
  info "Mint authority on $MINT is already disabled."
  exit 0
fi

cat <<EOF

  You are about to PERMANENTLY disable the mint authority on $CLUSTER.
    Mint:    $MINT
    Supply:  $TOKEN_SUPPLY $TOKEN_SYMBOL (fixed forever after this)
  This cannot be undone. Make sure all allocations are distributed first.

EOF
answer="${CONFIRM_MINT:-}"
[[ -n "$answer" ]] || read -r -p "Type the mint address to confirm: " answer
[[ "$answer" == "$MINT" ]] || die "confirmation did not match; nothing changed."

out="$(spl authorize "$MINT" mint --disable --output json)"
deployment_set status "finalized" mintAuthorityDisabled "true" \
  signatures.disableMintAuthority "$(json_get "$out" signature)"
info "Mint authority disabled."

"$(dirname "$0")/verify-token.sh" "$CLUSTER" --final
