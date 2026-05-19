export interface TrainingDatasetReferenceInput {
  repo: string;
  ref: string;
  resolvedCommitId?: string;
  path: string;
  manifest: string;
  manifestSha256: string;
}

export interface TrainingDatasetReference {
  repo: string;
  ref: string;
  commitId: string;
  path: string;
  manifest: string;
  manifestSha256: string;
}

const MUTABLE_BRANCHES = new Set(["main", "dev", "staging"]);

export function normalizeTrainingDatasetReference(
  input: TrainingDatasetReferenceInput,
): TrainingDatasetReference {
  const repo = requireIdentifier(input.repo, "repo");
  const ref = requireRef(input.ref);
  const path = normalizeObjectPrefix(input.path, "path");
  const manifest = normalizeObjectPath(input.manifest, "manifest");
  const manifestSha256 = requireSha256(input.manifestSha256, "manifest_sha256");

  if (isMutableBranch(ref)) {
    throw new Error("training dataset ref must not be a mutable branch");
  }

  const commitId = isCommitId(ref)
    ? ref
    : requireCommitId(input.resolvedCommitId, "resolved_commit_id");

  return {
    repo,
    ref,
    commitId,
    path,
    manifest,
    manifestSha256,
  };
}

function isMutableBranch(ref: string): boolean {
  return (
    MUTABLE_BRANCHES.has(ref) ||
    ref.startsWith("exp/") ||
    ref.startsWith("pipeline/")
  );
}

function isCommitId(ref: string): boolean {
  return /^[a-fA-F0-9]{8,64}$/.test(ref) || /^commit-[A-Za-z0-9._-]+$/.test(ref);
}

function requireCommitId(value: string | undefined, label: string): string {
  if (!value || !isCommitId(value)) {
    throw new Error(`${label} is required when ref is a release tag`);
  }
  return value;
}

function requireIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a simple identifier`);
  }
  return value;
}

function requireRef(value: string): string {
  if (!value || value.includes("..") || value.startsWith("/") || value.endsWith("/")) {
    throw new Error("ref is invalid");
  }
  return value;
}

function normalizeObjectPrefix(value: string, label: string): string {
  return normalizeObjectPath(value, label).replace(/\/+$/g, "");
}

function normalizeObjectPath(value: string, label: string): string {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} must stay inside the dataset repository`);
  }
  return normalized;
}

function requireSha256(value: string, label: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a sha256 hex digest`);
  }
  return value.toLowerCase();
}
