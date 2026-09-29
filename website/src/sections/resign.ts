// Resignation card generator. Everything happens on the visitor's device: the card is drawn
// on a canvas, nothing is uploaded, nothing is stored.

type Style = "paper" | "terminal" | "neon";

const W = 1080;
const H = 1350;
const BASE = import.meta.env.BASE_URL;

const THEMES: Record<Style, { bg: string; ink: string; muted: string; accent: string; rule: string; stamp: string }> = {
  paper: { bg: "#F5F7F5", ink: "#0A0C0B", muted: "#4A544E", accent: "#00A63E", rule: "#CFD6D1", stamp: "brand/joblesscoin-icon-color-on-light.svg" },
  terminal: { bg: "#070908", ink: "#36FF6F", muted: "#7FAF8C", accent: "#36FF6F", rule: "#1E2A22", stamp: "brand/joblesscoin-icon-color-on-dark.svg" },
  neon: { bg: "#0A0C0B", ink: "#F5F7F5", muted: "#9AA59D", accent: "#36FF6F", rule: "#232A26", stamp: "brand/joblesscoin-icon-color-on-dark.svg" },
};

const clean = (s: string, max: number) =>
  s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const images = new Map<string, HTMLImageElement>();
function image(src: string): Promise<HTMLImageElement> {
  const cached = images.get(src);
  if (cached?.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = cached ?? new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = BASE + src;
    images.set(src, img);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function letterText(name: string, boss: string) {
  return {
    title: "I HEREBY RESIGN FROM THE GRIND.",
    body:
      `Dear ${boss || "whoever runs this loop"},\n` +
      "Effective immediately, I am done with the loop. No more 9 to 5. No more reply all. " +
      "No more meetings that could have been an email.\n" +
      "The spreadsheet is yours now. I'm going outside.",
    sign: `Signed, ${name || "a free human"}`,
  };
}

async function draw(canvas: HTMLCanvasElement, style: Style, name: string, boss: string) {
  const t = THEMES[style];
  const ctx = canvas.getContext("2d")!;
  const text = letterText(name, boss);
  await document.fonts.ready;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);

  if (style === "neon") {
    const g = ctx.createRadialGradient(W * 0.78, H * 0.18, 20, W * 0.78, H * 0.18, 700);
    g.addColorStop(0, "rgba(54,255,111,0.28)");
    g.addColorStop(1, "rgba(54,255,111,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (style === "terminal") {
    ctx.fillStyle = "rgba(54,255,111,0.035)";
    for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2); // scanlines
  }

  const pad = 96;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = t.muted;
  ctx.font = "400 26px 'JetBrains Mono', monospace";
  ctx.fillText("TIMESTAMP 16:59 · FRIDAY", pad, pad + 20);

  const stamp = await image(t.stamp);
  ctx.save();
  ctx.translate(W - pad - 90, pad + 70);
  ctx.rotate(-0.21);
  if (style !== "paper") {
    ctx.shadowColor = "rgba(54,255,111,0.65)";
    ctx.shadowBlur = 40;
  }
  ctx.drawImage(stamp, -110, -110, 220, 220);
  ctx.restore();

  ctx.fillStyle = t.ink;
  ctx.font = "800 84px Unbounded, sans-serif";
  if (style === "neon") {
    ctx.shadowColor = "rgba(54,255,111,0.55)";
    ctx.shadowBlur = 28;
  }
  let y = 420;
  for (const l of wrap(ctx, text.title, W - pad * 2)) {
    ctx.fillText(l, pad, y);
    y += 96;
  }
  ctx.shadowBlur = 0;

  y += 40;
  ctx.fillStyle = t.muted;
  ctx.font = "400 38px 'Space Grotesk', sans-serif";
  for (const l of wrap(ctx, text.body, W - pad * 2)) {
    ctx.fillText(l, pad, y);
    y += l ? 56 : 30;
  }

  const base = H - pad - 150;
  ctx.fillStyle = t.rule;
  ctx.fillRect(pad, base, W - pad * 2, 3);
  ctx.fillStyle = t.ink;
  ctx.font = "600 50px 'Space Grotesk', sans-serif";
  ctx.fillText(text.sign, pad, base + 78);
  ctx.fillStyle = t.accent;
  ctx.font = "600 26px 'JetBrains Mono', monospace";
  ctx.fillText("NO JOB. NO BOSS. NO PROBLEM.   $JOB", pad, base + 130);
}

export function initResign() {
  const form = document.querySelector<HTMLFormElement>("#resign-form")!;
  const nameIn = document.querySelector<HTMLInputElement>("#resign-name")!;
  const bossIn = document.querySelector<HTMLInputElement>("#resign-boss")!;
  const canvas = document.querySelector<HTMLCanvasElement>("#resign-canvas")!;
  const note = document.querySelector<HTMLElement>("#resign-note")!;
  canvas.width = W;
  canvas.height = H;

  const style = () => (form.querySelector<HTMLInputElement>("input[name=resign-style]:checked")?.value ?? "paper") as Style;
  const values = () => ({ name: clean(nameIn.value, 28), boss: clean(bossIn.value, 36) });
  let pending = 0;
  const redraw = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const { name, boss } = values();
      draw(canvas, style(), name, boss).catch(() => (note.textContent = "Couldn't draw the card. Try another style."));
    });
  };

  form.addEventListener("input", redraw);
  form.addEventListener("submit", (e) => e.preventDefault());

  document.querySelector("#resign-download")!.addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = values().name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "me";
      a.href = url;
      a.download = `resignation_${slug}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      note.textContent = "Saved. Now post it before you change your mind.";
    }, "image/png");
  });

  document.querySelector("#resign-post")!.addEventListener("click", () => {
    const text = "I just resigned from the grind. No job. No boss. No problem. $JOB";
    const url = location.origin + location.pathname;
    const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(href, "_blank", "noopener,noreferrer");
    note.textContent = "Opened X in a new tab. Attach your downloaded card to the post.";
  });

  document.querySelector("#resign-copy")!.addEventListener("click", async () => {
    const { name, boss } = values();
    const t = letterText(name, boss);
    try {
      await navigator.clipboard.writeText(`${t.title}\n\n${t.body}\n\n${t.sign}\nNo job. No boss. No problem.`);
      note.textContent = "Copied. Paste it anywhere.";
    } catch {
      note.textContent = "Your browser blocked copying. Select the text on the card instead.";
    }
  });

  redraw();
}
