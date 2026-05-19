import { describe, expect, test } from "bun:test";
import { createDatasetApi } from "../src/api/server";
import { createDatasetService } from "../src/datasets/service";
import { createMemoryLakeFSClient } from "../src/lakefs/memory";

const lakefs = createMemoryLakeFSClient({
  objects: [
    {
      repo: "llm-datasets",
      ref: "main",
      path: "pretrain/mix/v1/manifest.json",
      bytes: 128,
    },
    {
      repo: "llm-datasets",
      ref: "pipeline/job-123",
      path: "pretrain/mix/v2/manifest.json",
      bytes: 256,
    },
  ],
});

const service = createDatasetService({ lakefs });
const api = createDatasetApi({ service });

async function request(path: string, init: RequestInit = {}) {
  return api.fetch(new Request(`http://dataset.local${path}`, init));
}

describe("dataset api", () => {
  test("lists objects through lakeFS without exposing backend details", async () => {
    const response = await request(
      "/api/repos/llm-datasets/refs/main/objects?prefix=pretrain/mix/v1/",
      { headers: { "x-dataset-role": "viewer" } },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      repo: "llm-datasets",
      ref: "main",
      prefix: "pretrain/mix/v1/",
      objects: [
        {
          path: "pretrain/mix/v1/manifest.json",
          size: 128,
        },
      ],
    });
  });

  test("supports slash-delimited refs in object listing routes", async () => {
    const response = await request(
      "/api/repos/llm-datasets/refs/pipeline/job-123/objects?prefix=pretrain/mix/v2/",
      { headers: { "x-dataset-role": "viewer" } },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ref).toBe("pipeline/job-123");
    expect(body.objects).toEqual([
      {
        path: "pretrain/mix/v2/manifest.json",
        size: 256,
      },
    ]);
  });

  test("rejects trainer writes and direct commits to main", async () => {
    const upload = await request(
      "/api/repos/llm-datasets/branches/exp/alice/filter/presign-upload",
      {
        method: "POST",
        headers: { "x-dataset-role": "trainer" },
        body: JSON.stringify({ path: "pretrain/raw/shard.parquet" }),
      },
    );

    expect(upload.status).toBe(403);

    const commitMain = await request(
      "/api/repos/llm-datasets/branches/main/commit",
      {
        method: "POST",
        headers: { "x-dataset-role": "data-engineer" },
        body: JSON.stringify({ message: "direct main write" }),
      },
    );

    expect(commitMain.status).toBe(403);
  });

  test("creates branches, commits, merges, and release tags through service layer", async () => {
    const branch = await request("/api/repos/llm-datasets/branches", {
      method: "POST",
      headers: { "x-dataset-role": "data-engineer" },
      body: JSON.stringify({
        name: "pipeline/job-123",
        source_ref: "main",
      }),
    });
    expect(branch.status).toBe(201);

    const commit = await request(
      "/api/repos/llm-datasets/branches/pipeline/job-123/commit",
      {
        method: "POST",
        headers: { "x-dataset-role": "ci-pipeline" },
        body: JSON.stringify({
          message: "validated pipeline output",
          metadata: { pipeline: "dedup-v3" },
        }),
      },
    );
    expect(commit.status).toBe(201);
    const commitBody = await commit.json();
    expect(commitBody.commit_id).toStartWith("commit-");

    const merge = await request(
      "/api/repos/llm-datasets/branches/pipeline/job-123/merge/staging",
      {
        method: "POST",
        headers: { "x-dataset-role": "ci-pipeline" },
        body: JSON.stringify({ message: "promote pipeline output" }),
      },
    );
    expect(merge.status).toBe(200);

    const tag = await request("/api/repos/llm-datasets/tags", {
      method: "POST",
      headers: { "x-dataset-role": "dataset-admin" },
      body: JSON.stringify({
        name: "pretrain-v1.3",
        ref: commitBody.commit_id,
      }),
    });
    expect(tag.status).toBe(201);
    const tagBody = await tag.json();
    expect(tagBody).toMatchObject({
      repo: "llm-datasets",
      tag: "pretrain-v1.3",
      commit_id: commitBody.commit_id,
    });
  });

  test("routes merges when the source branch name contains a merge segment", async () => {
    const merge = await request(
      "/api/repos/llm-datasets/branches/feature/merge/v1/merge/staging",
      {
        method: "POST",
        headers: { "x-dataset-role": "data-engineer" },
        body: JSON.stringify({ message: "promote branch with merge segment" }),
      },
    );

    expect(merge.status).toBe(200);
    const body = await merge.json();
    expect(body).toMatchObject({
      repo: "llm-datasets",
      source: "feature/merge/v1",
      target: "staging",
    });
  });
});
