// House rule: no dashes as punctuation anywhere a visitor can read. Fails the build if one
// slips in. Checks the visible text of index.html and every sentence-like string in src/.
// Allowed: proper names that contain a hyphen, and code shown as code (<pre>, <code>).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED = ["Token-2022", "JoblessCoin-Dev"];
const DASHES = /[‐-―−⸺⸻﹘﹣－]/; // hyphen variants, en/em dash, minus
const problems = [];

const scrub = (text) => ALLOWED.reduce((t, name) => t.replaceAll(name, ""), text);

function checkText(text, where) {
  const t = scrub(text);
  if (DASHES.test(t)) problems.push(`${where}: typographic dash in "${text.trim().slice(0, 90)}"`);
  // a hyphen used as punctuation or to join words in visible text
  if (/(^|[\s\w])-(?=[\s\w])/.test(t)) problems.push(`${where}: hyphen in "${text.trim().slice(0, 90)}"`);
}

// 1. index.html: visible text only (no tags, attributes, scripts, styles, code blocks, comments)
const html = readFileSync(join(ROOT, "index.html"), "utf8")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style|pre|code)\b[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, "\n");
html.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => checkText(line, "index.html"));

// visible attribute text too (alt, aria-label, placeholder, title, meta descriptions)
const raw = readFileSync(join(ROOT, "index.html"), "utf8");
for (const m of raw.matchAll(/\b(alt|aria-label|placeholder|title|content)="([^"]*)"/g)) {
  if (m[1] === "content" && !/\s/.test(m[2])) continue; // single tokens like colors or URLs
  if (/^(width=|default-src|https?:)/.test(m[2])) continue;
  checkText(m[2], `index.html [${m[1]}]`);
}

// 2. TypeScript: string literals that read like sentences (contain a space and a letter).
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}
for (const file of walk(join(ROOT, "src"))) {
  if (file.includes("engine")) continue; // shaders and math, nothing a visitor reads
  const src = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const s = m[2].replace(/\$\{[^}]*\}/g, " ");
    if (!/\s/.test(s) || !/[a-z]/i.test(s)) continue;
    if (/[\n;{}*]|=>|^\s*\(/.test(s)) continue; // code, math or a media query, not a sentence
    if (/^\s*[a-z][a-z0-9]*(-[a-z0-9]*)*(\s+[a-z][a-z0-9]*(-[a-z0-9]*)*)*\s*$/.test(s) && s.includes("-")) continue; // CSS class list
    if (/^[.#[]|:\/\/|^\s*(rgba?|var)\(|\b(px|em|rem|vh|vw)\b|font|input\[|^\d/.test(s)) continue; // selectors, URLs, CSS
    checkText(s, file.slice(ROOT.length));
  }
}

if (problems.length) {
  console.error(`Copy check failed. No dashes on the website:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("Copy check passed: no dashes in visible text.");
