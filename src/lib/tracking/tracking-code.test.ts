import { describe, expect, it } from "vitest";

import { olvaLookupNumber } from "./tracking-code";

describe("olvaLookupNumber", () => {
  it("drops the two-digit issue year", () => {
    expect(olvaLookupNumber("2875565-26")).toBe("2875565");
  });

  it("trims surrounding whitespace", () => {
    expect(olvaLookupNumber(" 2618673-26 ")).toBe("2618673");
  });

  it("leaves a code without a year suffix unchanged", () => {
    expect(olvaLookupNumber("2618673")).toBe("2618673");
  });

  it("only strips a trailing two-digit suffix", () => {
    expect(olvaLookupNumber("2618673-2026")).toBe("2618673-2026");
  });
});
