import { describe, expect, it } from "vitest";
import { relTime } from "./ui";

const now = new Date("2026-11-04T12:00:00Z").getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("relTime", () => {
  it("formats recent and older times", () => {
    expect(relTime(ago(10_000), now)).toBe("just now");
    expect(relTime(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(relTime(ago(3 * 3_600_000), now)).toBe("3 hours ago");
    expect(relTime(ago(2 * 86_400_000), now)).toBe("2 days ago");
    expect(relTime(new Date(now + 7 * 86_400_000).toISOString(), now)).toBe("in 7 days");
  });
  it("handles empty input and falls back to a date after a month", () => {
    expect(relTime(null)).toBe("");
    expect(relTime(ago(90 * 86_400_000), now)).toMatch(/2026|Aug/);
  });
});
