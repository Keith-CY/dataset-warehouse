import { describe, expect, test } from "bun:test";
import { createDatasetService } from "../src/datasets/service";
import type { LakeFSClient, LakeFSObject } from "../src/lakefs/types";

const manifest = {
  dataset_name: "pretrain-mix-v1",
  created_at: "2026-05-19T10:00:00Z",
  format: "parquet",
  schema_version: "pretrain-text-v1",
  tokenizer: "qwen-tokenizer-v2",
  sample_count: 1,
  token_count: 10,
  sources: ["common-crawl"],
  license_summary: "reviewed",
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
  ],
};

describe("manifest validation service", () => {
  test("validates only manifest-declared shard objects instead of listing a whole prefix", async () => {
    const statCalls: string[] = [];
    const lakefs: LakeFSClient = {
      async listObjects() {
        throw new Error("validateManifest must not list the full dataset prefix");
      },
      async statObject(input): Promise<LakeFSObject | undefined> {
        statCalls.push(input.path);
        return {
          path: input.path,
          bytes: 10,
          checksum: "a".repeat(64),
        };
      },
      async createBranch() {
        throw new Error("not used");
      },
      async presignUpload() {
        throw new Error("not used");
      },
      async presignDownload() {
        throw new Error("not used");
      },
      async commitBranch() {
        throw new Error("not used");
      },
      async mergeBranches() {
        throw new Error("not used");
      },
      async createTag() {
        throw new Error("not used");
      },
      async listDatasetVersions() {
        throw new Error("not used");
      },
    };

    const service = createDatasetService({ lakefs });
    const result = await service.validateManifest({
      role: "data-engineer",
      repo: "llm-datasets",
      branch: "exp/alice/test",
      datasetPath: "pretrain/mix/v1",
      manifest,
    });

    expect(result).toEqual({ valid: true, errors: [] });
    expect(statCalls).toEqual(["pretrain/mix/v1/shards/shard-00000.parquet"]);
  });
});
