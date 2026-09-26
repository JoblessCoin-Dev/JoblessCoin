# Security

## Golden rules

1. **Never share a seed phrase or private key**: not with support, admins, bots, websites or AI assistants. No legitimate service ever asks for one.
2. **Never commit secrets.** Keypairs live in `~/.config/solana/` and `~/.config/joblesscoin/keys/` (outside the repo). The pre-commit hook blocks keypairs and API keys.
3. **Real money only behind a hardware wallet.** File keypairs (`id.json`) are unencrypted and fine for localnet/devnet only. Mainnet scripts refuse file keypairs.
4. **Verify before you sign.** Check every address character by character (clipboard-swapping malware exists), and check the network (devnet vs mainnet).

## Project security model

| Control | How it's enforced |
|---|---|
| Fixed supply | `finalize-mint.sh` disables the mint authority; `verify-token.sh --final` checks it |
| No freezing of holders | Mint created without a freeze authority; verification fails if one exists |
| No hidden token powers | Only `metadataPointer` and `tokenMetadata` extensions are allowed |
| Right network | Genesis-hash check on every script run |
| No accidental mainnet | Opt-in env var **and** a hardware wallet are required |
| No accidental duplicate mint | Existing deployment record blocks re-creation |
| Secrets out of git | `.gitignore` + `.githooks/pre-commit` (keypairs, base58/hex keys, seed phrases, RPC keys; attack-tested by `scripts/test-hook.sh`) + GitHub push protection |
| No redirected payouts | `distribute.sh` only sends to addresses confirmed by your local key (or `TRUSTED_WALLET_<NAME>`), never by the public deployment file alone |
| Metadata site hardening | `metadata/_headers`: nosniff, no framing, strict CSP, CORS only for the JSON and logo |

| Team can't dump | Dev allocation in irrevocable Streamflow vesting; verified on-chain |
| Supply-chain | npm deps pinned exactly with a lockfile; install scripts disabled (`.npmrc`) |

### Known dependency advisories

`npm audit` reports `bigint-buffer` (GHSA-3gc7-fjrx-p6mg) and `stream-json` (GHSA-528h-pc64-c93x)
deep inside `@solana/spl-token` / `@solana/web3.js`, which almost every Solana JS project shares.
npm's suggested "fixes" are downgrades to years-old versions, so they are not applied. The Node
code here is a local CLI helper talking to a trusted RPC, which keeps the exposure low. Re-check
when upstream releases a fix.

### Still to do before mainnet

- Move the remaining authorities (metadata update authority, treasury) to a **Squads multisig** signed by hardware wallets, or revoke them.
- Host metadata permanently on **Arweave/IPFS** instead of a Netlify subdomain. Whoever controls the Netlify account can currently change the logo and description.
- Lock the dev allocation in public **vesting**, and burn or lock the **LP tokens**.

## Personal security checklist

- [ ] 2FA with an authenticator app or passkey (not SMS) on: email, GitHub, Discord, X, Netlify, Helius
- [ ] Password manager with unique passwords everywhere
- [ ] Seed phrases backed up offline on paper or metal; never in photos, cloud notes, email or chat
- [ ] Ledger (or similar) hardware wallet before any mainnet step
- [ ] Rotate any API key that was ever pasted into a chat or screenshot
- [ ] Keep Windows, Avast and WSL updated (`sudo apt update && sudo apt upgrade`)
- [ ] Windows Device Encryption / BitLocker on
- [ ] Discord/Telegram: turn off DMs from server members; anyone DMing "support" is a scammer
- [ ] Never run scripts, "test projects" or installers that strangers send you
- [ ] Never "connect wallet" or sign on a site you reached through a DM, ad or reply

## If something goes wrong

- **Leaked keypair:** assume the wallet is compromised. Move funds to a fresh wallet immediately, and transfer or revoke any authorities it held.
- **Leaked API key:** regenerate it in the provider dashboard.
- **Secret pushed to GitHub:** rotate it first. Deleting the commit is not enough, because it stays in history and forks.
