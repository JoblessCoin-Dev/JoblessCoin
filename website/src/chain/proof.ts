// Every claim the website makes about JOB, checked live against the Solana blockchain.
// Nothing here is hardcoded as "true": if the chain says otherwise, the check fails.
import { ALLOCATIONS, COMMUNITY_TOKEN_ACCOUNT, POOL, PROGRAMS, TOKEN, VESTING, WSOL_MINT, explorer } from "../config";
import { type AccountInfo, Reader, fromBase64, rpc } from "./rpc";

export type Status = "pass" | "info" | "fail";

export interface Check {
  label: string;
  value: string;
  status: Status;
  link: string;
}

export interface ProofResult {
  checks: Check[];
  checkedAt: number;
  pool?: { job: number; sol: number };
  vesting?: { start: number; end: number; deposited: number };
}

interface ParsedMint {
  parsed: {
    type: string;
    info: {
      decimals: number;
      supply: string;
      mintAuthority: string | null;
      freezeAuthority: string | null;
      extensions?: { extension: string; state: Record<string, unknown> }[];
    };
  };
}
interface ParsedTokenAccount {
  parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } };
}
type B64 = [string, "base64"];

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const units = (raw: string | bigint, decimals: number) => Number(BigInt(raw)) / 10 ** decimals;
const ALLOWED_EXTENSIONS = new Set(["metadataPointer", "tokenMetadata"]);

export async function runProof(): Promise<ProofResult> {
  const community = ALLOCATIONS.find((a) => a.key === "community")!;
  // One request for everything: the free public RPC rate-limits batches per call.
  // jsonParsed decodes token accounts; accounts of other programs come back as base64.
  type Any = AccountInfo<ParsedMint & ParsedTokenAccount & B64> | null;
  const { value: accounts } = await rpc<{ value: Any[] }>("getMultipleAccounts", [
    [TOKEN.mint, POOL.id, POOL.vaultA, POOL.vaultB, POOL.lockPda, POOL.lpMint, VESTING.streamId, COMMUNITY_TOKEN_ACCOUNT],
    { encoding: "jsonParsed" },
  ]);
  const [mintAcc, poolAcc, vaultAAcc, vaultBAcc, lockAcc, lpMintAcc, streamAcc, communityAcc] = accounts;
  const mint = { value: mintAcc as AccountInfo<ParsedMint> | null };
  const pool = { value: poolAcc };
  const vaultA = { value: vaultAAcc as AccountInfo<ParsedTokenAccount> | null };
  const vaultB = { value: vaultBAcc as AccountInfo<ParsedTokenAccount> | null };
  const lock = { value: lockAcc as AccountInfo<B64> | null };
  const lpSupply = { value: { amount: (lpMintAcc as AccountInfo<ParsedMint> | null)?.data.parsed.info.supply ?? "0" } };
  const stream = { value: streamAcc as AccountInfo<B64> | null };
  const communityAccounts = { value: communityAcc ? [{ account: communityAcc as AccountInfo<ParsedTokenAccount> }] : [] };

  const checks: Check[] = [];
  const add = (label: string, status: Status, value: string, link: string) => checks.push({ label, value, status, link });
  const mintLink = explorer(TOKEN.mint);
  const info = mint.value?.data.parsed.info;

  if (!mint.value || !info) {
    add("token", "fail", "not found on Devnet", mintLink);
    return { checks, checkedAt: Date.now() };
  }

  add("token program", mint.value.owner === PROGRAMS.token2022 ? "pass" : "fail",
    mint.value.owner === PROGRAMS.token2022 ? "Token-2022" : `unexpected program ${mint.value.owner}`, mintLink);

  const supply = units(info.supply, info.decimals);
  add("total supply", supply === TOKEN.supply && info.decimals === TOKEN.decimals ? "pass" : "fail",
    `${fmt(supply)} JOB`, mintLink);

  add("mint authority", info.mintAuthority === null ? "pass" : "fail",
    info.mintAuthority === null ? "none. nobody can ever print more JOB" : "still active", mintLink);

  add("freeze authority", info.freezeAuthority === null ? "pass" : "fail",
    info.freezeAuthority === null ? "none. nobody can freeze your JOB" : "active", mintLink);

  const extensions = (info.extensions ?? []).map((e) => e.extension);
  const extras = extensions.filter((e) => !ALLOWED_EXTENSIONS.has(e));
  add("hidden powers", extras.length === 0 ? "pass" : "fail",
    extras.length === 0 ? "none. no fees, no hooks, no backdoors" : `found: ${extras.join(", ")}`, mintLink);

  const meta = info.extensions?.find((e) => e.extension === "tokenMetadata")?.state as
    | { name?: string; symbol?: string; uri?: string; updateAuthority?: string | null }
    | undefined;
  const offchain = await fetch(meta?.uri ?? TOKEN.uri)
    .then((r) => (r.ok ? (r.json() as Promise<{ name?: string; symbol?: string }>) : null))
    .catch(() => null);
  const metaOk = meta?.name === TOKEN.name && meta?.symbol === TOKEN.symbol &&
    offchain?.name === TOKEN.name && offchain?.symbol === TOKEN.symbol;
  add("name and logo", metaOk ? "pass" : "fail",
    metaOk ? `${TOKEN.name} (${TOKEN.symbol}), logo online` : "metadata does not match", mintLink);

  // Liquidity pool: owned by Raydium CPMM, vault balances read live.
  let poolAmounts: ProofResult["pool"];
  const vaults = [vaultA.value?.data.parsed.info, vaultB.value?.data.parsed.info];
  const jobVault = vaults.find((v) => v?.mint === TOKEN.mint);
  const solVault = vaults.find((v) => v?.mint === WSOL_MINT);
  if (pool.value?.owner === PROGRAMS.raydiumCpmm && jobVault && solVault) {
    poolAmounts = {
      job: units(jobVault.tokenAmount.amount, jobVault.tokenAmount.decimals),
      sol: units(solVault.tokenAmount.amount, solVault.tokenAmount.decimals),
    };
    add("liquidity pool", poolAmounts.job > 0 && poolAmounts.sol > 0 ? "pass" : "fail",
      `live on Raydium: ${fmt(poolAmounts.job)} JOB + ${fmt(poolAmounts.sol, 2)} SOL (test pool)`, explorer(POOL.id));
  } else {
    add("liquidity pool", "fail", "pool not found", explorer(POOL.id));
  }

  // Burn & Earn lock: account layout = discriminator(8) lockedLp(8) ... poolId@64 ... lpMint@160
  if (lock.value && lock.value.owner === PROGRAMS.burnAndEarn) {
    const r = new Reader(fromBase64(lock.value.data[0]));
    const locked = r.u64(8);
    const total = BigInt(lpSupply.value.amount);
    const pct = total > 0n ? Number((locked * 1_000_000n) / total) / 10_000 : 0;
    const matches = r.key(64) === POOL.id && r.key(160) === POOL.lpMint;
    add("liquidity lock", matches && pct >= 99.9 ? "pass" : "fail",
      `${pct >= 99.99 ? "99.99" : fmt(pct, 2)}% of LP locked forever`, explorer(POOL.lockPda));
  } else {
    add("liquidity lock", "fail", "lock not found", explorer(POOL.lockPda));
  }

  // Streamflow vesting contract (layout from the Streamflow SDK).
  let vesting: ProofResult["vesting"];
  if (stream.value && stream.value.owner === PROGRAMS.streamflow) {
    const r = new Reader(fromBase64(stream.value.data[0]));
    const deposited = units(r.u64(417), TOKEN.decimals);
    const cancelable = r.u8(457) !== 0 || r.u8(458) !== 0;
    const senderCanChange = r.u8(460) !== 0 || r.u8(462) !== 0;
    const canceled = r.i64(25) !== 0;
    vesting = { start: r.i64(409), end: r.i64(33), deposited };
    const ok = r.key(177) === TOKEN.mint && r.key(49) === VESTING.sender && !cancelable && !senderCanChange && !canceled;
    add("team tokens", ok ? "pass" : "fail",
      ok ? `${fmt(deposited / 1e6)}M JOB in vesting nobody can cancel` : "vesting terms changed", explorer(VESTING.streamId));
  } else {
    add("team tokens", "fail", "vesting contract not found", explorer(VESTING.streamId));
  }

  const communityRaw = communityAccounts.value.reduce(
    (sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  const communityJob = units(communityRaw, TOKEN.decimals);
  add("community wallet", communityJob === community.amount ? "pass" : "info",
    `holds ${fmt(communityJob)} JOB`, explorer(community.wallet));

  add("metadata authority", meta?.updateAuthority ? "info" : "pass",
    meta?.updateAuthority ? "still active. we can update the logo and links" : "none. metadata locked forever", mintLink);

  return { checks, checkedAt: Date.now(), pool: poolAmounts, vesting };
}

/** When the token was created, from the block time of its creation transaction. */
export async function mintCreatedAt(): Promise<number> {
  try {
    const status = await rpc<{ value: ({ slot: number } | null)[] }>("getSignatureStatuses", [
      [TOKEN.createSignature], { searchTransactionHistory: true }]);
    const slot = status.value[0]?.slot;
    if (slot) {
      const time = await rpc<number | null>("getBlockTime", [slot]);
      if (time) return time * 1000;
    }
  } catch {
    // fall back to the recorded time below
  }
  return Date.parse(TOKEN.createdAt);
}
