import { describe, expect, test } from "bun:test";
import { normalizeTrainingDatasetReference } from "../src/datasets/training-reference";

describe("training dataset references", () => {
  test("rejects mutable branch references for production training", () => {
    expect(() =>
      normalizeTrainingDatasetReference({
        repo: "llm-datasets",
        ref: "main",
        path: "pretrain/mix/v1/",
        manifest: "pretrain/mix/v1/manifest.json",
        manifestSha256: "a".repeat(64),
      }),
    ).toThrow("mutable branch");
  });

  test("accepts commit-pinned dataset references", () => {
    const reference = normalizeTrainingDatasetReference({
      repo: "llm-datasets",
      ref: "7f23a9d4c0",
      path: "pretrain/mix/v1/",
      manifest: "pretrain/mix/v1/manifest.json",
      manifestSha256: "a".repeat(64),
    });

    expect(reference).toMatchObject({
      repo: "llm-datasets",
      ref: "7f23a9d4c0",
      commitId: "7f23a9d4c0",
      path: "pretrain/mix/v1",
      manifest: "pretrain/mix/v1/manifest.json",
    });
  });

  test("accepts release tags only when resolved to a concrete commit id", () => {
    const reference = normalizeTrainingDatasetReference({
      repo: "llm-datasets",
      ref: "pretrain-v1.3",
      resolvedCommitId: "7f23a9d4c0",
      path: "pretrain/mix/v1/",
      manifest: "pretrain/mix/v1/manifest.json",
      manifestSha256: "a".repeat(64),
    });

    expect(reference.ref).toBe("pretrain-v1.3");
    expect(reference.commitId).toBe("7f23a9d4c0");

    expect(() =>
      normalizeTrainingDatasetReference({
        repo: "llm-datasets",
        ref: "pretrain-v1.3",
        path: "pretrain/mix/v1/",
        manifest: "pretrain/mix/v1/manifest.json",
        manifestSha256: "a".repeat(64),
      }),
    ).toThrow("resolved_commit_id");
  });
});
