// Streamflow vesting helper, called by scripts/lock-development.sh and scripts/verify-token.sh.
// Not meant to be run by hand. All input comes from JC_* environment variables; output is JSON.
//
//   node scripts/vesting.mjs create   -> {"streamId": "...", "signature": "..."}
//   node scripts/vesting.mjs info     -> on-chain contract terms of JC_STREAM_ID
import { readFileSync } from "node:fs";
import BN from "bn.js";

// bigint-buffer warns about its optional native bindings on import (installs run with
// ignore-scripts, so the pure-JS fallback is used). Silence only that one message.
const warn = console.warn;
console.warn = (...args) => {
  if (!String(args[0]).startsWith("bigint: Failed to load bindings")) warn(...args);
};
const { Keypair } = await import("@solana/web3.js");
const { ICluster, SolanaStreamClient } = await import("@streamflow/stream");

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

// Localnet tests run against Streamflow's devnet program cloned into the validator,
// so both use the devnet program and fee-oracle addresses.
const client = new SolanaStreamClient(env("JC_RPC_URL"), ICluster.Devnet, "confirmed");

async function create() {
  const sender = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(env("JC_SENDER_KEYPAIR"), "utf8"))),
  );
  const start = Number(env("JC_START"));
  const { txId, metadataId } = await client.create(
    {
      recipient: env("JC_RECIPIENT"),
      tokenId: env("JC_MINT"),
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
      start,
      cliff: start,
      amount: new BN(env("JC_AMOUNT_BASE")),
      cliffAmount: new BN(env("JC_CLIFF_AMOUNT_BASE")),
      period: Number(env("JC_PERIOD")),
      amountPerPeriod: new BN(env("JC_AMOUNT_PER_PERIOD_BASE")),
      name: env("JC_NAME"),
      // Irrevocable vesting: nobody can cancel, top up, pause or speed it up.
      canTopup: false,
      canPause: false,
      canUpdateRate: false,
      cancelableBySender: false,
      cancelableByRecipient: false,
      transferableBySender: false,
      // The recipient may move the contract to a new wallet (e.g. if its key is compromised).
      // This never changes the unlock schedule.
      transferableByRecipient: true,
      automaticWithdrawal: false,
    },
    { sender },
  );
  return { streamId: metadataId, signature: txId };
}

async function info() {
  const s = await client.getOne({ id: env("JC_STREAM_ID") });
  return {
    sender: s.sender,
    recipient: s.recipient,
    mint: s.mint,
    depositedAmount: s.depositedAmount.toString(),
    withdrawnAmount: s.withdrawnAmount.toString(),
    start: s.start,
    cliff: s.cliff,
    cliffAmount: s.cliffAmount.toString(),
    period: s.period,
    amountPerPeriod: s.amountPerPeriod.toString(),
    end: s.end,
    cancelableBySender: s.cancelableBySender,
    cancelableByRecipient: s.cancelableByRecipient,
    transferableBySender: s.transferableBySender,
    canTopup: s.canTopup,
    canceledAt: s.canceledAt,
    closed: s.closed,
  };
}

const commands = { create, info };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`usage: node scripts/vesting.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
try {
  console.log(JSON.stringify(await command()));
} catch (err) {
  console.error(`vesting ${process.argv[2]} failed: ${err?.message ?? err}`);
  process.exit(1);
}
