#!/usr/bin/env bash
# Shared helpers for the JoblessCoin scripts. Source this file; don't run it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
# shellcheck source=../config/token.env
source "$REPO_ROOT/config/token.env"
set +a

SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
[[ -d "$SOLANA_BIN" ]] && PATH="$SOLANA_BIN:$PATH"
# nvm only loads in interactive shells; make its Node available to scripts too.
if ! command -v node >/dev/null; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do [[ -x "$d/node" ]] && PATH="$d:$PATH"; done
fi

TOKEN_2022_PROGRAM_ID="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"

# Overridable from the environment.
KEYPAIR="${KEYPAIR:-$HOME/.config/solana/id.json}"
KEYS_DIR="${KEYS_DIR:-$HOME/.config/joblesscoin/keys}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$REPO_ROOT/deployments}"

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

require_tools() {
  local t
  for t in solana solana-keygen spl-token python3; do
    command -v "$t" >/dev/null || die "missing required tool: $t"
  done
}

# Strip the query string so API keys never end up in logs.
redact_url() { echo "${1%%\?*}"; }

# setup_cluster <localnet|devnet|mainnet>
# Sets CLUSTER, RPC_URL, DEPLOYMENT_FILE and a private CLI config (SOLANA_CFG),
# then checks the RPC's genesis hash really belongs to that cluster.
# The global ~/.config/solana/cli/config.yml is never modified.
setup_cluster() {
  CLUSTER="${1:-}"
  local default_url expected_genesis=""
  case "$CLUSTER" in
    localnet) default_url="http://127.0.0.1:8899" ;;
    devnet)
      default_url="https://api.devnet.solana.com"
      expected_genesis="$DEVNET_GENESIS" ;;
    mainnet)
      [[ "${JOB_ALLOW_MAINNET:-}" == "I_UNDERSTAND_REAL_MONEY" ]] \
        || die "mainnet is locked. Read the Mainnet section of README.md first."
      [[ "$KEYPAIR" == usb://* ]] \
        || die "mainnet requires a hardware wallet signer (KEYPAIR=usb://ledger), not a keypair file."
      default_url="https://api.mainnet-beta.solana.com"
      expected_genesis="$MAINNET_GENESIS" ;;
    *) die "usage: $(basename "$0") <localnet|devnet|mainnet>" ;;
  esac
  RPC_URL="${RPC_URL:-$default_url}"
  DEPLOYMENT_FILE="$DEPLOYMENTS_DIR/$CLUSTER.json"

  [[ "$KEYPAIR" == usb://* || -f "$KEYPAIR" ]] || die "keypair not found: $KEYPAIR"

  SOLANA_CFG="$(mktemp)"
  chmod 600 "$SOLANA_CFG"
  trap 'rm -f "$SOLANA_CFG"' EXIT
  solana config set --config "$SOLANA_CFG" --url "$RPC_URL" --keypair "$KEYPAIR" >/dev/null

  local genesis
  genesis="$(sol genesis-hash 2>/dev/null)" || die "cannot reach RPC $(redact_url "$RPC_URL")"
  if [[ -n "$expected_genesis" && "$genesis" != "$expected_genesis" ]]; then
    die "RPC $(redact_url "$RPC_URL") is not $CLUSTER (genesis $genesis)"
  fi
  if [[ "$CLUSTER" == localnet && ( "$genesis" == "$DEVNET_GENESIS" || "$genesis" == "$MAINNET_GENESIS" ) ]]; then
    die "localnet RPC $(redact_url "$RPC_URL") points at a public cluster"
  fi
  info "Cluster: $CLUSTER ($(redact_url "$RPC_URL"))"
}

sol() { solana --config "$SOLANA_CFG" "$@"; }
spl() { spl-token --config "$SOLANA_CFG" "$@"; }

# json_get <json> <dotted.path>   e.g. json_get "$out" commandOutput.address
json_get() {
  python3 - "$1" "$2" <<'PY'
import json, sys
v = json.loads(sys.argv[1])
for k in sys.argv[2].split("."):
    v = v[int(k)] if isinstance(v, list) else v[k]
print("" if v is None else v)
PY
}

# deployment_get <dotted.path>  — read a value from the cluster's deployment record.
deployment_get() { json_get "$(cat "$DEPLOYMENT_FILE")" "$1"; }

# deployment_get_or_empty <dotted.path> — like deployment_get, but "" if the key is missing.
deployment_get_or_empty() { deployment_get "$1" 2>/dev/null || true; }

# --- Allocations (ALLOCATIONS="name:percent ...") ---

allocation_names() { local e; for e in $ALLOCATIONS; do echo "${e%%:*}"; done; }
allocation_percent() { local e; for e in $ALLOCATIONS; do [[ "${e%%:*}" == "$1" ]] && echo "${e##*:}"; done; }
# Whole tokens for an allocation.
allocation_amount() { echo $(( TOKEN_SUPPLY * $(allocation_percent "$1") / 100 )); }

allocations_check() {
  local e pct total=0
  for e in $ALLOCATIONS; do
    pct="${e##*:}"
    [[ "$pct" =~ ^[0-9]+$ ]] || die "bad allocation entry '$e' in config/token.env"
    (( TOKEN_SUPPLY * pct % 100 == 0 )) || die "allocation '$e' is not a whole number of tokens"
    total=$(( total + pct ))
  done
  (( total == 100 )) || die "ALLOCATIONS add up to $total%, not 100%"
}

# token_balance_base <owner> — JOB balance of <owner>'s associated token account in
# base units (0 if the account doesn't exist yet). Requires MINT.
# Any other error (RPC down, ...) is fatal, so a failed read can never look like "0"
# and trigger a second transfer.
token_balance_base() {
  local out
  if out="$(spl balance "$MINT" --owner "$1" --output json 2>&1)"; then
    json_get "$out" amount
  elif [[ "$out" == *"Could not find token account"* ]]; then
    echo 0
  else
    die "could not read JOB balance of $1: $out"
  fi
}

UNITS=$(( 10 ** TOKEN_DECIMALS ))

# deployment_set <dotted.path> <value> [<path> <value> ...] — update the record in place.
deployment_set() {
  mkdir -p "$DEPLOYMENTS_DIR"
  python3 - "$DEPLOYMENT_FILE" "$@" <<'PY'
import json, os, sys
path, kv = sys.argv[1], sys.argv[2:]
data = json.load(open(path)) if os.path.exists(path) else {}
for key, value in zip(kv[::2], kv[1::2]):
    node = data
    *parents, leaf = key.split(".")
    for p in parents:
        node = node.setdefault(p, {})
    node[leaf] = value
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}
