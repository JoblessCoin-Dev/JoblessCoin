import { ALLOCATIONS, VESTING, explorer } from "../config";

const NS = "http://www.w3.org/2000/svg";
const COLORS: Record<string, string> = { liquidity: "#F5F7F5", community: "#36FF6F", development: "#00A63E" };
const R = 104;
const C = 2 * Math.PI * R;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Tokenomics as a clock face: the 90 / 5 / 5 split drawn like the JoblessCoin ring. */
export function initTimesheet() {
  const dial = document.querySelector<SVGSVGElement>("#timesheet-dial")!;
  const legend = document.querySelector<HTMLElement>("#timesheet-legend")!;
  const toggles = document.querySelectorAll<HTMLButtonElement>("[data-sheet-mode]");

  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    dial.append(el("line", {
      x1: 150 + Math.cos(a) * 134, y1: 150 + Math.sin(a) * 134,
      x2: 150 + Math.cos(a) * (long ? 145 : 139), y2: 150 + Math.sin(a) * (long ? 145 : 139),
      class: long ? "tick tick-long" : "tick",
    }));
  }

  let startFrac = 0;
  const arcs = new Map<string, SVGCircleElement>();
  for (const a of ALLOCATIONS) {
    const frac = a.percent / 100;
    const mid = (startFrac + frac / 2) * Math.PI * 2 - Math.PI / 2;
    const gap = 2.5; // small breathing space between slices, in px of arc
    const arc = el("circle", {
      cx: 150, cy: 150, r: R, fill: "none", stroke: COLORS[a.key], "stroke-width": 22,
      "stroke-dasharray": `${Math.max(frac * C - gap, 1)} ${C}`,
      "stroke-dashoffset": -startFrac * C, transform: "rotate(-90 150 150)", class: "slice",
    }) as SVGCircleElement;
    arc.style.setProperty("--dx", `${Math.cos(mid) * 9}px`);
    arc.style.setProperty("--dy", `${Math.sin(mid) * 9}px`);
    arc.dataset.key = a.key;
    dial.append(arc);
    arcs.set(a.key, arc);
    startFrac += frac;
  }

  const rows = ALLOCATIONS.map((a) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sheet-row";
    row.dataset.key = a.key;
    const swatch = document.createElement("i");
    swatch.className = "swatch";
    swatch.style.background = COLORS[a.key];
    const text = document.createElement("span");
    text.className = "sheet-text";
    const title = document.createElement("b");
    title.textContent = `${a.label} · ${a.amount.toLocaleString("en-US")} JOB`;
    text.append(title, document.createElement("small"));
    const pct = document.createElement("span");
    pct.className = "sheet-pct";
    pct.textContent = `${a.percent}%`;
    row.append(swatch, text, pct);
    const focus = (on: boolean) => {
      arcs.get(a.key)!.classList.toggle("is-lifted", on);
      row.classList.toggle("is-active", on);
    };
    row.addEventListener("mouseenter", () => focus(true));
    row.addEventListener("mouseleave", () => focus(false));
    row.addEventListener("focus", () => focus(true));
    row.addEventListener("blur", () => focus(false));
    row.addEventListener("click", () => window.open(explorer(a.wallet), "_blank", "noopener"));
    arcs.get(a.key)!.addEventListener("mouseenter", () => focus(true));
    arcs.get(a.key)!.addEventListener("mouseleave", () => focus(false));
    legend.append(row);
    return { row, a };
  });

  const setMode = (mode: "devnet" | "mainnet") => {
    toggles.forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.sheetMode === mode)));
    for (const { row, a } of rows) row.querySelector("small")!.textContent = mode === "devnet" ? `Devnet, done and verified: ${a.devnet}` : `Mainnet, the plan: ${a.mainnet}`;
  };
  toggles.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.sheetMode as "devnet" | "mainnet")));
  setMode("devnet");

  startCliffCountdown(VESTING.start);
}

let cliffTimer = 0;
/** Live countdown to the first unlock of the team tokens. */
export function startCliffCountdown(startSec: number) {
  const out = document.querySelector<HTMLElement>("#cliff-countdown");
  const date = document.querySelector<HTMLElement>("#cliff-date");
  if (!out) return;
  if (date) date.textContent = new Date(startSec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  clearInterval(cliffTimer);
  const tick = () => {
    let s = Math.max(0, Math.floor(startSec - Date.now() / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    out.textContent = `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };
  tick();
  cliffTimer = window.setInterval(tick, 1000);
}
