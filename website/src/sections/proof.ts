import { runProof, type Check, type ProofResult } from "../chain/proof";

const TAG: Record<Check["status"], string> = { pass: "PASS", info: "NOTE", fail: "FAIL" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProofHooks {
  onResult?: (r: ProofResult) => void;
}

/** The "Proof, not promises" terminal. Every line is a live read of the chain. */
export function initProof(reducedMotion: boolean, hooks: ProofHooks = {}) {
  const out = document.querySelector<HTMLOListElement>("#proof-lines")!;
  const summary = document.querySelector<HTMLElement>("#proof-summary")!;
  const rerun = document.querySelector<HTMLButtonElement>("#proof-rerun")!;
  const status = document.querySelector<HTMLElement>("#status-verified");
  let lastChecked = 0;
  let busy = false;

  setInterval(() => {
    if (!lastChecked || !status) return;
    const s = Math.round((Date.now() - lastChecked) / 1000);
    status.textContent = s < 60 ? `verified ${s}s ago` : `verified ${Math.round(s / 60)}m ago`;
  }, 1000);

  async function run() {
    if (busy) return;
    busy = true;
    rerun.disabled = true;
    out.replaceChildren();
    summary.textContent = "connecting to Solana Devnet…";
    summary.dataset.state = "busy";
    try {
      const result = await runProof();
      for (const [i, check] of result.checks.entries()) {
        out.append(line(i + 1, check));
        if (!reducedMotion) await wait(170);
      }
      const pass = result.checks.filter((c) => c.status === "pass").length;
      const notes = result.checks.filter((c) => c.status === "info").length;
      const fails = result.checks.filter((c) => c.status === "fail").length;
      summary.dataset.state = fails ? "fail" : "ok";
      summary.textContent = fails
        ? `${fails} check${fails > 1 ? "s" : ""} failed. Something changed onchain. Don't trust this token until it's fixed.`
        : `${pass} checks passed${notes ? `, ${notes} note` : ""}. Checked live, just now, by your own browser.`;
      lastChecked = result.checkedAt;
      hooks.onResult?.(result);
    } catch {
      summary.dataset.state = "fail";
      summary.textContent = "Couldn't reach Solana Devnet right now. It's a free test network and sometimes naps. Try again in a bit.";
    } finally {
      busy = false;
      rerun.disabled = false;
    }
  }

  rerun.addEventListener("click", run);

  // Run once the terminal scrolls into view, so every visitor sees it type.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      run();
    }
  }, { rootMargin: "0px 0px -20% 0px" });
  io.observe(out);
}

function line(n: number, check: Check): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `proof-line is-${check.status}`;
  const num = document.createElement("span");
  num.className = "proof-n";
  num.textContent = String(n).padStart(2, "0");
  const label = document.createElement("span");
  label.className = "proof-label";
  label.textContent = check.label;
  const value = document.createElement("a");
  value.className = "proof-value";
  value.href = check.link;
  value.target = "_blank";
  value.rel = "noopener noreferrer";
  value.textContent = check.value;
  const tag = document.createElement("span");
  tag.className = "proof-tag";
  tag.textContent = TAG[check.status];
  li.append(num, label, value, tag);
  return li;
}
