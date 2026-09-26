#!/usr/bin/env bash
# Create the JoblessCoin Token-2022 mint with on-chain metadata and mint the full supply
# into the payer's associated token account.
#
# Usage: scripts/create-token.sh <localnet|devnet|mainnet>
#
# The mint authority is deliberately kept so distribution can happen first.
# Disable it afterwards with scripts/finalize-mint.sh.
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"

if [[ -f "$DEPLOYMENT_FILE" ]]; then
  [[ "${FORCE_NEW:-}" == 1 ]] || die "$DEPLOYMENT_FILE already exists (mint $(deployment_get mint)).
Refusing to create a second $CLUSTER mint. Set FORCE_NEW=1 to archive the record and start over."
  mkdir -p "$DEPLOYMENTS_DIR/archive"
  archived="$DEPLOYMENTS_DIR/archive/$CLUSTER-$(date +%Y%m%d-%H%M%S).json"
  mv "$DEPLOYMENT_FILE" "$archived"
  info "Archived previous record to $archived"
fi

PAYER="$(solana-keygen pubkey "$KEYPAIR")"
BALANCE_LAMPORTS="$(sol balance --lamports | awk '{print $1}')"
info "Payer: $PAYER ($BALANCE_LAMPORTS lamports)"
(( BALANCE_LAMPORTS >= 50000000 )) || die "need at least 0.05 SOL on $CLUSTER to create the token"

# The mint keypair only signs the mint account's creation; it has no authority afterwards.
# It is kept outside the repo so it can never be committed.
mkdir -p "$KEYS_DIR/$CLUSTER"
chmod 700 "$KEYS_DIR" "$KEYS_DIR/$CLUSTER"
MINT_KEYPAIR="${MINT_KEYPAIR:-$KEYS_DIR/$CLUSTER/mint-$(date +%Y%m%d-%H%M%S).json}"
[[ -f "$MINT_KEYPAIR" ]] || solana-keygen new --no-bip39-passphrase --silent -o "$MINT_KEYPAIR" >/dev/null
chmod 600 "$MINT_KEYPAIR"
MINT="$(solana-keygen pubkey "$MINT_KEYPAIR")"

info "Creating Token-2022 mint $MINT (decimals $TOKEN_DECIMALS, metadata enabled, no freeze authority)"
out="$(spl --program-id "$TOKEN_2022_PROGRAM_ID" create-token --enable-metadata \
  --decimals "$TOKEN_DECIMALS" "$MINT_KEYPAIR" --output json)"
deployment_set \
  cluster "$CLUSTER" \
  status "mint-created" \
  mint "$MINT" \
  programId "$TOKEN_2022_PROGRAM_ID" \
  decimals "$TOKEN_DECIMALS" \
  authority "$PAYER" \
  createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  signatures.createMint "$(json_get "$out" commandOutput.transactionData.signature)"

info "Writing metadata: $TOKEN_NAME / $TOKEN_SYMBOL / $TOKEN_URI"
out="$(spl initialize-metadata "$MINT" "$TOKEN_NAME" "$TOKEN_SYMBOL" "$TOKEN_URI" --output json)"
deployment_set status "metadata-set" \
  metadata.name "$TOKEN_NAME" metadata.symbol "$TOKEN_SYMBOL" metadata.uri "$TOKEN_URI" \
  signatures.initializeMetadata "$(json_get "$out" signature)"

info "Creating associated token account"
out="$(spl create-account "$MINT" --output json)"
TOKEN_ACCOUNT="$(json_get "$(spl --program-id "$TOKEN_2022_PROGRAM_ID" address --token "$MINT" --verbose --output json)" associatedTokenAddress)"
deployment_set status "account-created" tokenAccount "$TOKEN_ACCOUNT" \
  signatures.createAccount "$(json_get "$out" signature)"

info "Minting $TOKEN_SUPPLY $TOKEN_SYMBOL to $TOKEN_ACCOUNT"
out="$(spl mint "$MINT" "$TOKEN_SUPPLY" --output json)"
deployment_set status "minted" supply "$TOKEN_SUPPLY" mintAuthorityDisabled "false" \
  signatures.mintSupply "$(json_get "$out" signature)"

info "Saved $DEPLOYMENT_FILE"
"$(dirname "$0")/verify-token.sh" "$CLUSTER"

echo
info "Next: distribute the allocations, then run scripts/finalize-mint.sh $CLUSTER"
