# Dataset Usage

This document shows the intended dataset workflows: query, pull, upload,
validate, commit, merge, and release.

The examples use:

```bash
BASE=http://127.0.0.1:3080
REPO=llm-datasets
ROLE_HEADER='x-dataset-role: data-engineer'
```

Use `viewer` or `trainer` for read-only calls, `data-engineer` for development
branches, `ci-pipeline` for pipeline branches, and `dataset-admin` for protected
operations such as release tags or merges to `main`.

## Query Dataset Objects

List objects under a ref and prefix:

```bash
curl -sS -H 'x-dataset-role: viewer' \
  "$BASE/api/repos/$REPO/refs/main/objects?prefix=pretrain/mix/v1/"
```

Production training should not use `main` directly. Query by commit ID or a
release tag resolved to a commit ID when possible:

```bash
curl -sS -H 'x-dataset-role: viewer' \
  "$BASE/api/repos/$REPO/refs/7f23a9d4c0/objects?prefix=pretrain/mix/v1/"
```

## Pull A Dataset

Use the API to request a download URL for a specific object:

```bash
curl -sS -H 'x-dataset-role: trainer' \
  "$BASE/api/repos/$REPO/refs/7f23a9d4c0/presign-download?path=pretrain/mix/v1/manifest.json"
```

The response shape is:

```json
{
  "url": "https://...",
  "expires_in": 3600
}
```

Download with the returned URL:

```bash
curl -L "$URL" -o manifest.json
```

For large training jobs, prefer direct lakeFS S3 Gateway or direct object-store
read paths instead of routing data through the Dataset API. The training config
must record:

```yaml
dataset:
  repo: llm-datasets
  ref: "7f23a9d4c0"
  path: "pretrain/mix/v1/"
  manifest: "pretrain/mix/v1/manifest.json"
  manifest_sha256: "..."
```

Do not train from mutable refs such as `main`, `dev`, `staging`, `exp/*`, or
`pipeline/*`.

## Upload A Dataset

Create a branch for the upload:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data '{"name":"exp/alice/pretrain-v1","source_ref":"main"}' \
  "$BASE/api/repos/$REPO/branches"
```

Request a presigned upload URL for each object:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data '{"path":"pretrain/mix/v1/shards/shard-00000.parquet"}' \
  "$BASE/api/repos/$REPO/branches/exp/alice/pretrain-v1/presign-upload"
```

Upload the file with the returned URL:

```bash
curl -X PUT --upload-file shard-00000.parquet "$URL"
```

Upload `manifest.json` after all shards are present:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data '{"path":"pretrain/mix/v1/manifest.json"}' \
  "$BASE/api/repos/$REPO/branches/exp/alice/pretrain-v1/presign-upload"
```

## Manifest Contract

Each trainable dataset directory must include `manifest.json`:

```json
{
  "dataset_name": "pretrain-mix-v1",
  "created_at": "2026-05-19T10:00:00Z",
  "format": "parquet",
  "schema_version": "pretrain-text-v1",
  "tokenizer": "qwen-tokenizer-v2",
  "sample_count": 1000000,
  "token_count": 4700000000,
  "sources": ["common-crawl"],
  "license_summary": "reviewed",
  "pipeline": {
    "name": "dedup-v3",
    "git_commit": "8f3a2c1"
  },
  "shards": [
    {
      "path": "shards/shard-00000.parquet",
      "bytes": 134217728,
      "samples": 1000000,
      "tokens": 4700000000,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

Rules enforced by validation:

- `created_at` must be a strict UTC ISO 8601 timestamp.
- shard paths must be relative and stay inside the dataset directory.
- shard paths must be unique.
- declared sample and token counts must match shard totals.
- declared bytes and sha256 must match object metadata when available.
- validation stats only manifest-declared shards, not the whole prefix.

## Validate, Commit, Merge, Release

Validate the manifest before committing:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data @validate-manifest-request.json \
  "$BASE/api/repos/$REPO/branches/exp/alice/pretrain-v1/validate-manifest"
```

`validate-manifest-request.json`:

```json
{
  "dataset_path": "pretrain/mix/v1",
  "manifest": {
    "dataset_name": "pretrain-mix-v1",
    "created_at": "2026-05-19T10:00:00Z",
    "format": "parquet",
    "schema_version": "pretrain-text-v1",
    "tokenizer": "qwen-tokenizer-v2",
    "sample_count": 1000000,
    "token_count": 4700000000,
    "sources": ["common-crawl"],
    "license_summary": "reviewed",
    "pipeline": {
      "name": "dedup-v3",
      "git_commit": "8f3a2c1"
    },
    "shards": [
      {
        "path": "shards/shard-00000.parquet",
        "bytes": 134217728,
        "samples": 1000000,
        "tokens": 4700000000,
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]
  }
}
```

Commit the branch:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data '{"message":"add pretrain mix v1","metadata":{"pipeline":"dedup-v3","git_commit":"8f3a2c1"}}' \
  "$BASE/api/repos/$REPO/branches/exp/alice/pretrain-v1/commit"
```

Merge to staging:

```bash
curl -sS -X POST \
  -H "$ROLE_HEADER" \
  -H 'content-type: application/json' \
  --data '{"message":"promote pretrain mix v1"}' \
  "$BASE/api/repos/$REPO/branches/exp/alice/pretrain-v1/merge/staging"
```

Merge to `main` requires `dataset-admin`:

```bash
curl -sS -X POST \
  -H 'x-dataset-role: dataset-admin' \
  -H 'content-type: application/json' \
  --data '{"message":"release pretrain mix v1"}' \
  "$BASE/api/repos/$REPO/branches/staging/merge/main"
```

Create a release tag:

```bash
curl -sS -X POST \
  -H 'x-dataset-role: dataset-admin' \
  -H 'content-type: application/json' \
  --data '{"name":"pretrain-v1.0","ref":"7f23a9d4c0"}' \
  "$BASE/api/repos/$REPO/tags"
```

## Query Dataset Versions

List known versions for a dataset:

```bash
curl -sS -H 'x-dataset-role: viewer' \
  "$BASE/api/datasets/$REPO/versions"
```

The service returns release refs and commit IDs:

```json
{
  "dataset_id": "llm-datasets",
  "versions": [
    {
      "ref": "pretrain-v1.0",
      "commit_id": "7f23a9d4c0"
    }
  ]
}
```

## lakeFS Web UI

When lakeFS is running locally, open:

```text
http://127.0.0.1:8000/setup
```

After setup, use the lakeFS UI to browse repositories, branches, commits, tags,
and objects. The Dataset API remains the business workflow layer; lakeFS is the
versioned object-store control plane.
