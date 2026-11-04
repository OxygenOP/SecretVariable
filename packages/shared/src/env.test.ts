import { describe, expect, it } from "vitest";
import { diffEnv, envEqual, parseEnv, serializeEnv } from "./env.js";

describe("parseEnv", () => {
  it("does not let an unclosed quote swallow the variables below it", () => {
    expect(parseEnv('A="abc\nB=2\nC=3\n')).toEqual({ A: '"abc', B: "2", C: "3" });
    expect(parseEnv("A='abc\nB=2\n")).toEqual({ A: "'abc", B: "2" });
    // a quote that does close later still spans lines
    expect(parseEnv('A="one\ntwo"\nB=2')).toEqual({ A: "one\ntwo", B: "2" });
  });
  it("copes with a byte-order mark, CRLF line endings and empty quoted values", () => {
    expect(parseEnv("\uFEFFA=1\r\nB=\"\"\r\nC=''")).toEqual({ A: "1", B: "", C: "" });
  });
  it("round-trips awkward values through serializeEnv", () => {
    const awkward = ["", " ", "a b", "#x", "a#b", "=", "\"", "'", "\\", "\\n", "line1\nline2", "tab\there", "$HOME", "é😀", "  lead", "trail  ", "a=b=c"];
    for (const v of awkward) expect(parseEnv(serializeEnv({ KEY: v })).KEY).toBe(v);
  });
  it("parses basics, comments, export and inline comments", () => {
    const m = parseEnv(`# c\nA=1\nexport B = two\nC=three # note\n\nD=#notcomment\n`);
    expect(m).toEqual({ A: "1", B: "two", C: "three", D: "#notcomment" });
  });
  it("handles quotes, escapes and multiline", () => {
    const m = parseEnv(`A="x y"\nB='lit\\n'\nC="l1\nl2"\nD="a\\nb \\"q\\""\nE=`);
    expect(m).toEqual({ A: "x y", B: "lit\\n", C: "l1\nl2", D: 'a\nb "q"', E: "" });
  });
  it("handles CRLF and later duplicates", () => {
    expect(parseEnv("A=1\r\nA=2\r\n")).toEqual({ A: "2" });
  });
  it("ignores malformed lines", () => {
    expect(parseEnv("not a pair\n1BAD=x\nOK=y")).toEqual({ OK: "y" });
  });
});

describe("serializeEnv", () => {
  it("round-trips awkward values", () => {
    const vars = { A: "plain", B: "with space", C: 'q"uote', D: "multi\nline", E: "", F: "back\\slash", G: "#hash", H: "a=b" };
    expect(parseEnv(serializeEnv(vars))).toEqual(vars);
  });
  it("sorts keys", () => {
    expect(serializeEnv({ B: "1", A: "2" })).toBe("A=2\nB=1\n");
  });
});

describe("diffEnv", () => {
  it("classifies keys", () => {
    const d = diffEnv({ A: "1", B: "2", C: "3" }, { A: "1", B: "9", D: "4" });
    expect(d).toEqual({ added: ["D"], removed: ["C"], changed: ["B"], unchanged: ["A"] });
    expect(envEqual({ A: "1" }, { A: "1" })).toBe(true);
    expect(envEqual({ A: "1" }, { A: "2" })).toBe(false);
  });
});
