# Dataset Usage

This document shows the intended dataset workflows: query, pull, upload,
validate, commit, merge, and release.

The examples use:

```bash
BASE=http://127.0.0.1:3080
REPO=llm-datasets
ROLE_HEADER='x-dataset-role: data-engineer'
```

## Authentication And Roles

The current local API uses `x-dataset-role` as a development-only role stub. It
is not production authentication. It exists so local tests and examples can
exercise authorization rules before a real identity provider is wired in.

Local development examples:

```bash
curl -sS -H 'x-dataset-role: viewer' "$BASE/api/..."
curl -sS -H 'x-dataset-role: data-engineer' "$BASE/api/..."
curl -sS -H 'x-dataset-role: dataset-admin' "$BASE/api/..."
```

Role meanings:

| Role | Intended use |
| --- | --- |
| `viewer` | Read object listings and dataset metadata. |
| `trainer` | Read committed datasets and request download URLs. |
| `data-engineer` | Write `dev`, `staging`, and `exp/*` branches. |
| `ci-pipeline` | Write `pipeline/*` branches and promote pipeline output to `staging`. |
| `dataset-admin` | Create release tags and perform protected operations such as merges to `main`. |

Production deployments must replace `x-dataset-role` with real authentication
and authorization:

- Users authenticate with SSO/OIDC, an internal auth proxy, or another identity provider.
- Pipelines and training jobs use service accounts, not human user tokens.
- The API derives dataset roles from trusted identity claims, groups, or policy data.
- lakeFS access keys and object-store credentials are stored as secrets and are not sent to browsers.
- Presigned upload/download URLs must be short-lived and scoped to one object path and ref.
- Object-store buckets remain private; users write through lakeFS/Dataset API workflows only.

Example production request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $DATASET_API_TOKEN" \
  "$BASE/api/repos/$REPO/refs/7f23a9d4c0/objects?prefix=pretrain/mix/v1/"
```

The bearer-token form above is the intended production client shape. The current
MVP code still expects `x-dataset-role` until the real auth middleware is added.

## Direct lakeFS REST API

For single-user operations, administration, smoke tests, or scripts that bypass
the Dataset API intentionally, call the lakeFS REST API directly. lakeFS API
Server authentication uses HTTP Basic Auth with the lakeFS access key ID as the
username and the secret access key as the password:

```text
Authorization: Basic base64(access_key_id:secret_access_key)
```

With `curl`, use `-u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY"`.

Load credentials from a secret file or environment variables:

```bash
. /data/credentials/dataset-warehouse.env

LAKEFS_API="http://lakefs.example.internal:8000/api/v1"
REPO=llm-datasets
```

The credential file should define:

```bash
LAKEFS_ACCESS_KEY_ID=...
LAKEFS_SECRET_ACCESS_KEY=...
```

List repositories:

```bash
curl -sS -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  "$LAKEFS_API/repositories"
```

List objects under a ref and prefix:

```bash
curl -sS -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  "$LAKEFS_API/repositories/$REPO/refs/main/objects/ls?prefix=probes/"
```

Upload an object to a branch:

```bash
printf 'hello dataset warehouse\n' > example.txt

curl -sS -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  -X POST \
  "$LAKEFS_API/repositories/$REPO/branches/main/objects?path=probes/example.txt" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @example.txt
```

Commit staged changes:

```bash
curl -sS -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  -X POST \
  "$LAKEFS_API/repositories/$REPO/branches/main/commits" \
  -H "Content-Type: application/json" \
  -d '{"message":"upload example.txt"}'
```

Read object content:

```bash
curl -sS -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  "$LAKEFS_API/repositories/$REPO/refs/main/objects?path=probes/example.txt" \
  -o example.txt
```

For paths or prefixes with spaces, `#`, `?`, non-ASCII characters, or other
reserved URL characters, let `curl` encode the query value:

```bash
curl -sS -G -u "$LAKEFS_ACCESS_KEY_ID:$LAKEFS_SECRET_ACCESS_KEY" \
  "$LAKEFS_API/repositories/$REPO/refs/main/objects" \
  --data-urlencode "path=probes/example with space.txt"
```

Branch, tag, and ref names used inside URL path segments also need URL encoding
when they contain `/` or other reserved characters. For example,
`exp/alice/upload-20260519` should be sent as
`exp%2Falice%2Fupload-20260519` in a direct lakeFS REST path.

Direct writes to `main` are acceptable for a single-user smoke test only. In
production, write to `exp/*` or `pipeline/*`, validate the manifest, commit the
branch, and promote through the normal merge gate to `staging` and `main`.
Never expose lakeFS access keys in browser code or frontend configuration.

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
