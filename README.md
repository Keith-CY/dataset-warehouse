# Dataset Warehouse

A Bun/TypeScript service skeleton for an LLM training dataset warehouse.

The design keeps lakeFS as the only dataset versioning layer and treats MinIO,
AIStor, Ceph RGW, AWS S3, R2, or another S3-compatible service as replaceable
object storage backends.

## What Is Implemented

- Storage backend profiles and immutable repository storage bindings.
- Dataset manifest validation for shard paths, totals, object metadata, and
  sha256 declarations.
- A thin Dataset API with branch, commit, merge, tag, list, presign, and
  manifest-validation routes.
- Role checks that prevent trainer writes and direct non-admin commits to
  `main`.
- Training dataset reference validation that rejects mutable branch refs and
  requires release tags to resolve to concrete commit IDs.
- An in-memory lakeFS client for tests and local API development.

## Local Commands

```bash
bun test
node ./node_modules/typescript/bin/tsc --noEmit
bun src/main.ts
```

The development server uses an in-memory lakeFS client. Production integration
should provide a real `LakeFSClient` implementation without changing Dataset API
or manifest logic.

## API Shape

```text
GET  /api/repos/{repo}/refs/{ref}/objects
POST /api/repos/{repo}/branches
POST /api/repos/{repo}/branches/{branch}/presign-upload
GET  /api/repos/{repo}/refs/{ref}/presign-download
POST /api/repos/{repo}/branches/{branch}/commit
POST /api/repos/{repo}/branches/{source}/merge/{target}
POST /api/repos/{repo}/tags
POST /api/repos/{repo}/branches/{branch}/validate-manifest
GET  /api/datasets/{dataset_id}/versions
```

Pass the role with `x-dataset-role`, for example `viewer`, `trainer`,
`data-engineer`, `ci-pipeline`, or `dataset-admin`.

## Storage Abstraction

See [config/storage-backends.example.yaml](config/storage-backends.example.yaml).

Business code should depend on `StorageBackendProfile` and
`RepositoryStorageBinding`, not on MinIO-specific buckets, users, or policies.
Repo storage namespaces are immutable after creation; backend migration is a
separate operational workflow.

## Architecture

See [docs/architecture.md](docs/architecture.md).
