import { validateDatasetManifest } from "../manifest/validator";
import type { LakeFSClient, LakeFSObject } from "../lakefs/types";

export type DatasetRole =
  | "dataset-admin"
  | "data-engineer"
  | "ci-pipeline"
  | "trainer"
  | "viewer";

export interface DatasetService {
  listObjects(input: {
    role: DatasetRole;
    repo: string;
    ref: string;
    prefix?: string;
  }): Promise<{ repo: string; ref: string; prefix: string; objects: Array<{ path: string; size: number; mtime?: string }> }>;
  createBranch(input: {
    role: DatasetRole;
    repo: string;
    name: string;
    sourceRef: string;
  }): Promise<{ repo: string; branch: string; source_ref: string }>;
  presignUpload(input: {
    role: DatasetRole;
    repo: string;
    branch: string;
    path: string;
  }): Promise<{ url: string; expires_in: number }>;
  presignDownload(input: {
    role: DatasetRole;
    repo: string;
    ref: string;
    path: string;
  }): Promise<{ url: string; expires_in: number }>;
  commitBranch(input: {
    role: DatasetRole;
    repo: string;
    branch: string;
    message: string;
    metadata?: Record<string, string>;
  }): Promise<{ repo: string; branch: string; commit_id: string }>;
  mergeBranches(input: {
    role: DatasetRole;
    repo: string;
    source: string;
    target: string;
    message?: string;
  }): Promise<{ repo: string; source: string; target: string; commit_id: string }>;
  createTag(input: {
    role: DatasetRole;
    repo: string;
    name: string;
    ref: string;
  }): Promise<{ repo: string; tag: string; commit_id: string }>;
  validateManifest(input: {
    role: DatasetRole;
    repo: string;
    branch: string;
    datasetPath: string;
    manifest: unknown;
  }): Promise<{ valid: boolean; errors: string[] }>;
  listDatasetVersions(input: {
    role: DatasetRole;
    datasetId: string;
  }): Promise<{ dataset_id: string; versions: Array<{ ref: string; commit_id: string }> }>;
}

export class DatasetAuthorizationError extends Error {
  readonly status = 403;
}

export function createDatasetService({ lakefs }: { lakefs: LakeFSClient }): DatasetService {
  return {
    async listObjects(input) {
      requireAnyRole(input.role, ["dataset-admin", "data-engineer", "ci-pipeline", "trainer", "viewer"]);
      const prefix = input.prefix ?? "";
      const objects = await lakefs.listObjects({
        repo: input.repo,
        ref: input.ref,
        prefix,
      });
      return {
        repo: input.repo,
        ref: input.ref,
        prefix,
        objects: objects.map(toApiObject),
      };
    },

    async createBranch(input) {
      requireAnyRole(input.role, ["dataset-admin", "data-engineer", "ci-pipeline"]);
      const result = await lakefs.createBranch({
        repo: input.repo,
        name: input.name,
        sourceRef: input.sourceRef,
      });
      return {
        repo: result.repo,
        branch: result.branch,
        source_ref: result.sourceRef,
      };
    },

    async presignUpload(input) {
      requireWritableBranch(input.role, input.branch);
      const result = await lakefs.presignUpload({
        repo: input.repo,
        ref: input.branch,
        path: input.path,
      });
      return {
        url: result.url,
        expires_in: result.expiresIn,
      };
    },

    async presignDownload(input) {
      requireAnyRole(input.role, ["dataset-admin", "data-engineer", "ci-pipeline", "trainer", "viewer"]);
      const result = await lakefs.presignDownload({
        repo: input.repo,
        ref: input.ref,
        path: input.path,
      });
      return {
        url: result.url,
        expires_in: result.expiresIn,
      };
    },

    async commitBranch(input) {
      requireWritableBranch(input.role, input.branch);
      if (!input.message.trim()) {
        throw new Error("commit message is required");
      }
      const result = await lakefs.commitBranch({
        repo: input.repo,
        branch: input.branch,
        message: input.message,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return {
        repo: input.repo,
        branch: input.branch,
        commit_id: result.commitId,
      };
    },

    async mergeBranches(input) {
      requireMergePermission(input.role, input.source, input.target);
      const result = await lakefs.mergeBranches({
        repo: input.repo,
        source: input.source,
        target: input.target,
        ...(input.message ? { message: input.message } : {}),
      });
      return {
        repo: input.repo,
        source: input.source,
        target: input.target,
        commit_id: result.commitId,
      };
    },

    async createTag(input) {
      requireAnyRole(input.role, ["dataset-admin"]);
      const result = await lakefs.createTag({
        repo: input.repo,
        name: input.name,
        ref: input.ref,
      });
      return {
        repo: result.repo,
        tag: result.tag,
        commit_id: result.commitId,
      };
    },

    async validateManifest(input) {
      requireWritableBranch(input.role, input.branch);
      const objects = await lakefs.listObjects({
        repo: input.repo,
        ref: input.branch,
        prefix: normalizePrefix(input.datasetPath),
      });
      const objectMap = new Map(
        objects.map((object) => [
          object.path,
          {
            bytes: object.bytes,
            ...(object.checksum ? { sha256: object.checksum } : {}),
          },
        ]),
      );
      const result = validateDatasetManifest(input.manifest, {
        datasetRoot: input.datasetPath,
        objects: objectMap,
      });
      return {
        valid: result.valid,
        errors: result.errors,
      };
    },

    async listDatasetVersions(input) {
      requireAnyRole(input.role, ["dataset-admin", "data-engineer", "ci-pipeline", "trainer", "viewer"]);
      const versions = await lakefs.listDatasetVersions(input.datasetId);
      return {
        dataset_id: input.datasetId,
        versions: versions.map((version) => ({
          ref: version.ref,
          commit_id: version.commitId,
        })),
      };
    },
  };
}

function toApiObject(object: LakeFSObject): { path: string; size: number; mtime?: string } {
  return {
    path: object.path,
    size: object.bytes,
    ...(object.modifiedAt ? { mtime: object.modifiedAt } : {}),
  };
}

function requireAnyRole(role: DatasetRole, allowed: DatasetRole[]): void {
  if (!allowed.includes(role)) {
    throw new DatasetAuthorizationError("role is not allowed to perform this action");
  }
}

function requireWritableBranch(role: DatasetRole, branch: string): void {
  if (role === "dataset-admin") {
    return;
  }
  if (role === "data-engineer" && /^(dev|staging|exp\/)/.test(branch)) {
    return;
  }
  if (role === "ci-pipeline" && branch.startsWith("pipeline/")) {
    return;
  }
  throw new DatasetAuthorizationError("role cannot write this branch");
}

function requireMergePermission(role: DatasetRole, source: string, target: string): void {
  if (role === "dataset-admin") {
    return;
  }
  if (target === "main") {
    throw new DatasetAuthorizationError("only dataset-admin can merge to main");
  }
  if (role === "ci-pipeline" && source.startsWith("pipeline/") && target === "staging") {
    return;
  }
  if (role === "data-engineer" && target === "staging") {
    return;
  }
  throw new DatasetAuthorizationError("role cannot perform this merge");
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}
