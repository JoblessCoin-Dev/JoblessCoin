// Minimal read-only Solana JSON-RPC client. No wallet code, no signing, no keys:
// the website can only ever read public data.
import { RPC_URL } from "../config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One JSON-RPC call. The free public endpoint rate-limits, so a busy answer gets one retry. */
export async function rpc<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message: string } };
      const busy = res.status === 429 || /too many requests/i.test(body.error?.message ?? "");
      if (busy && attempt === 0) {
        await sleep(1500);
        continue;
      }
      if (!res.ok || body.error) throw new Error(body.error?.message ?? `RPC answered ${res.status}`);
      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---- tiny binary helpers ----

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Decodes base58; returns null if the text isn't valid base58. */
export function base58Decode(text: string): Uint8Array | null {
  let n = 0n;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class Reader {
  private view: DataView;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8 = (o: number) => this.view.getUint8(o);
  u64 = (o: number) => this.view.getBigUint64(o, true);
  i64 = (o: number) => Number(this.view.getBigInt64(o, true));
  key = (o: number) => base58Encode(this.bytes.subarray(o, o + 32));
}

export interface AccountInfo<D> {
  owner: string;
  lamports: number;
  data: D;
}
