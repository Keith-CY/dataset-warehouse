import type {
  LakeFSClient,
  LakeFSObject,
  LakeFSCommitInput,
  LakeFSCreateBranchInput,
  LakeFSCreateTagInput,
  LakeFSMergeInput,
  LakeFSPresignInput,
} from "./types";

interface SeedObject extends LakeFSObject {
  repo: string;
  ref: string;
}

interface MemoryLakeFSOptions {
  objects?: SeedObject[];
}

export function createMemoryLakeFSClient(options: MemoryLakeFSOptions = {}): LakeFSClient {
  let nextCommit = 1;
  const objects = options.objects ?? [];
  const branches = new Map<string, string>();
  const tags = new Map<string, string>();

  return {
    async listObjects(input) {
      const prefix = input.prefix ?? "";
      return objects
        .filter(
          (object) =>
            object.repo === input.repo &&
            object.ref === input.ref &&
            object.path.startsWith(prefix),
        )
        .map(({ path, bytes, modifiedAt, checksum }) => ({
          path,
          bytes,
          ...(modifiedAt ? { modifiedAt } : {}),
          ...(checksum ? { checksum } : {}),
        }));
    },

    async createBranch(input: LakeFSCreateBranchInput) {
      branches.set(branchKey(input.repo, input.name), input.sourceRef);
      return { repo: input.repo, branch: input.name, sourceRef: input.sourceRef };
    },

    async presignUpload(input: LakeFSPresignInput) {
      return {
        url: `https://lakefs.local/upload/${input.repo}/${input.ref}/${encodeURIComponent(input.path)}`,
        expiresIn: 3600,
      };
    },

    async presignDownload(input: LakeFSPresignInput) {
      return {
        url: `https://lakefs.local/download/${input.repo}/${input.ref}/${encodeURIComponent(input.path)}`,
        expiresIn: 3600,
      };
    },

    async commitBranch(input: LakeFSCommitInput) {
      const commitId = `commit-${nextCommit++}`;
      branches.set(branchKey(input.repo, input.branch), commitId);
      return { commitId };
    },

    async mergeBranches(input: LakeFSMergeInput) {
      const sourceHead =
        branches.get(branchKey(input.repo, input.source)) ?? input.source;
      branches.set(branchKey(input.repo, input.target), sourceHead);
      return { commitId: sourceHead };
    },

    async createTag(input: LakeFSCreateTagInput) {
      tags.set(tagKey(input.repo, input.name), input.ref);
      return { repo: input.repo, tag: input.name, commitId: input.ref };
    },

    async listDatasetVersions(datasetId: string) {
      return [...tags.entries()]
        .filter(([key]) => key.startsWith(`${datasetId}:`))
        .map(([key, commitId]) => ({
          ref: key.slice(datasetId.length + 1),
          commitId,
        }));
    },
  };
}

function branchKey(repo: string, branch: string): string {
  return `${repo}:${branch}`;
}

function tagKey(repo: string, tag: string): string {
  return `${repo}:${tag}`;
}
