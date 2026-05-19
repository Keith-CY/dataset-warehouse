import { describe, expect, test } from "bun:test";
import { validateDatasetManifest } from "../src/manifest/validator";

const validManifest = {
  dataset_name: "pretrain-mix-v1",
  created_at: "2026-05-19T10:00:00Z",
  format: "parquet",
  schema_version: "pretrain-text-v1",
  tokenizer: "qwen-tokenizer-v2",
  sample_count: 3,
  token_count: 30,
  sources: ["common-crawl", "books"],
  license_summary: "mixed-reviewed",
  pipeline: {
    name: "dedup-v3",
    git_commit: "8f3a2c1",
  },
  shards: [
    {
      path: "shards/shard-00000.parquet",
      bytes: 10,
      samples: 1,
      tokens: 10,
      sha256: "a".repeat(64),
    },
    {
      path: "shards/shard-00001.parquet",
      bytes: 20,
      samples: 2,
      tokens: 20,
      sha256: "b".repeat(64),
    },
  ],
};

describe("dataset manifest validation", () => {
  test("accepts a manifest whose declared shards exist and match metadata", () => {
    const result = validateDatasetManifest(validManifest, {
      datasetRoot: "pretrain/mix/v1",
      objects: new Map([
        [
          "pretrain/mix/v1/shards/shard-00000.parquet",
          { bytes: 10, sha256: "a".repeat(64) },
        ],
        [
          "pretrain/mix/v1/shards/shard-00001.parquet",
          { bytes: 20, sha256: "b".repeat(64) },
        ],
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.datasetName).toBe("pretrain-mix-v1");
  });

  test("rejects path traversal, duplicate shards, missing objects, and mismatches", () => {
    const result = validateDatasetManifest(
      {
        ...validManifest,
        sample_count: 999,
        shards: [
          validManifest.shards[0],
          {
            ...validManifest.shards[0],
            path: "../escape.parquet",
            sha256: "c".repeat(64),
          },
          {
            ...validManifest.shards[1],
            bytes: 21,
          },
        ],
      },
      {
        datasetRoot: "pretrain/mix/v1",
        objects: new Map([
          [
            "pretrain/mix/v1/shards/shard-00000.parquet",
            { bytes: 10, sha256: "wrong" },
          ],
          [
            "pretrain/mix/v1/shards/shard-00001.parquet",
            { bytes: 20, sha256: "b".repeat(64) },
          ],
        ]),
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("sample_count must equal the sum of shard samples");
    expect(result.errors).toContain("shards[1].path must stay inside the dataset directory");
    expect(result.errors).not.toContain("shards[1] object is missing");
    expect(result.errors).toContain("shards[0].sha256 does not match object metadata");
    expect(result.errors).toContain("shards[2].bytes does not match object metadata");
  });

  test("does not check object metadata for unsafe shard paths", () => {
    const result = validateDatasetManifest(
      {
        ...validManifest,
        sample_count: 1,
        token_count: 10,
        shards: [
          {
            ...validManifest.shards[0],
            path: "../escape.parquet",
          },
        ],
      },
      {
        datasetRoot: "pretrain/mix/v1",
        objects: new Map(),
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("shards[0].path must stay inside the dataset directory");
    expect(result.errors).not.toContain("shards[0] object is missing");
  });

  test("requires strict ISO 8601 timestamps", () => {
    const result = validateDatasetManifest(
      {
        ...validManifest,
        created_at: "2026",
      },
      {
        datasetRoot: "pretrain/mix/v1",
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("created_at must be an ISO 8601 UTC timestamp");
  });
});
