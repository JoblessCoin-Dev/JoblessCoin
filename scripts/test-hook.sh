#!/usr/bin/env bash
# Attack-test the pre-commit hook: every leak format must be blocked, and every real
# file in this repo must still pass (no false alarms). Runs in a throwaway git repo.
#
# Usage: scripts/test-hook.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY=""
for p in python3 python; do "$p" -c 1 >/dev/null 2>&1 && { PY="$p"; break; }; done
[[ -n "$PY" ]] || { echo "python not found" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q
git config core.hooksPath "$REPO/.githooks"
git config core.autocrlf false
git config user.name test
git config user.email test@example.invalid

failures=0
attempt() {  # attempt <file> <content> <label> <expect: blocked|allowed>
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" >"$1"
  git add -f "$1"
  if git commit -qm test >/dev/null 2>&1; then result=allowed; git reset -q --soft HEAD~1 2>/dev/null || git update-ref -d HEAD; else result=blocked; fi
  git rm -q --cached "$1" >/dev/null
  rm -f "$1"
  if [[ "$result" == "$4" ]]; then echo "  ok      $3 ($result)"; else echo "  FAILED  $3 (expected $4, got $result)"; failures=$((failures + 1)); fi
}

rand() { "$PY" -c "$1"; }
ARRAY="$(rand 'import random,json; print(json.dumps([random.randint(0,255) for _ in range(64)]))')"
PRETTY="$(rand "import json; print(json.dumps($ARRAY, indent=2))")"
B58KEY="$(rand "import random; A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; print(''.join(random.choice(A) for _ in range(88)))")"
HEXKEY="$(rand 'import os; print(os.urandom(64).hex())')"
UUID="12345678-abcd-4ef0-9abc-123456789abc"
WORDS="abandon ability able about above absent absorb abstract absurd abuse access accident"

echo "Leak formats (must be blocked):"
attempt wallet.json "$ARRAY" "Solana CLI keypair array" blocked
attempt wallet.json "$PRETTY" "keypair array, pretty-printed" blocked
attempt logo.png "$ARRAY" "keypair saved as .png" blocked
attempt notes.txt "PRIVATE_KEY=$B58KEY" "base58 private key (Phantom export)" blocked
attempt notes.txt "$B58KEY" "bare base58 private key" blocked
attempt notes.txt "$HEXKEY" "hex 64-byte secret" blocked
attempt notes.txt "$WORDS" "12-word seed phrase" blocked
attempt notes.txt "$WORDS $WORDS" "24-word seed phrase" blocked
attempt notes.txt "https://mainnet.helius-rpc.com/?api-""key=$UUID" "Helius API key" blocked
# Fake keys are assembled at runtime so this file itself passes the hook.
attempt notes.txt "https://solana-mainnet.g.alchemy.com/v2/""AbCdEfGhIjKlMnOpQrStUvWxYz123456" "Alchemy API key" blocked
attempt notes.txt "https://example.solana-mainnet.quiknode.pro/""0123456789abcdef0123456789abcdef/" "QuickNode key" blocked
attempt config.js "const secret""Key = \"$B58KEY\"" "secret in source code" blocked
attempt deploy/id.json "{}" "file named id.json" blocked
attempt .env "X=1" "file named .env" blocked

echo "Normal content (must be allowed):"
attempt notes.txt "Never share a seed phrase or private key with anyone." "security advice prose" allowed
attempt record.json "{\"signature\": \"$B58KEY\"}" "transaction signature in a deployment record" allowed
attempt notes.txt "Mint: EfFBNJSuLDJLt2bU6QuxUriq5nhHgoBMYksRhWxH4tRi" "public address" allowed

echo "Every file in this repo (must be allowed):"
while IFS= read -r -d '' f; do
  mkdir -p "$(dirname "$f")"
  cp "$REPO/$f" "$f"
  git add -f "$f"
done < <(git -C "$REPO" ls-files -z --cached --others --exclude-standard)
if git commit -qm repo >/dev/null 2>"$WORK/err"; then echo "  ok      all repo files pass"; else echo "  FAILED  repo files flagged:"; cat "$WORK/err"; failures=$((failures + 1)); fi

echo
if (( failures == 0 )); then echo "HOOK TESTS PASSED"; else echo "$failures HOOK TEST(S) FAILED"; exit 1; fi
