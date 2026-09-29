import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles/main.css";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Breakout } from "./engine/breakout";
import { initProof } from "./sections/proof";
import { initTimesheet, startCliffCountdown } from "./sections/timesheet";
import { initResign } from "./sections/resign";
import { initLoop } from "./sections/loop";
import { initBossKey, initChecker, initClockedOut, initCopyButtons } from "./sections/extras";

gsap.registerPlugin(ScrollTrigger);

// A fake site could load ours inside a frame to borrow its trust. Refuse to run there.
if (window.top !== window.self) {
  document.body.replaceChildren(
    Object.assign(document.createElement("p"), {
      className: "framed",
      textContent: "This page was opened inside another website. Open JoblessCoin directly in your browser.",
    }),
  );
  throw new Error("framed");
}

const root = document.documentElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width: 760px), (pointer: coarse)").matches;
root.classList.add("js");
if (reducedMotion) root.classList.add("reduced");

// ---------- the Breakout ----------

// The 3D engine is its own file, fetched after the page text is on screen.
let engine: Breakout | null = null;
const bootDone = new Promise((r) => setTimeout(r, reducedMotion ? 0 : 1050));
bootClock();

const heroTrigger = ScrollTrigger.create({
  trigger: "#hero",
  start: "top top",
  end: "bottom top",
  scrub: true,
  onUpdate: ({ progress }) => {
    engine?.setHeroProgress(progress);
    root.classList.toggle("docked", progress > 0.8);
  },
});

import("./engine/breakout")
  .then(async ({ Breakout }) => {
    try {
      engine = new Breakout({
        canvas: document.querySelector<HTMLCanvasElement>("#scene")!,
        reducedMotion,
        mobile,
        onBreak: () => root.classList.add("broke-out"),
      });
    } catch {
      root.classList.add("no-webgl");
      return;
    }
    engine.setPage(scrollY);
    engine.setHeroProgress(heroTrigger.progress);
    await bootDone;
    engine.start();
  })
  .catch(() => root.classList.add("no-webgl"));

let scrollQueued = false;
addEventListener("scroll", () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    engine?.setPage(scrollY);
    scrollQueued = false;
  });
}, { passive: true });

// ---------- sections ----------

initLoop(reducedMotion);
initProof(reducedMotion, {
  onResult: (r) => r.vesting && startCliffCountdown(r.vesting.start),
});
initTimesheet();
initResign();
initChecker();
initCopyButtons();
initClockedOut();
initBossKey((on) => engine?.setPaused(on));
initMenu();
if (!reducedMotion) initReveals();

// ---------- small things ----------

/** The boot screen clock ticks from 08:59:57 to 09:00:00. Clocking in. */
function bootClock() {
  const el = document.querySelector("#boot-time");
  if (!el || reducedMotion) return;
  let s = 57;
  const tick = setInterval(() => {
    s++;
    el.textContent = s >= 60 ? "09:00:00" : `08:59:${s}`;
    if (s >= 60) clearInterval(tick);
  }, 260);
}

function initMenu() {
  const btn = document.querySelector<HTMLButtonElement>("#menu-toggle")!;
  const links = document.querySelector<HTMLElement>("#nav-links")!;
  const set = (open: boolean) => {
    btn.setAttribute("aria-expanded", String(open));
    root.classList.toggle("menu-open", open);
  };
  btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
  links.addEventListener("click", (e) => (e.target as HTMLElement).closest("a") && set(false));
}

/** Sections drift up into place as they arrive. Content is never hidden without JS. */
function initReveals() {
  gsap.utils.toArray<HTMLElement>(".section-head, .glass, .beats li").forEach((el) => {
    gsap.from(el, {
      y: 36,
      opacity: 0,
      duration: 0.9,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  });
}
