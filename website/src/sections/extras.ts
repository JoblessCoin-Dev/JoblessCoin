import { PROGRAMS, TOKEN } from "../config";
import { mintCreatedAt } from "../chain/proof";
import { base58Decode, rpc } from "../chain/rpc";

// ---------- fake token checker ----------

const TOKEN_PROGRAMS = new Set([PROGRAMS.token2022, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]);

interface ParsedAccount {
  value: {
    owner: string;
    data: { parsed?: { type?: string; info?: { extensions?: { extension: string; state: { name?: string; symbol?: string } }[] } } } | string[];
  } | null;
}

export function initChecker() {
  const form = document.querySelector<HTMLFormElement>("#checker-form")!;
  const input = document.querySelector<HTMLInputElement>("#checker-input")!;
  const out = document.querySelector<HTMLElement>("#checker-result")!;
  const say = (state: "ok" | "bad" | "warn", text: string) => {
    out.dataset.state = state;
    out.textContent = text;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = input.value.trim();
    const bytes = base58Decode(addr);
    if (!addr) return say("warn", "Paste a token address first.");
    if (!bytes || bytes.length !== 32) return say("warn", "That's not a valid Solana address. Look for typos or missing characters.");
    if (addr === TOKEN.mint) return say("ok", "Official. This is the real JOB token address (on Devnet).");
    if (addr.slice(0, 4) === TOKEN.mint.slice(0, 4) || addr.slice(-4) === TOKEN.mint.slice(-4)) {
      return say("bad", "Fake. This address copies the start or end of the real one to fool you. That's a classic scam trick. Always compare every character.");
    }
    say("warn", "Checking Devnet…");
    try {
      const acc = await rpc<ParsedAccount>("getAccountInfo", [addr, { encoding: "jsonParsed" }]);
      const v = acc.value;
      if (!v) return say("bad", "Not official. Nothing exists at this address on Devnet.");
      const parsed = Array.isArray(v.data) ? undefined : v.data.parsed;
      if (TOKEN_PROGRAMS.has(v.owner) && parsed?.type === "mint") {
        const meta = parsed.info?.extensions?.find((x) => x.extension === "tokenMetadata")?.state;
        return say("bad", meta?.name
          ? `Not official. This token calls itself ${meta.name} (${meta.symbol ?? "no symbol"}), but it is not JOB.`
          : "Not official. This is some other token, not JOB.");
      }
      return say("bad", "Not official. This isn't a token address at all. It's a wallet or a program.");
    } catch {
      say("warn", "Couldn't reach Solana Devnet right now. Try again in a bit.");
    }
  });
}

// ---------- boss key ----------

export function initBossKey(onToggle: (on: boolean) => void) {
  const overlay = document.querySelector<HTMLElement>("#boss")!;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-boss]");
  const set = (on: boolean) => {
    overlay.hidden = !on;
    document.documentElement.classList.toggle("boss-mode", on);
    document.title = on ? "Q3_budget_FINAL_v7.xlsx" : "JoblessCoin | No job. No boss. No problem.";
    onToggle(on);
    if (on) overlay.focus();
  };
  buttons.forEach((b) => b.addEventListener("click", () => set(overlay.hidden !== false)));
  addEventListener("keydown", (e) => {
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "b" || e.key === "B") set(overlay.hidden !== false);
    else if (e.key === "Escape" && !overlay.hidden) set(false);
  });
}

// ---------- time since the breakout ----------

export async function initClockedOut() {
  const targets = document.querySelectorAll<HTMLElement>("[data-clocked-out]");
  if (!targets.length) return;
  const since = await mintCreatedAt();
  const tick = () => {
    let s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const text = `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    targets.forEach((t) => (t.textContent = text));
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- copy buttons ----------

export function initCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    const label = btn.textContent;
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy!;
      try {
        await navigator.clipboard.writeText(value);
        btn.textContent = "Copied";
      } catch {
        const target = btn.dataset.copyTarget && document.getElementById(btn.dataset.copyTarget);
        if (target) getSelection()?.selectAllChildren(target);
        btn.textContent = "Select and copy";
      }
      setTimeout(() => (btn.textContent = label), 1800);
    });
  });
}
