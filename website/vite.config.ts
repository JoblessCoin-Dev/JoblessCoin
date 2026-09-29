import { defineConfig, type Plugin } from "vite";

// Content Security Policy, added to the built page only (the dev server injects inline
// styles for hot reload). GitHub Pages can't send headers, so it ships as a meta tag.
// frame-ancestors can't be set by meta; src/main.ts refuses to run inside a frame instead.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.devnet.solana.com https://deluxe-mochi-c9b389.netlify.app",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "joblesscoin-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // Served from https://joblesscoin-dev.github.io/JoblessCoin/ until there is a custom domain.
  base: "/JoblessCoin/",
  plugins: [csp()],
  server: { fs: { allow: [".."] } }, // lets the dev server read ../deployments/devnet.json
  build: {
    target: "es2022",
    assetsInlineLimit: 0, // keep every asset a real file, so the CSP never needs data: for scripts
    cssCodeSplit: false,
    sourcemap: false,
  },
});
