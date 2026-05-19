import { describe, expect, test } from "bun:test";
import { resolveServerPort } from "../src/config/server";

describe("server config", () => {
  test("prefers explicit CLI port over environment defaults", () => {
    expect(
      resolveServerPort(["bun", "src/main.ts", "--port=3020"], {
        DATASET_API_PORT: "3010",
      }),
    ).toBe(3020);
  });

  test("falls back to DATASET_API_PORT and then Bun's runtime default", () => {
    expect(resolveServerPort(["bun", "src/main.ts"], { DATASET_API_PORT: "3010" })).toBe(3010);
    expect(resolveServerPort(["bun", "src/main.ts"], {})).toBeUndefined();
  });
});
