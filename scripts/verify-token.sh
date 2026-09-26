#!/usr/bin/env bash
# Verify the deployed JoblessCoin mint against config/token.env, on-chain and off-chain.
#
# Usage: scripts/verify-token.sh <localnet|devnet|mainnet> [--final]
#   --final  additionally require the mint authority to be disabled.
#
# Exits non-zero if any check fails.
source "$(dirname "$0")/lib.sh"
require_tools
setup_cluster "${1:-}"
FINAL=0
[[ "${2:-}" == "--final" ]] && FINAL=1

[[ -f "$DEPLOYMENT_FILE" ]] || die "no deployment record at $DEPLOYMENT_FILE"
MINT="$(deployment_get mint)"
info "Verifying mint $MINT"

set +e
python3 - "$MINT" "$TOKEN_2022_PROGRAM_ID" "$FINAL" "$(spl display "$MINT" --output json)" <<'PY'
import json, os, sys, urllib.request

mint, program_id, final = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
d = json.loads(sys.argv[4])
env = os.environ
decimals = int(env["TOKEN_DECIMALS"])
failures = 0

def check(ok, label, detail=""):
    global failures
    failures += not ok
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))

def note(label):
    print(f"  [INFO] {label}")

ext = {e["extension"]: e.get("state", {}) for e in d.get("extensions", [])}
meta = ext.get("tokenMetadata", {})
allowed = set(env["ALLOWED_EXTENSIONS"].split())

check(d["programId"] == program_id, "Token-2022 program", d["programId"])
check(d["decimals"] == decimals, f"decimals = {decimals}", str(d["decimals"]))
expected_supply = int(env["TOKEN_SUPPLY"]) * 10**decimals
check(int(d["supply"]) == expected_supply, f"supply = {int(env['TOKEN_SUPPLY']):,} {env['TOKEN_SYMBOL']}",
      f"{int(d['supply']) / 10**decimals:,.0f}")
check(d["freezeAuthority"] is None, "no freeze authority (holders can't be frozen)", str(d["freezeAuthority"]))
unexpected = sorted(set(ext) - allowed)
check(not unexpected, "no risky extensions", ", ".join(unexpected) or ", ".join(sorted(ext)))
check(ext.get("metadataPointer", {}).get("metadataAddress") == mint, "metadata pointer -> mint itself")
check(meta.get("name") == env["TOKEN_NAME"], f"name = {env['TOKEN_NAME']}", str(meta.get("name")))
check(meta.get("symbol") == env["TOKEN_SYMBOL"], f"symbol = {env['TOKEN_SYMBOL']}", str(meta.get("symbol")))
check(meta.get("uri") == env["TOKEN_URI"], "metadata URI matches config", str(meta.get("uri")))

if final:
    check(d["mintAuthority"] is None, "mint authority disabled (supply fixed forever)", str(d["mintAuthority"]))
elif d["mintAuthority"] is None:
    note("mint authority: disabled (supply fixed forever)")
else:
    note(f"mint authority still enabled: {d['mintAuthority']} (run finalize-mint.sh after distribution)")
note(f"metadata update authority: {meta.get('updateAuthority')}")

try:
    with urllib.request.urlopen(env["TOKEN_URI"], timeout=15) as r:
        off = json.load(r)
    check(off.get("name") == env["TOKEN_NAME"] and off.get("symbol") == env["TOKEN_SYMBOL"],
          "off-chain JSON name/symbol match")
    with urllib.request.urlopen(off["image"], timeout=15) as r:
        check(r.status == 200, "logo image reachable", off["image"])
except Exception as e:
    check(False, "off-chain metadata reachable", str(e))

sys.exit(min(failures, 100))
PY
failures=$?
set -e

# verify_vesting <name> <wallet> <streamId> — the allocation must sit in an irrevocable
# Streamflow contract holding the full amount on the recorded schedule.
verify_vesting() {
  local name="$1" wallet="$2" stream="$3" info err
  err="$(mktemp)"
  if ! info="$(JC_RPC_URL="$RPC_URL" JC_STREAM_ID="$stream" node "$REPO_ROOT/scripts/vesting.mjs" info 2>"$err")"; then
    echo "  [FAIL] $name vesting contract $stream unreadable: $(cat "$err")"
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  python3 - "$info" "$name" "$wallet" "$MINT" "$(( $(allocation_amount "$name") * UNITS ))" \
    "$(deployment_get "allocations.$name.vesting.start")" "$(deployment_get "allocations.$name.vesting.end")" \
    "$stream" <<'PY'
import datetime, json, os, sys
s = json.loads(sys.argv[1])
name, wallet, mint, amount, start, end, stream = sys.argv[2:]
problems = []
if s["sender"] != wallet: problems.append(f"sender is {s['sender']}")
if s["mint"] != mint: problems.append(f"mint is {s['mint']}")
if int(s["depositedAmount"]) != int(amount): problems.append(f"deposited {s['depositedAmount']} base units")
if s["cancelableBySender"] or s["cancelableByRecipient"]: problems.append("contract is cancelable")
if s["canTopup"] or s["transferableBySender"]: problems.append("sender can modify the contract")
if s["canceledAt"]: problems.append("contract was canceled")
if s["start"] != int(start): problems.append(f"start is {s['start']}, recorded {start}")
if problems:
    print(f"  [FAIL] {name} vesting {stream}: " + "; ".join(problems))
    sys.exit(1)
day = lambda t: datetime.datetime.fromtimestamp(int(t), datetime.UTC).strftime("%Y-%m-%d")
whole = int(amount) // 10 ** int(os.environ["TOKEN_DECIMALS"])
print(f"  [PASS] {name}: {whole} JOB locked, irrevocable, unlocks {day(start)} -> {day(end)} (stream {stream})")
PY
}

# Allocations: every distributed allocation must hold exactly its share (or be locked in vesting).
if [[ -n "$(deployment_get_or_empty allocations)" ]]; then
  for name in $(allocation_names); do
    wallet="$(deployment_get_or_empty "allocations.$name.wallet")"
    if [[ -z "$wallet" ]]; then
      echo "  [INFO] $name: no wallet yet"
    elif [[ -z "$(deployment_get_or_empty "allocations.$name.signature")" ]]; then
      echo "  [INFO] $name: wallet $wallet, not distributed yet"
    elif stream="$(deployment_get_or_empty "allocations.$name.vesting.streamId")"; [[ -n "$stream" ]]; then
      verify_vesting "$name" "$wallet" "$stream" || failures=$(( failures + 1 ))
    else
      target="$(allocation_amount "$name")"
      balance_base="$(token_balance_base "$wallet")"
      if (( balance_base == target * UNITS )); then
        echo "  [PASS] $name holds $target JOB ($(allocation_percent "$name")%) — $wallet"
      else
        echo "  [FAIL] $name holds $(( balance_base / UNITS )) JOB, expected $target — $wallet"
        failures=$(( failures + 1 ))
      fi
    fi
  done
fi

echo
if (( failures == 0 )); then echo "RESULT: ALL CHECKS PASSED"; else echo "RESULT: $failures CHECK(S) FAILED"; fi
(( failures == 0 ))
