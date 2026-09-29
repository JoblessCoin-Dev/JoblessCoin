import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** The Loop: the clock hand ticks through the workday as you scroll, then the J breaks out. */
export function initLoop(reducedMotion: boolean) {
  const section = document.querySelector<HTMLElement>("#loop")!;
  const dial = section.querySelector<HTMLElement>(".loop-dial")!;
  const hand = section.querySelector<SVGElement>("#loop-hand")!;
  const beats = [...section.querySelectorAll<HTMLElement>("[data-beat]")];

  const setBeat = (i: number) => beats.forEach((b, k) => b.classList.toggle("is-on", k <= i));

  // 60 clock ticks around the ring's true center (512, 585.1 in the logo's SVG space).
  const ticks = section.querySelector<SVGGElement>(".loop-ticks")!;
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r2 = k % 5 === 0 ? 398 : 382;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(512 + Math.cos(a) * 366));
    line.setAttribute("y1", String(585.1 + Math.sin(a) * 366));
    line.setAttribute("x2", String(512 + Math.cos(a) * r2));
    line.setAttribute("y2", String(585.1 + Math.sin(a) * r2));
    line.setAttribute("class", k % 5 === 0 ? "tick tick-long" : "tick");
    ticks.append(line);
  }

  if (reducedMotion) {
    setBeat(beats.length - 1);
    dial.classList.add("is-broken");
    return;
  }

  ScrollTrigger.create({
    trigger: section,
    start: "top 65%",
    end: "bottom 60%",
    scrub: true,
    onUpdate: ({ progress }) => {
      // 09:00 to 17:00, then round and round: the hand does 1.5 turns across the story.
      gsap.set(hand, { rotation: 270 + progress * 540, svgOrigin: "512 585.1" });
      const i = Math.min(beats.length - 1, Math.floor(progress * beats.length * 1.02));
      setBeat(i);
      dial.classList.toggle("is-broken", progress > 0.86);
    },
  });
}
