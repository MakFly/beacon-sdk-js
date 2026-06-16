/** Trace/span id generation — OTel-shaped lowercase hex, runtime-agnostic. */

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // Web Crypto is available in Node 18+, browsers, edge, and Bun.
  crypto.getRandomValues(buf);
  return buf;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 16 bytes → 32 lowercase hex chars. */
export function generateTraceId(): string {
  return toHex(randomBytes(16));
}

/** 8 bytes → 16 lowercase hex chars. */
export function generateSpanId(): string {
  return toHex(randomBytes(8));
}

/** RFC4122-ish v4 uuid for occurrence tracking. */
export function generateUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
