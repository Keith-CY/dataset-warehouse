# Docker Deployment

This document describes how to run the Dataset Warehouse components with Docker.
It separates the current development stack from the production shape so the
deployment is explicit about what is real today.

## Components

The target service stack has four parts:

- Dataset API: the thin API layer in this repository.
- lakeFS: dataset version control and web UI.
- PostgreSQL: lakeFS metadata database.
- S3-compatible object storage: MinIO by default. AIStor, Ceph RGW,
  AWS S3, R2, or another compatible backend can replace it later through the
  storage backend abstraction.

The current repository implements the Dataset API skeleton and an in-memory
lakeFS client for local API testing. A production deployment must replace that
in-memory client with a real lakeFS client before the API is used for durable
dataset operations.

## Local lakeFS UI

Use this when you only need the lakeFS web UI for inspection and setup testing.
It runs lakeFS with PostgreSQL and a local container blockstore.

```bash
docker network create dataset-warehouse-lakefs

docker run -d \
  --name dataset-warehouse-lakefs-postgres \
  --network dataset-warehouse-lakefs \
  -e POSTGRES_USER=lakefs \
  -e POSTGRES_PASSWORD=lakefs \
  -e POSTGRES_DB=lakefs \
  postgres:16

docker run -d \
  --name dataset-warehouse-lakefs \
  --network dataset-warehouse-lakefs \
  -p 8000:8000 \
  -e LAKEFS_LISTEN_ADDRESS=0.0.0.0:8000 \
  -e LAKEFS_AUTH_ENCRYPT_SECRET_KEY=replace-with-long-random-secret \
  -e LAKEFS_DATABASE_TYPE=postgres \
  -e 'LAKEFS_DATABASE_POSTGRES_CONNECTION_STRING=postgres://lakefs:lakefs@dataset-warehouse-lakefs-postgres:5432/lakefs?sslmode=disable' \
  -e LAKEFS_BLOCKSTORE_TYPE=local \
  -e LAKEFS_BLOCKSTORE_LOCAL_PATH=/home/lakefs/data \
  treeverse/lakefs:latest run
```

Open:

```text
http://127.0.0.1:8000/setup
```

Use the setup page to create the first admin user and lakeFS access keys.

## Local Dataset API

The local Dataset API is useful for testing the HTTP routes and authorization
rules in this repository. It does not persist data because it uses the in-memory
lakeFS client.

```bash
bun --port 3080 src/main.ts
```

Then call:

```bash
curl -sS -H 'x-dataset-role: viewer' \
  'http://127.0.0.1:3080/api/repos/llm-datasets/refs/main/objects?prefix=pretrain/'
```

If Bun cannot bind a port in the local sandbox, run the test suite instead to
exercise the same API behavior:

```bash
bun test
```

## Production Docker Shape

For production Docker deployments, the default object store is MinIO. PostgreSQL
metadata and MinIO object data must be persisted with Docker named volumes.
Run the Dataset API and lakeFS as separate services; keep PostgreSQL and MinIO
as durable state services.

```text
dataset-api  -> lakeFS API / lakeFS S3 Gateway
lakeFS       -> PostgreSQL + MinIO
PostgreSQL   -> Docker volume: dataset-warehouse-postgres-data
MinIO        -> Docker volume: dataset-warehouse-minio-data
```

The production compose template is:

```text
deploy/docker-compose.production.yml
```

Create an environment file:

```bash
cp deploy/.env.example .env
```

Edit `.env` and replace all placeholder secrets. Then start the stack:

```bash
docker compose \
  --env-file .env \
  -f deploy/docker-compose.production.yml \
  -p dataset-warehouse \
  up -d
```

Open the service UIs:

```text
lakeFS UI:       http://127.0.0.1:8000/setup
MinIO Console:  http://127.0.0.1:9001/
MinIO S3 API:   http://127.0.0.1:9000/
```

The compose file creates the `lakefs-blockstore` bucket automatically through
the `minio-init` service. lakeFS is configured with:

```text
LAKEFS_BLOCKSTORE_TYPE=s3
LAKEFS_BLOCKSTORE_S3_ENDPOINT=http://minio:9000
LAKEFS_BLOCKSTORE_S3_FORCE_PATH_STYLE=true
```

Required production changes before go-live:

- Replace the in-memory `LakeFSClient` with a real lakeFS REST/S3 client.
- Replace the development-only `x-dataset-role` header with real API authentication and role mapping.
- Store lakeFS access keys and object-store credentials in a secret manager.
- Use persistent PostgreSQL storage with backups and restore drills.
- Use the MinIO Docker volume for object data, and back up that volume according
  to the dataset retention policy.
- Configure branch protection for `main` and release branches/tags.
- Run lakeFS garbage collection only with a retention policy tied to dataset reproducibility.

## Production Authentication

The local Dataset API examples use `x-dataset-role` only to exercise role checks.
Production deployments must not trust caller-supplied role headers.

Recommended production auth shape:

```text
Client / Pipeline / Training Job
        |
        | Authorization: Bearer <token>
        v
Dataset API auth middleware
        |
        | verify token, map groups/service account to dataset role
        v
Dataset API route handlers
        |
        | lakeFS service account credentials from secret manager
        v
lakeFS
```

Implementation requirements:

- Put the Dataset API behind TLS.
- Verify tokens from SSO/OIDC, an internal auth proxy, or a service-account issuer.
- Map trusted identity claims to `viewer`, `trainer`, `data-engineer`, `ci-pipeline`, or `dataset-admin`.
- Reject requests that include only `x-dataset-role` in production mode.
- Use separate service accounts for Dataset API, CI pipelines, and training jobs.
- Keep lakeFS credentials and object-store credentials server-side.
- Issue presigned URLs with short expirations and object-path scope.

## S3-Compatible Backend

The production default is MinIO, but the Dataset API should not depend on
MinIO-specific concepts. Configure backends through `StorageBackendProfile` and
bind repositories through immutable `RepositoryStorageBinding` records.

Example backend profile:

```yaml
storage_backends:
  primary:
    type: minio
    endpoint: http://minio:9000
    region: us-east-1
    bucket: lakefs-blockstore
    namespace_prefix: datasets
    path_style: true
    tls: true
    credentials_ref: secret://storage/primary
```

Example lakeFS repo binding:

```yaml
repo: llm-datasets
backend: primary
storage_namespace: s3://lakefs-blockstore/datasets/llm-datasets
immutable_after_create: true
```

Do not change `storage_namespace` in place after repo creation. Backend
migration must be a separate freeze-copy-verify-cutover process.

## Shutdown And Data Removal

For the production Docker stack:

```bash
docker compose \
  --env-file .env \
  -f deploy/docker-compose.production.yml \
  -p dataset-warehouse \
  down
```

This stops containers but preserves Docker volumes.

To delete local data after a verification run:

```bash
docker compose \
  --env-file .env \
  -f deploy/docker-compose.production.yml \
  -p dataset-warehouse \
  down -v
```

The volumes are explicitly named:

```text
dataset-warehouse-postgres-data
dataset-warehouse-minio-data
```

Removing those volumes deletes lakeFS metadata and stored dataset objects.
