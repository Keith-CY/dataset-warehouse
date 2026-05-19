export type StorageBackendType =
  | "minio"
  | "aistor"
  | "aws_s3"
  | "ceph_rgw"
  | "r2"
  | "other_s3";

export interface StorageBackendCapabilities {
  multipartUpload: boolean;
  presignedUrl: boolean;
  versioning: boolean;
  objectLock: boolean;
  lifecycle: boolean;
  replication: boolean;
  metrics: boolean;
}

export interface StorageBackendProfileInput {
  type: StorageBackendType;
  endpoint: string;
  region: string;
  bucket: string;
  namespacePrefix?: string;
  pathStyle: boolean;
  tls: boolean;
  credentialsRef: string;
  capabilities?: Partial<StorageBackendCapabilities>;
}

export interface StorageBackendProfile {
  id: string;
  type: StorageBackendType;
  endpoint: string;
  region: string;
  bucket: string;
  namespacePrefix: string;
  pathStyle: boolean;
  tls: boolean;
  credentialsRef: string;
  capabilities: StorageBackendCapabilities;
}

export interface RepositoryStorageBinding {
  repo: string;
  backend: string;
  storageNamespace: string;
  immutableAfterCreate: true;
  createdAt: string;
}

const DEFAULT_CAPABILITIES: StorageBackendCapabilities = {
  multipartUpload: false,
  presignedUrl: false,
  versioning: false,
  objectLock: false,
  lifecycle: false,
  replication: false,
  metrics: false,
};

export function normalizeStorageBackendProfile(
  id: string,
  input: StorageBackendProfileInput,
): StorageBackendProfile {
  assertSimpleIdentifier(id, "backend id");
  assertBucketName(input.bucket);

  return {
    id,
    type: input.type,
    endpoint: trimTrailingSlashes(input.endpoint),
    region: nonEmpty(input.region, "region"),
    bucket: input.bucket,
    namespacePrefix: normalizePrefix(input.namespacePrefix ?? ""),
    pathStyle: input.pathStyle,
    tls: input.tls,
    credentialsRef: nonEmpty(input.credentialsRef, "credentials_ref"),
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      ...input.capabilities,
    },
  };
}

export function storageNamespaceForRepo(
  profile: StorageBackendProfile,
  repo: string,
): string {
  assertSimpleIdentifier(repo, "repo");
  const key = [profile.namespacePrefix, repo].filter(Boolean).join("/");
  return `s3://${profile.bucket}/${key}`;
}

export function createRepositoryStorageBinding(
  profile: StorageBackendProfile,
  repo: string,
  now: Date = new Date(),
): RepositoryStorageBinding {
  return {
    repo,
    backend: profile.id,
    storageNamespace: storageNamespaceForRepo(profile, repo),
    immutableAfterCreate: true,
    createdAt: now.toISOString(),
  };
}

function assertSimpleIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a simple identifier`);
  }
}

function assertBucketName(value: string): void {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)) {
    throw new Error("bucket must be an S3-compatible bucket name");
  }
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return "";
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !segment)) {
    throw new Error("namespace_prefix must stay inside the backend bucket");
  }
  return normalized;
}

function trimTrailingSlashes(value: string): string {
  return nonEmpty(value, "endpoint").replace(/\/+$/g, "");
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}
