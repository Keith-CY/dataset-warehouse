export interface LakeFSObject {
  path: string;
  bytes: number;
  modifiedAt?: string;
  checksum?: string;
}

export interface LakeFSListObjectsInput {
  repo: string;
  ref: string;
  prefix?: string;
}

export interface LakeFSStatObjectInput {
  repo: string;
  ref: string;
  path: string;
}

export interface LakeFSCreateBranchInput {
  repo: string;
  name: string;
  sourceRef: string;
}

export interface LakeFSPresignInput {
  repo: string;
  ref: string;
  path: string;
}

export interface LakeFSCommitInput {
  repo: string;
  branch: string;
  message: string;
  metadata?: Record<string, string>;
}

export interface LakeFSMergeInput {
  repo: string;
  source: string;
  target: string;
  message?: string;
}

export interface LakeFSCreateTagInput {
  repo: string;
  name: string;
  ref: string;
}

export interface LakeFSClient {
  listObjects(input: LakeFSListObjectsInput): Promise<LakeFSObject[]>;
  statObject(input: LakeFSStatObjectInput): Promise<LakeFSObject | undefined>;
  createBranch(input: LakeFSCreateBranchInput): Promise<{ repo: string; branch: string; sourceRef: string }>;
  presignUpload(input: LakeFSPresignInput): Promise<{ url: string; expiresIn: number }>;
  presignDownload(input: LakeFSPresignInput): Promise<{ url: string; expiresIn: number }>;
  commitBranch(input: LakeFSCommitInput): Promise<{ commitId: string }>;
  mergeBranches(input: LakeFSMergeInput): Promise<{ commitId: string }>;
  createTag(input: LakeFSCreateTagInput): Promise<{ repo: string; tag: string; commitId: string }>;
  listDatasetVersions(datasetId: string): Promise<Array<{ ref: string; commitId: string }>>;
}
