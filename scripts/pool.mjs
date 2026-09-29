// Raydium CPMM helper, called by scripts/create-pool.sh, scripts/lock-liquidity.sh and
// scripts/verify-token.sh. Not meant to be run by hand. Input comes from JC_* environment
// variables; output is one line of JSON.
//
//   node scripts/pool.mjs create  -> {"poolId", "lpMint", "vaultA", "vaultB", "signature", ...}
//   node scripts/pool.mjs lock    -> {"signature", "lpAmount", "nftMint", ...}  (Burn & Earn)
//   node scripts/pool.mjs info    -> pool reserves, LP supply, owner/locked LP balances
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
  Raydium, TxVersion, DEVNET_PROGRAM_ID, CpmmConfigInfoLayout, getCpmmPdaAmmConfigId,
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

const commands = { create, lock, info };
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
