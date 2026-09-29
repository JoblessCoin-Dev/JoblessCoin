# JoblessCoin ($JOB)

> No job. No boss. No problem.

JoblessCoin is a memecoin on Solana, built as a **Token-2022** token with on-chain metadata.
It is a memecoin: it has no promised utility and no promised returns.

## Token facts

| | |
|---|---|
| Name / symbol | JoblessCoin / JOB |
| Standard | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| Decimals | 9 |
| Total supply | 1,000,000,000 JOB, fixed (mint authority disabled after distribution) |
| Freeze authority | None: no one can freeze holders' tokens |
| Extensions | Metadata pointer + token metadata **only** (no transfer fees, hooks or permanent delegate) |
| Planned allocation | 90% liquidity · 5% community · 5% development |
| Metadata | [joblesscoin.json](https://deluxe-mochi-c9b389.netlify.app/joblesscoin.json) |

## Deployments

| Network | Mint | Status |
|---|---|---|
| Localnet | created per test run | ✅ scripts tested end to end |
| Devnet | [`EfFBNJSuLDJLt2bU6QuxUriq5nhHgoBMYksRhWxH4tRi`](https://explorer.solana.com/address/EfFBNJSuLDJLt2bU6QuxUriq5nhHgoBMYksRhWxH4tRi?cluster=devnet) | ✅ full rehearsal complete: 90/5/5 distributed, JOB/SOL [Raydium pool](https://explorer.solana.com/address/3VHUXJ2kXmK5imVb1DsdAUEFiFqkJaJ5ZEHvSiinTpTD?cluster=devnet) (900M JOB + 8 SOL) with LP locked forever, dev 5% in irrevocable vesting, mint authority disabled |
| Mainnet | — | 🔒 locked (see below) |

Every deployment is recorded with its addresses and transaction signatures in
`deployments/<network>.json`, so anyone can verify it on-chain.

## Repository layout

```
config/token.env        token parameters (single source of truth)
metadata/               off-chain metadata JSON + logo (deployed to Netlify)
scripts/create-token.sh create mint + metadata + mint the full supply
scripts/verify-token.sh check the on-chain token against config (PASS/FAIL)
scripts/create-wallets.sh create the liquidity / community / development wallets
scripts/distribute.sh   send the 90 / 5 / 5 allocations (safe to re-run, never double-sends)
scripts/lock-development.sh lock the 5% dev allocation in irrevocable Streamflow vesting
scripts/vesting.mjs     Streamflow helper used by the scripts above (Node.js)
scripts/create-pool.sh  create the JOB/SOL Raydium pool with the 90% liquidity allocation
scripts/lock-liquidity.sh lock all LP tokens forever with Raydium Burn & Earn (fees stay claimable)
scripts/pool.mjs        Raydium helper used by the pool scripts (Node.js)
scripts/collect-fees.sh show / collect the trading fees earned by the locked liquidity
scripts/test-swap.sh    test trades on localnet/devnet only (never mainnet)
scripts/finalize-mint.sh permanently disable the mint authority
scripts/test-localnet.sh end-to-end test on a throwaway local validator
scripts/test-hook.sh    attack-tests the pre-commit secret scanner
deployments/            public deployment records per network
website/                the JoblessCoin website (THE BREAKOUT), deployed to GitHub Pages
.githooks/pre-commit    blocks commits containing private keys / API keys
```

## Usage (WSL Ubuntu)

```bash
cd "/mnt/d/JoblessCoin Project"

# Run the full test suite (throwaway validator, never touches your wallet)
scripts/test-localnet.sh

# Devnet (needs ~0.05 SOL in your CLI wallet)
scripts/create-token.sh devnet
scripts/verify-token.sh devnet
scripts/create-wallets.sh devnet       # allocation wallets (keys stored outside the repo)
scripts/distribute.sh devnet           # asks you to type 'distribute'
npm ci                                 # once: installs the pinned vesting dependencies
scripts/lock-development.sh devnet     # 90-day cliff, fully vested at 365 days; asks you to type 'lock'
scripts/create-pool.sh devnet          # JOB/SOL pool, POOL_SEED_SOL in config; asks you to type 'pool'
scripts/lock-liquidity.sh devnet       # permanent LP lock; asks you to type 'burn'
scripts/test-swap.sh devnet buy 1      # test trade: spend 1 SOL on JOB (or: sell <JOB amount>)
scripts/collect-fees.sh devnet         # show claimable fees; add --collect to claim them
scripts/finalize-mint.sh devnet        # irreversible, asks you to type the mint address
```

Options (environment variables):

- `RPC_URL`: use a different RPC, e.g. a Helius Devnet URL. API keys are never printed or saved.
- `KEYPAIR`: signer keypair (default `~/.config/solana/id.json`, or `usb://ledger`).
- `KEYS_DIR`: where mint keypairs are stored (default `~/.config/joblesscoin/keys`, outside the repo).

The scripts never change your global Solana CLI config. They also check the RPC's genesis
hash, so a Devnet command can't accidentally run against Mainnet, or the reverse.

## Website

`website/` is a static site (Vite + TypeScript + Three.js + GSAP). Every claim on it is read live
from the chain in the visitor's browser, using the addresses in `deployments/devnet.json`.

```bash
cd website
npm ci
npm run dev      # local development
npm run build    # type check + "no dashes" copy check + production build into dist/
```

Pushing to `main` deploys it through `.github/workflows/pages.yml`
(one-time setup: repo Settings > Pages > Source: GitHub Actions).
The site never asks for a wallet connection, keys or signatures, has no trackers or cookies,
and ships a strict Content Security Policy.

## Safety design

- **Fixed supply:** the mint authority is disabled after distribution, and `verify-token.sh --final` proves it.
- **No freeze authority and no risky extensions:** verification fails if any appear.
- **No duplicate mints:** `create-token.sh` refuses to create a second mint on a network that already has one.
- **Irreversible steps need typed confirmation.**
- **Liquidity can't be pulled:** the pool's LP tokens are locked forever with Raydium Burn & Earn; `verify-token.sh` checks the pool and that the LP left the wallet.
- **Team tokens are locked:** the 5% development allocation vests over 12 months (3-month cliff) in a Streamflow contract nobody can cancel. `verify-token.sh` reads the contract on-chain and checks it.
- **Mainnet is locked:** it needs `JOB_ALLOW_MAINNET=I_UNDERSTAND_REAL_MONEY` **and** a hardware wallet (`KEYPAIR=usb://ledger`).
- **Secrets stay out of git:** `.gitignore` plus a pre-commit hook that scans for keypairs and API keys.

See [SECURITY.md](SECURITY.md) for the full security policy and personal checklist.

## Roadmap

1. ✅ Local Token-2022 mint, metadata, logo
2. ✅ Reproducible scripts + automated tests
3. ✅ Devnet: create, verify, 90/5/5 allocations, dev vesting, pool + permanent LP lock, finalize
4. ⬜ Devnet rehearsal: Squads multisig treasury
5. ⏳ Website (built: THE BREAKOUT, live onchain proof) · ⬜ own domain · ⬜ permanent metadata (Arweave, right before Mainnet)
6. ⬜ Pre-Mainnet: Ledger hardware wallet, legal/tax advice, final review
7. ⬜ Mainnet, only as an explicit decision, using the same tested scripts

## Community principles

No fake volume, no wash trading, no paid shills posing as fans, no bots, no hidden insider
wallets and no promises of profit. Every team allocation is disclosed and verifiable on-chain.

## Disclaimer

JOB is a memecoin with no intrinsic value or expected return. Nothing here is financial advice.
