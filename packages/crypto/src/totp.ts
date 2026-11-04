import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!s || /[^A-Z2-7]/.test(s)) throw new Error("Invalid base32 value");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit TOTP secret (the size authenticator apps expect). */
export const generateTotpSecret = (): Buffer => randomBytes(20);

/** RFC 4226 HOTP. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export interface TotpOptions { step?: number; digits?: number }
export const totpStep = (timeMs = Date.now(), step = 30): number => Math.floor(timeMs / 1000 / step);
export const totpCode = (secret: Buffer, timeMs = Date.now(), o: TotpOptions = {}): string => hotp(secret, totpStep(timeMs, o.step ?? 30), o.digits ?? 6);

/**
 * Check a code against the current time step and `window` steps either side (clock drift).
 * Returns the matching step, or null. A step at or before `lastStep` is rejected so a code can be used once.
 */
export function verifyTotp(secret: Buffer, code: string, o: TotpOptions & { timeMs?: number; window?: number; lastStep?: number } = {}): number | null {
  const digits = o.digits ?? 6;
  const clean = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return null;
  const now = totpStep(o.timeMs ?? Date.now(), o.step ?? 30);
  const window = o.window ?? 1;
  let match: number | null = null;
  for (let s = now - window; s <= now + window; s++) {
    const expected = Buffer.from(hotp(secret, s, digits));
    const given = Buffer.from(clean);
    // check every step (no early exit) so timing does not reveal which one matched
    if (timingSafeEqual(expected, given) && s > (o.lastStep ?? -1) && match === null) match = s;
  }
  return match;
}

export function otpauthUri(p: { secret: Buffer; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(p.issuer)}:${encodeURIComponent(p.account)}`;
  const q = new URLSearchParams({ secret: base32Encode(p.secret), issuer: p.issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Single-use recovery codes like `k3f9a-p2x7m` (no look-alike characters). */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const one = () => Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return Array.from({ length: n }, () => { const c = one(); return `${c.slice(0, 5)}-${c.slice(5)}`; });
}
export const normalizeRecoveryCode = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A numeric code for email delivery, e.g. "048213". */
export const generateNumericCode = (digits = 6): string => String(randomInt(0, 10 ** digits)).padStart(digits, "0");

/** Mask an address for display: j***@example.com */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
