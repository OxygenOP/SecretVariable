import { describe, expect, it } from "vitest";
import {
  decryptValue, encryptValue, generateKey, generateToken, hashToken,
  parseMasterKey, rewrapKey, unwrapKey, wrapKey,
} from "./index.js";

describe("master key", () => {
  it("parses hex and base64", () => {
    const k = generateKey();
    expect(parseMasterKey(k.toString("hex")).equals(k)).toBe(true);
    expect(parseMasterKey(k.toString("base64")).equals(k)).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(() => parseMasterKey("abcd")).toThrow(/32 bytes/);
  });
});

describe("values", () => {
  const key = generateKey();
  it("round-trips including unicode and empty values", () => {
    for (const v of ["", "hello", "p@ss=w0rd\n\"quoted\"", "héllo 🔐"]) {
      expect(decryptValue(key, encryptValue(key, v, "ctx"), "ctx")).toBe(v);
    }
  });
  it("uses a fresh nonce each time", () => {
    expect(encryptValue(key, "same", "c")).not.toBe(encryptValue(key, "same", "c"));
  });
  it("fails with the wrong key", () => {
    const sealed = encryptValue(key, "secret", "c");
    expect(() => decryptValue(generateKey(), sealed, "c")).toThrow(/Decryption failed/);
  });
  it("fails when moved to another context", () => {
    const sealed = encryptValue(key, "secret", "version1:KEY_A");
    expect(() => decryptValue(key, sealed, "version1:KEY_B")).toThrow(/Decryption failed/);
  });
  it("detects tampering", () => {
    const parts = encryptValue(key, "secret", "c").split(".");
    const ct = Buffer.from(parts[2]!, "base64");
    ct[0] = ct[0]! ^ 1;
    parts[2] = ct.toString("base64");
    expect(() => decryptValue(key, parts.join("."), "c")).toThrow(/Decryption failed/);
  });
  it("rejects unknown formats", () => {
    expect(() => decryptValue(key, "garbage", "c")).toThrow(/Unsupported/);
  });
});

describe("key wrapping", () => {
  const master = generateKey();
  it("wraps and unwraps", () => {
    const dek = generateKey();
    expect(unwrapKey(master, wrapKey(master, dek, "p1"), "p1").equals(dek)).toBe(true);
  });
  it("is bound to its context", () => {
    const wrapped = wrapKey(master, generateKey(), "p1");
    expect(() => unwrapKey(master, wrapped, "p2")).toThrow();
  });
  it("supports master key rotation", () => {
    const dek = generateKey();
    const next = generateKey();
    const rewrapped = rewrapKey(master, next, wrapKey(master, dek, "p1"), "p1");
    expect(unwrapKey(next, rewrapped, "p1").equals(dek)).toBe(true);
    expect(() => unwrapKey(master, rewrapped, "p1")).toThrow();
  });
});

describe("tokens", () => {
  it("generates unique prefixed tokens with stable hashes", () => {
    const a = generateToken("svs");
    expect(a.startsWith("svs_")).toBe(true);
    expect(a).not.toBe(generateToken("svs"));
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toHaveLength(64);
  });
});
