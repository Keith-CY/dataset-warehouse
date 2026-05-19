# Dataset Warehouse Architecture

## Summary

Dataset Warehouse manages LLM training datasets with reproducible versioning.
lakeFS owns dataset semantics: repositories, branches, commits, tags, merge, and
rollback. The object store owns durability and throughput. MinIO is only one
backend implementation; the service is built around S3-compatible backend
profiles so MinIO can be replaced.

## Components

```text
User / CLI / Web / Pipeline / Training Job
        |
        v
Dataset API
        |
        v
lakeFS
        |
        v
Object Store Backend
        |
        v
Disk / Cloud / Cluster
```

- `Dataset API`: authorization, dataset registry, manifest validation,
  presigned URL orchestration, commit/merge/tag workflows.
- `lakeFS`: Git-like dataset version control.
- `PostgreSQL`: lakeFS metadata. Treat it as a core state service.
- `Object Store Backend`: S3-compatible physical storage.
- `Training Jobs`: read commit-pinned datasets only.

## Storage Backend Abstraction

`StorageBackendProfile` contains the connection profile and capability flags for
one S3-compatible backend. Supported backend types are:

```text
minio | aistor | aws_s3 | ceph_rgw | r2 | other_s3
```

`RepositoryStorageBinding` records the immutable mapping from a lakeFS repo to a
backend namespace:

```text
repo: llm-datasets
backend: primary
storage_namespace: s3://lakefs-blockstore/datasets/llm-datasets
immutable_after_create: true
```

Changing the backend for a repo is a migration, not an in-place update.

## Manifest Contract

Each trainable dataset directory must include `manifest.json`. The manifest
tracks dataset semantics that lakeFS does not know:

- dataset name
- format and schema version
- tokenizer
- sample and token counts
- sources and license summary
- pipeline name and code commit
- shard paths, byte sizes, sample counts, token counts, and sha256 digests

Validation rejects missing shards, path traversal, duplicate shard paths,
sha256 mismatches, byte mismatches, and count mismatches.

## Training Read Contract

Production training must not use mutable refs such as `main`, `dev`, `staging`,
`exp/*`, or `pipeline/*`. A training run must record:

```text
repo
commit_id
dataset path
manifest path
manifest sha256
object backend profile id
code git commit
training config hash
```

Release tags are allowed only after resolving them to concrete commit IDs.

## API Boundaries

The Dataset API is intentionally thin. It does not proxy large objects and does
not expose MinIO-specific concepts. Large uploads and downloads should use
presigned lakeFS or S3-compatible URLs.

## Permissions

- `dataset-admin`: repo and backend binding administration, main merges, tags.
- `data-engineer`: write `dev`, `staging`, and `exp/*` branches.
- `ci-pipeline`: write `pipeline/*` and merge pipeline output to `staging`.
- `trainer`: read only.
- `viewer`: read metadata and object listings.

## Operations

Production deployments must cover:

- PostgreSQL backup, restore, and HA.
- Object store health, capacity, latency, multipart, and list checks.
- lakeFS GC dry runs before destructive GC.
- Retention policies tied to dataset reproducibility windows.
- Audit logs for upload, commit, merge, tag, and validation actions.

## Migration

Object store replacement follows this flow:

```text
1. Create the new backend profile.
2. Freeze writes for the target repo.
3. Copy the lakeFS namespace to the new backend.
4. Verify object counts, sizes, manifest sha256, and sampled reads.
5. Restore or bind the repo in staging.
6. Verify critical commits and tags.
7. Cut over production.
8. Keep the old backend read-only during an observation window.
```

Online unverified namespace swaps are not supported.
