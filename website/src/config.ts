// Every address comes from the deployment record the scripts write, so the website and the
// tooling can never disagree about which token is the real one.
import devnet from "../../deployments/devnet.json";

export const CLUSTER = "devnet";
export const RPC_URL = "https://api.devnet.solana.com";
export const REPO_URL = "https://github.com/JoblessCoin-Dev/JoblessCoin";

export const PROGRAMS = {
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  raydiumCpmm: "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb",
  burnAndEarn: "DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX",
  streamflow: "HqDGZjaVRXJ9MGRQEw7qDc2rAr6iH1n1kAQdCZaCMfMZ",
} as const;

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const TOKEN = {
  mint: devnet.mint,
  name: devnet.metadata.name,
  symbol: devnet.metadata.symbol,
  uri: devnet.metadata.uri,
  decimals: Number(devnet.decimals),
  supply: Number(devnet.supply),
  createdAt: devnet.createdAt,
  createSignature: devnet.signatures.createMint,
};

const { liquidity, community, development } = devnet.allocations;

export const POOL = {
  id: liquidity.pool.poolId,
  lpMint: liquidity.pool.lpMint,
  vaultA: liquidity.pool.vaultA,
  vaultB: liquidity.pool.vaultB,
  lockPda: liquidity.pool.lock.lockPda,
  feeKeyNft: liquidity.pool.lock.nftMint,
};

export const ALLOCATIONS = [
  {
    key: "liquidity",
    label: "Liquidity",
    percent: Number(liquidity.percent),
    amount: Number(liquidity.amount),
    wallet: liquidity.wallet,
    devnet: "In a Raydium pool. 100% of the LP is locked forever.",
    mainnet: "Goes into the trading pool. LP gets locked forever on day one.",
  },
  {
    key: "community",
    label: "Community",
    percent: Number(community.percent),
    amount: Number(community.amount),
    wallet: community.wallet,
    devnet: "Sitting in the community wallet.",
    mainnet: "Kept for the community: memes, contests, the people.",
  },
  {
    key: "development",
    label: "Development",
    percent: Number(development.percent),
    amount: Number(development.amount),
    wallet: development.wallet,
    devnet: "Locked in vesting nobody can cancel.",
    mainnet: "Locked in vesting nobody can cancel, 12 months, 3 month cliff.",
  },
] as const;

// The community wallet's JOB token account (its associated token account for this mint).
export const COMMUNITY_TOKEN_ACCOUNT = "4ijPYfk1HKa7v2f5p5uKb3C2X52bY18EitrDBwHNpnkW";

export const VESTING = {
  streamId: development.vesting.streamId,
  sender: development.wallet,
  start: Number(development.vesting.start),
  end: Number(development.vesting.end),
};

export const explorer = (address: string, kind: "address" | "tx" = "address") =>
  `https://explorer.solana.com/${kind}/${address}?cluster=${CLUSTER}`;

export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
