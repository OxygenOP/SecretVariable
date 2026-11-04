import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateNumericCode, generateRecoveryCodes, generateTotpSecret, hotp, maskEmail, normalizeRecoveryCode, otpauthUri, totpCode, verifyTotp } from "./totp.js";

const rfc = Buffer.from("12345678901234567890"); // RFC 4226/6238 test secret

describe("hotp / totp (RFC test vectors)", () => {
  it("matches RFC 4226 Appendix D", () => {
    expect([0, 1, 2, 3, 4, 5].map((c) => hotp(rfc, c))).toEqual(["755224", "287082", "359152", "969429", "338314", "254676"]);
  });
  it("matches RFC 6238 (SHA-1, 8 digits)", () => {
    expect(totpCode(rfc, 59_000, { digits: 8 })).toBe("94287082");
    expect(totpCode(rfc, 1111111109_000, { digits: 8 })).toBe("07081804");
    expect(totpCode(rfc, 20000000000_000, { digits: 8 })).toBe("65353130");
  });
});

describe("verifyTotp", () => {
  const t = 1_700_000_000_000;
  const code = totpCode(rfc, t);
  it("accepts the current code and one step of drift, not more", () => {
    expect(verifyTotp(rfc, code, { timeMs: t })).not.toBeNull();
    expect(verifyTotp(rfc, code, { timeMs: t + 30_000 })).not.toBeNull();
    expect(verifyTotp(rfc, code, { timeMs: t - 30_000 })).not.toBeNull();
    expect(verifyTotp(rfc, code, { timeMs: t + 90_000 })).toBeNull();
  });
  it("rejects replays via lastStep", () => {
    const step = verifyTotp(rfc, code, { timeMs: t })!;
    expect(verifyTotp(rfc, code, { timeMs: t, lastStep: step })).toBeNull();
    expect(verifyTotp(rfc, totpCode(rfc, t + 30_000), { timeMs: t + 30_000, lastStep: step })).not.toBeNull();
  });
  it("rejects malformed and wrong codes", () => {
    expect(verifyTotp(rfc, "12345", { timeMs: t })).toBeNull();
    expect(verifyTotp(rfc, "abcdef", { timeMs: t })).toBeNull();
    expect(verifyTotp(rfc, code === "000000" ? "000001" : "000000", { timeMs: t })).toBeNull();
    expect(verifyTotp(rfc, `${code.slice(0, 3)} ${code.slice(3)}`, { timeMs: t })).not.toBeNull(); // spaces allowed
  });
});

describe("helpers", () => {
  it("round-trips base32 and decodes the RFC example", () => {
    const s = generateTotpSecret();
    expect(s).toHaveLength(20);
    expect(base32Decode(base32Encode(s)).equals(s)).toBe(true);
    expect(base32Encode(rfc)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t")).toBeTruthy();
    expect(() => base32Decode("not valid!")).toThrow();
  });
  it("builds an otpauth URI", () => {
    const u = new URL(otpauthUri({ secret: rfc, account: "a@b.co", issuer: "SecretVariable" }));
    expect(u.protocol).toBe("otpauth:");
    expect(u.searchParams.get("secret")).toBe(base32Encode(rfc));
    expect(u.searchParams.get("issuer")).toBe("SecretVariable");
    expect(decodeURIComponent(u.pathname)).toContain("a@b.co");
  });
  it("generates unique recovery codes and numeric codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c))).toBe(true);
    expect(normalizeRecoveryCode("ABC12-De3F4 ")).toBe("abc12de3f4");
    expect(generateNumericCode()).toMatch(/^\d{6}$/);
  });
  it("masks emails", () => { expect(maskEmail("jonas@example.com")).toBe("j***@example.com"); });
});
