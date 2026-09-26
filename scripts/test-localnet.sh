#!/usr/bin/env bash
# End-to-end test of the token scripts on a throwaway local validator:
#   create -> verify -> (safety checks) -> finalize -> verify --final
#
# Uses its own ledger, ports, payer keypair and deployment records in a temp dir.
# It never touches your wallet, your ~/.config/solana config or deployments/.
#
# Usage: scripts/test-localnet.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
[[ -d "$SOLANA_BIN" ]] && PATH="$SOLANA_BIN:$PATH"

PORT="${TEST_RPC_PORT:-8999}"
WORK="$(mktemp -d /tmp/joblesscoin-test.XXXXXX)"
VALIDATOR_PID=""

cleanup() {
  [[ -n "$VALIDATOR_PID" ]] && kill "$VALIDATOR_PID" 2>/dev/null && wait "$VALIDATOR_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { echo "TEST PASS: $*"; }
fail() { echo "TEST FAIL: $*" >&2; exit 1; }

for d in "$HOME"/.nvm/versions/node/*/bin; do [[ -x "$d/node" ]] && PATH="$d:$PATH"; done

# Streamflow's devnet program and the accounts it reads, cloned so vesting runs locally.
STREAMFLOW_CLONES=(
  --url https://api.devnet.solana.com
  --clone-upgradeable-program HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ   # Streamflow
  --clone-upgradeable-program pardoTarcc6HKsPcbXkVycxsJsoN9QEzrdHgVdHAGY3   # partner oracle
  --clone Aa2JJfFzUN3V54DXUHRBJowFw416xfZHpPk9DaNy3iYs                      # fee oracle
  --clone 5SEpbdjFK5FxwTvfsGMXVQTD2v4M2c5tyRTxhdsPkgDw                      # treasury
  --clone wdrwhnCv4pzW8beKsbPa4S2UDZrXenjg16KJdKSpb5u                       # withdrawor
)

echo "==> Starting throwaway validator on port $PORT (ledger in $WORK)"
solana-test-validator --ledger "$WORK/ledger" --rpc-port "$PORT" \
  --faucet-port "${TEST_FAUCET_PORT:-9911}" --gossip-port "${TEST_GOSSIP_PORT:-10024}" \
  "${STREAMFLOW_CLONES[@]}" --reset --quiet >"$WORK/validator.log" 2>&1 &
VALIDATOR_PID=$!

export RPC_URL="http://127.0.0.1:$PORT"
for _ in $(seq 120); do
  solana genesis-hash --url "$RPC_URL" >/dev/null 2>&1 && break
  kill -0 "$VALIDATOR_PID" 2>/dev/null || fail "validator exited; see log: $(tail -5 "$WORK/validator.log")"
  sleep 1
done
solana genesis-hash --url "$RPC_URL" >/dev/null 2>&1 || fail "validator did not start in 120s"

export KEYPAIR="$WORK/payer.json" KEYS_DIR="$WORK/keys" DEPLOYMENTS_DIR="$WORK/deployments"
solana-keygen new --no-bip39-passphrase --silent -o "$KEYPAIR" >/dev/null
solana airdrop 10 "$(solana-keygen pubkey "$KEYPAIR")" --url "$RPC_URL" >/dev/null

echo; echo "==> create-token.sh"
"$HERE/create-token.sh" localnet || fail "create-token.sh"
pass "token created and verified"

MINT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mint"])' "$DEPLOYMENTS_DIR/localnet.json")"

echo; echo "==> safety: a second create must be refused"
if "$HERE/create-token.sh" localnet >/dev/null 2>&1; then fail "second create was allowed"; fi
pass "duplicate mint refused"

echo; echo "==> safety: verify --final must fail while mint authority is live"
if "$HERE/verify-token.sh" localnet --final >/dev/null 2>&1; then fail "--final passed too early"; fi
pass "--final correctly fails before finalize"

echo; echo "==> safety: wrong confirmation must not finalize"
if CONFIRM_MINT="wrong" "$HERE/finalize-mint.sh" localnet >/dev/null 2>&1; then fail "finalized with wrong confirmation"; fi
pass "wrong confirmation rejected"

record() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): d=d[k]
print(d)' "$DEPLOYMENTS_DIR/localnet.json" "$1"; }

echo; echo "==> create-wallets.sh"
"$HERE/create-wallets.sh" localnet || fail "create-wallets.sh"
LIQ="$(record allocations.liquidity.wallet)"
"$HERE/create-wallets.sh" localnet >/dev/null || fail "create-wallets.sh re-run"
[[ "$(record allocations.liquidity.wallet)" == "$LIQ" ]] || fail "re-run changed the wallets"
pass "wallets created; re-run reuses the same wallets"

echo; echo "==> safety: wrong confirmation must not distribute"
if CONFIRM_DISTRIBUTION="no" "$HERE/distribute.sh" localnet >/dev/null 2>&1; then fail "distributed without confirmation"; fi
if spl-token balance "$MINT" --owner "$LIQ" --url "$RPC_URL" >/dev/null 2>&1; then fail "tokens moved without confirmation"; fi
pass "nothing sent without confirmation"

echo; echo "==> safety: a tampered wallet address in the deployment record must be refused"
cp "$DEPLOYMENTS_DIR/localnet.json" "$WORK/record.bak"
ATTACKER="$(solana-keygen new --no-bip39-passphrase --silent -o "$WORK/attacker.json" >/dev/null && solana-keygen pubkey "$WORK/attacker.json")"
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["allocations"]["liquidity"]["wallet"]=sys.argv[2]; json.dump(d,open(p,"w"),indent=2)' \
  "$DEPLOYMENTS_DIR/localnet.json" "$ATTACKER"
if CONFIRM_DISTRIBUTION=distribute "$HERE/distribute.sh" localnet >/dev/null 2>&1; then fail "sent to a tampered address"; fi
if spl-token balance "$MINT" --owner "$ATTACKER" --url "$RPC_URL" >/dev/null 2>&1; then fail "attacker received tokens"; fi
cp "$WORK/record.bak" "$DEPLOYMENTS_DIR/localnet.json"
pass "tampered address refused, nothing sent"

echo; echo "==> distribute.sh"
CONFIRM_DISTRIBUTION=distribute "$HERE/distribute.sh" localnet || fail "distribute.sh"
[[ "$(spl-token balance "$MINT" --owner "$LIQ" --url "$RPC_URL")" == "900000000" ]] || fail "liquidity balance"
[[ "$(spl-token balance "$MINT" --url "$RPC_URL" --owner "$(solana-keygen pubkey "$KEYPAIR")")" == "0" ]] || fail "holder not empty"
pass "900M / 50M / 50M distributed and verified; holder empty"

echo; echo "==> safety: re-running distribute must not send again"
CONFIRM_DISTRIBUTION=distribute "$HERE/distribute.sh" localnet >/dev/null || fail "distribute re-run failed"
[[ "$(spl-token balance "$MINT" --owner "$LIQ" --url "$RPC_URL")" == "900000000" ]] || fail "re-run changed balances"
pass "re-run sent nothing"

DEV="$(record allocations.development.wallet)"
echo; echo "==> safety: locking without SOL for fees must fail cleanly"
if CONFIRM_LOCK=lock "$HERE/lock-development.sh" localnet >/dev/null 2>&1; then fail "locked without fee SOL"; fi
pass "unfunded lock refused"

solana transfer "$DEV" 0.3 --url "$RPC_URL" --keypair "$KEYPAIR" --allow-unfunded-recipient >/dev/null

echo; echo "==> safety: wrong confirmation must not lock"
if CONFIRM_LOCK="no" "$HERE/lock-development.sh" localnet >/dev/null 2>&1; then fail "locked without confirmation"; fi
[[ "$(spl-token balance "$MINT" --owner "$DEV" --url "$RPC_URL")" == "50000000" ]] || fail "tokens moved without confirmation"
pass "nothing locked without confirmation"

echo; echo "==> lock-development.sh"
CONFIRM_LOCK=lock "$HERE/lock-development.sh" localnet || fail "lock-development.sh"
[[ "$(spl-token balance "$MINT" --owner "$DEV" --url "$RPC_URL")" == "0" ]] || fail "development tokens not locked"
pass "development allocation locked in irrevocable vesting and verified"

echo; echo "==> safety: a second lock must be refused"
if CONFIRM_LOCK=lock "$HERE/lock-development.sh" localnet >/dev/null 2>&1; then fail "second lock allowed"; fi
pass "double lock refused"

echo; echo "==> finalize-mint.sh"
CONFIRM_MINT="$MINT" "$HERE/finalize-mint.sh" localnet || fail "finalize-mint.sh"
pass "mint authority disabled and final verification passed"

echo; echo "==> safety: localnet scripts must refuse a devnet RPC"
if RPC_URL="https://api.devnet.solana.com" "$HERE/verify-token.sh" localnet >/dev/null 2>&1; then
  fail "localnet accepted a public cluster RPC"
fi
pass "cluster/RPC mismatch refused"

echo; echo "==> safety: mainnet must stay locked without explicit opt-in"
if env -u JOB_ALLOW_MAINNET "$HERE/verify-token.sh" mainnet >/dev/null 2>&1; then fail "mainnet was not locked"; fi
pass "mainnet locked"

echo; echo "ALL TESTS PASSED"
