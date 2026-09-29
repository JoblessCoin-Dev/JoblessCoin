// Raydium CPMM helper, called by scripts/create-pool.sh, scripts/lock-liquidity.sh and
// scripts/verify-token.sh. Not meant to be run by hand. Input comes from JC_* environment
// variables; output is one line of JSON.
//
//   node scripts/pool.mjs create  -> {"poolId", "lpMint", "vaultA", "vaultB", "signature", ...}
//   node scripts/pool.mjs lock    -> {"signature", "lpAmount", "nftMint", ...}  (Burn & Earn)
//   node scripts/pool.mjs info    -> pool reserves, LP supply, owner/locked LP balances
//   node scripts/pool.mjs swap    -> test trade (buy = SOL->JOB, sell = JOB->SOL)
//   node scripts/pool.mjs fees    -> trading fees claimable by the Fee Key NFT
//   node scripts/pool.mjs harvest -> collect those fees to the Fee Key holder
import { readFileSync } from "node:fs";
import BN from "bn.js";

// stdout carries exactly one JSON line for the calling script; the Raydium SDK logs with
// console.log, so route all console output to stderr. Two known noise lines are dropped:
// bigint-buffer's optional-bindings warning and the SDK's base64 "simulate tx string" dump.
const NOISE = ["bigint: Failed to load bindings", "simulate tx string"];
const toStderr = (...args) => {
  if (!NOISE.some((n) => String(args[0]).startsWith(n))) process.stderr.write(args.join(" ") + "\n");
};
console.log = console.info = console.debug = console.warn = toStderr;
const { Connection, Keypair, PublicKey } = await import("@solana/web3.js");
const { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import("@solana/spl-token");
const {
  Raydium, TxVersion, DEVNET_PROGRAM_ID, CpmmConfigInfoLayout, getCpmmPdaAmmConfigId, CurveCalculator, FeeOn,
} = await import("@raydium-io/raydium-sdk-v2");

// Localnet tests run against Raydium's devnet programs cloned into the validator,
// so both use the devnet program addresses.
const CPMM_PROGRAM = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
const CPMM_FEE_ACCOUNT = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;
const LOCK_PROGRAM = DEVNET_PROGRAM_ID.LOCK_CPMM_PROGRAM;
const LOCK_AUTH = DEVNET_PROGRAM_ID.LOCK_CPMM_AUTH;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

const connection = new Connection(env("JC_RPC_URL"), "confirmed");

function loadOwner() {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(env("JC_OWNER_KEYPAIR"), "utf8"))));
}

async function sdk(owner) {
  return Raydium.load({
    connection,
    cluster: "devnet",
    owner,
    disableLoadToken: true,
    disableFeatureCheck: true,
    blockhashCommitment: "confirmed",
  });
}

// Read the fee tier straight from the chain instead of Raydium's (mainnet-only) API.
async function feeConfig(index) {
  const id = getCpmmPdaAmmConfigId(CPMM_PROGRAM, index).publicKey;
  const account = await connection.getAccountInfo(id);
  if (!account) throw new Error(`CPMM fee config ${index} (${id.toBase58()}) not found`);
  const c = CpmmConfigInfoLayout.decode(account.data);
  if (c.disableCreatePool) throw new Error(`fee config ${index} has pool creation disabled`);
  return {
    id: id.toBase58(),
    index,
    protocolFeeRate: c.protocolFeeRate.toNumber(),
    tradeFeeRate: c.tradeFeeRate.toNumber(),
    fundFeeRate: c.fundFeeRate.toNumber(),
    createPoolFee: c.createPoolFee.toString(),
    creatorFeeRate: c.creatorFeeRate?.toNumber?.() ?? 0,
  };
}

async function tokenBalance(owner, mint, programId) {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, programId);
  const res = await connection.getTokenAccountBalance(ata).catch(() => null);
  return res ? res.value.amount : "0";
}

async function create() {
  const owner = loadOwner();
  const raydium = await sdk(owner);
  const config = await feeConfig(Number(env("JC_FEE_CONFIG_INDEX")));
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: CPMM_PROGRAM,
    poolFeeAccount: CPMM_FEE_ACCOUNT,
    mintA: { address: env("JC_MINT"), programId: TOKEN_2022_PROGRAM_ID.toBase58(), decimals: Number(env("JC_DECIMALS")) },
    mintB: { address: NATIVE_MINT.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 9 },
    mintAAmount: new BN(env("JC_TOKEN_AMOUNT_BASE")),
    mintBAmount: new BN(env("JC_SOL_LAMPORTS")),
    startTime: new BN(0),
    feeConfig: config,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const a = extInfo.address;
  return {
    signature: txId,
    programId: a.programId.toBase58(),
    poolId: a.poolId.toBase58(),
    lpMint: a.lpMint.toBase58(),
    vaultA: a.vaultA.toBase58(),
    vaultB: a.vaultB.toBase58(),
    configId: config.id,
    tradeFeeRate: config.tradeFeeRate,
  };
}

async function lock() {
  const owner = loadOwner();
  const raydium = await sdk(owner);
  const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(env("JC_POOL_ID"));
  const lpAmount = new BN(await tokenBalance(owner.publicKey, poolInfo.lpMint.address, TOKEN_PROGRAM_ID));
  if (lpAmount.isZero()) throw new Error("owner holds no LP tokens for this pool");
  const { execute, extInfo } = await raydium.cpmm.lockLp({
    programId: LOCK_PROGRAM,
    authProgram: LOCK_AUTH,
    poolKeys,
    poolInfo,
    lpAmount,
    withMetadata: true,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const ext = Object.fromEntries(Object.entries(extInfo ?? {}).map(([k, v]) => [k, v?.toBase58?.() ?? String(v)]));
  return { signature: txId, lpAmount: lpAmount.toString(), ...ext };
}

async function info() {
  const raydium = await sdk();
  const { poolInfo, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(env("JC_POOL_ID"));
  const out = {
    programId: poolInfo.programId,
    mintA: poolInfo.mintA.address,
    mintB: poolInfo.mintB.address,
    lpMint: poolInfo.lpMint.address,
    reserveA: rpcData.baseReserve.toString(),
    reserveB: rpcData.quoteReserve.toString(),
    lpSupply: rpcData.lpAmount.toString(),
  };
  if (process.env.JC_OWNER) out.ownerLp = await tokenBalance(env("JC_OWNER"), out.lpMint, TOKEN_PROGRAM_ID);
  if (process.env.JC_NFT_OWNER && process.env.JC_NFT_MINT) {
    out.nftBalance = await tokenBalance(env("JC_NFT_OWNER"), env("JC_NFT_MINT"), TOKEN_PROGRAM_ID);
  }
  return out;
}

async function swap() {
  const owner = loadOwner();
  const raydium = await sdk(owner);
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(env("JC_POOL_ID"));
  const side = env("JC_SIDE");
  if (side !== "buy" && side !== "sell") throw new Error("JC_SIDE must be buy or sell");
  const inputMint = side === "buy" ? NATIVE_MINT.toBase58() : env("JC_MINT");
  const baseIn = inputMint === poolInfo.mintA.address;
  const inputAmount = new BN(env("JC_AMOUNT_BASE"));
  const c = rpcData.configInfo;
  const quote = CurveCalculator.swapBaseInput(
    inputAmount,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    c.tradeFeeRate, c.creatorFeeRate, c.protocolFeeRate, c.fundFeeRate,
    rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB,
  );
  const { execute } = await raydium.cpmm.swap({
    poolInfo, poolKeys, inputAmount, swapResult: quote, baseIn,
    slippage: Number(process.env.JC_SLIPPAGE ?? "0.01"),
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  return {
    signature: txId, side,
    inputAmount: quote.inputAmount.toString(),
    outputAmount: quote.outputAmount.toString(),
    tradeFee: quote.tradeFee.toString(),
  };
}

// Burn & Earn lock account (LockedCpLiquidityState), decoded from the chain:
//   8-byte discriminator | lockedLp u64 | claimedLp u64 | unclaimedLp u64 | lastLp u64 |
//   lastK u128 | recentEpoch u64 | poolId | feeNftMint | lockedOwner | lpMint (32 bytes each)
async function lockState(lockPda) {
  const a = await connection.getAccountInfo(new PublicKey(lockPda));
  if (!a || !a.owner.equals(LOCK_PROGRAM)) throw new Error(`${lockPda} is not a Burn & Earn lock account`);
  const d = a.data;
  const u64 = (o) => new BN(d.subarray(o, o + 8), "le");
  return {
    lockedLp: u64(8), claimedLp: u64(16), unclaimedLp: u64(24), lastLp: u64(32),
    lastK: new BN(d.subarray(40, 56), "le"),
    poolId: new PublicKey(d.subarray(64, 96)).toBase58(),
    nftMint: new PublicKey(d.subarray(96, 128)).toBase58(),
  };
}

// The locked position's underlying value grows with sqrt(k)/lpSupply as trades pay fees.
// Fees in LP terms = what can be taken out while leaving the originally locked value in place:
//   principalLp = lockedLp * sqrt(lastK) / lastLp * currentLp / sqrt(currentK)
// Rounded down (and 1 unit kept back) so we never ask for more than the program allows.
async function claimable(raydium, lockPda) {
  const lock = await lockState(lockPda);
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(lock.poolId);
  const currentK = rpcData.baseReserve.mul(rpcData.quoteReserve);
  const currentLp = rpcData.lpAmount;
  const principal = lock.lockedLp.mul(sqrtBN(lock.lastK)).mul(currentLp)
    .div(lock.lastLp.mul(sqrtBN(currentK)));
  let accrued = lock.lockedLp.sub(principal).subn(1);
  if (accrued.isNeg()) accrued = new BN(0);
  const feeLp = accrued.add(lock.unclaimedLp);
  return {
    lock, poolInfo, poolKeys, feeLp,
    estJob: feeLp.mul(poolInfo.mintA.address === NATIVE_MINT.toBase58() ? rpcData.quoteReserve : rpcData.baseReserve).div(currentLp),
    estSol: feeLp.mul(poolInfo.mintA.address === NATIVE_MINT.toBase58() ? rpcData.baseReserve : rpcData.quoteReserve).div(currentLp),
  };
}

function sqrtBN(n) {  // integer square root (floor)
  if (n.isZero()) return new BN(0);
  let x = new BN(1).shln(Math.ceil(n.bitLength() / 2));
  for (;;) {
    const y = x.add(n.div(x)).shrn(1);
    if (y.gte(x)) return x;
    x = y;
  }
}

async function fees() {
  const c = await claimable(await sdk(), env("JC_LOCK_PDA"));
  return {
    lockedLp: c.lock.lockedLp.toString(), claimedLp: c.lock.claimedLp.toString(),
    claimableLp: c.feeLp.toString(), estJob: c.estJob.toString(), estSol: c.estSol.toString(),
  };
}

async function harvest() {
  const owner = loadOwner();
  const raydium = await sdk(owner);
  const c = await claimable(raydium, env("JC_LOCK_PDA"));
  if (c.feeLp.isZero()) throw new Error("no trading fees to collect yet");
  const { execute } = await raydium.cpmm.harvestLockLp({
    programId: LOCK_PROGRAM,
    authProgram: LOCK_AUTH,
    cpmmProgram: { programId: CPMM_PROGRAM, authProgram: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_AUTH },
    poolInfo: c.poolInfo,
    poolKeys: c.poolKeys,
    nftMint: new PublicKey(c.lock.nftMint),
    lpFeeAmount: c.feeLp,
    closeWsol: true,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  return { signature: txId, lpFeeAmount: c.feeLp.toString(), estJob: c.estJob.toString(), estSol: c.estSol.toString() };
}

const commands = { create, lock, info, swap, fees, harvest };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`usage: node scripts/pool.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
try {
  process.stdout.write(JSON.stringify(await command()) + "\n");
  process.exit(0); // the SDK keeps timers alive
} catch (err) {
  console.error(`pool ${process.argv[2]} failed: ${err?.message ?? err}`);
  process.exit(1);
}
