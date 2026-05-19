export interface ManifestShard {
  path: string;
  bytes: number;
  samples: number;
  tokens: number;
  sha256: string;
}

export interface DatasetManifest {
  datasetName: string;
  createdAt: string;
  format: string;
  schemaVersion: string;
  tokenizer: string;
  sampleCount: number;
  tokenCount: number;
  sources: string[];
  licenseSummary: string;
  pipeline: {
    name: string;
    gitCommit: string;
  };
  shards: ManifestShard[];
}

export interface ObjectMetadata {
  bytes: number;
  sha256?: string;
}

export interface ManifestValidationOptions {
  datasetRoot: string;
  objects?: Map<string, ObjectMetadata>;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: DatasetManifest;
}

export function validateDatasetManifest(
  rawManifest: unknown,
  options: ManifestValidationOptions,
): ManifestValidationResult {
  const errors: string[] = [];
  const manifest = normalizeManifest(rawManifest, errors);

  if (!manifest) {
    return { valid: false, errors };
  }

  const root = normalizeDatasetRoot(options.datasetRoot);
  const seenPaths = new Set<string>();
  const totalSamples = manifest.shards.reduce((sum, shard) => sum + shard.samples, 0);
  const totalTokens = manifest.shards.reduce((sum, shard) => sum + shard.tokens, 0);

  if (manifest.sampleCount !== totalSamples) {
    errors.push("sample_count must equal the sum of shard samples");
  }
  if (manifest.tokenCount !== totalTokens) {
    errors.push("token_count must equal the sum of shard tokens");
  }

  manifest.shards.forEach((shard, index) => {
    if (seenPaths.has(shard.path)) {
      errors.push(`shards[${index}].path must be unique`);
    }
    seenPaths.add(shard.path);

    const safePath = normalizeRelativePath(shard.path);
    if (!safePath) {
      errors.push(`shards[${index}].path must stay inside the dataset directory`);
      return;
    }

    if (options.objects) {
      const objectPath = joinObjectPath(root, safePath);
      const metadata = options.objects.get(objectPath);
      if (!metadata) {
        errors.push(`shards[${index}] object is missing`);
        return;
      }
      if (metadata.bytes !== shard.bytes) {
        errors.push(`shards[${index}].bytes does not match object metadata`);
      }
      if (metadata.sha256 && metadata.sha256 !== shard.sha256) {
        errors.push(`shards[${index}].sha256 does not match object metadata`);
      }
    }
  });

  const result: ManifestValidationResult = {
    valid: errors.length === 0,
    errors,
  };
  if (errors.length === 0) {
    result.manifest = manifest;
  }
  return result;
}

function normalizeManifest(raw: unknown, errors: string[]): DatasetManifest | undefined {
  if (!isRecord(raw)) {
    errors.push("manifest must be a JSON object");
    return undefined;
  }

  const shardsRaw = raw.shards;
  if (!Array.isArray(shardsRaw) || shardsRaw.length === 0) {
    errors.push("shards must be a non-empty array");
    return undefined;
  }

  const shards: ManifestShard[] = [];
  for (const [index, shardRaw] of shardsRaw.entries()) {
    if (!isRecord(shardRaw)) {
      errors.push(`shards[${index}] must be an object`);
      continue;
    }
    const shard = normalizeShard(shardRaw, index, errors);
    if (shard) {
      shards.push(shard);
    }
  }

  const pipelineRaw = raw.pipeline;
  if (!isRecord(pipelineRaw)) {
    errors.push("pipeline must be an object");
  }

  const manifest: DatasetManifest = {
    datasetName: requiredString(raw.dataset_name, "dataset_name", errors),
    createdAt: requiredIsoDate(raw.created_at, "created_at", errors),
    format: requiredString(raw.format, "format", errors),
    schemaVersion: requiredString(raw.schema_version, "schema_version", errors),
    tokenizer: requiredString(raw.tokenizer, "tokenizer", errors),
    sampleCount: requiredNonNegativeInteger(raw.sample_count, "sample_count", errors),
    tokenCount: requiredNonNegativeInteger(raw.token_count, "token_count", errors),
    sources: requiredStringArray(raw.sources, "sources", errors),
    licenseSummary: requiredString(raw.license_summary, "license_summary", errors),
    pipeline: {
      name: isRecord(pipelineRaw) ? requiredString(pipelineRaw.name, "pipeline.name", errors) : "",
      gitCommit: isRecord(pipelineRaw)
        ? requiredString(pipelineRaw.git_commit, "pipeline.git_commit", errors)
        : "",
    },
    shards,
  };

  return errors.length === 0 ? manifest : undefined;
}

function normalizeShard(
  raw: Record<string, unknown>,
  index: number,
  errors: string[],
): ManifestShard | undefined {
  const shard: ManifestShard = {
    path: requiredString(raw.path, `shards[${index}].path`, errors),
    bytes: requiredNonNegativeInteger(raw.bytes, `shards[${index}].bytes`, errors),
    samples: requiredNonNegativeInteger(raw.samples, `shards[${index}].samples`, errors),
    tokens: requiredNonNegativeInteger(raw.tokens, `shards[${index}].tokens`, errors),
    sha256: requiredSha256(raw.sha256, `shards[${index}].sha256`, errors),
  };

  return shard.path && shard.sha256 ? shard : undefined;
}

function normalizeDatasetRoot(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function normalizeRelativePath(path: string): string | undefined {
  if (path.startsWith("/")) {
    return undefined;
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return path;
}

function joinObjectPath(root: string, path: string): string {
  return [root, path].filter(Boolean).join("/");
}

function requiredString(value: unknown, label: string, errors: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} is required`);
    return "";
  }
  return value;
}

function requiredIsoDate(value: unknown, label: string, errors: string[]): string {
  const text = requiredString(value, label, errors);
  if (text && !isStrictUtcIsoTimestamp(text)) {
    errors.push(`${label} must be an ISO 8601 UTC timestamp`);
  }
  return text;
}

function isStrictUtcIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return new Date(timestamp).toISOString() === normalizeIsoFraction(value);
}

function normalizeIsoFraction(value: string): string {
  if (!value.includes(".")) {
    return value.replace("Z", ".000Z");
  }
  return value.replace(/\.(\d{1,9})Z$/, (_match, fraction: string) => {
    const milliseconds = fraction.padEnd(3, "0").slice(0, 3);
    return `.${milliseconds}Z`;
  });
}

function requiredNonNegativeInteger(value: unknown, label: string, errors: string[]): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    errors.push(`${label} must be a non-negative integer`);
    return 0;
  }
  return Number(value);
}

function requiredStringArray(value: unknown, label: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    errors.push(`${label} must be an array of non-empty strings`);
    return [];
  }
  return value;
}

function requiredSha256(value: unknown, label: string, errors: string[]): string {
  const text = requiredString(value, label, errors);
  if (text && !/^[a-fA-F0-9]{64}$/.test(text)) {
    errors.push(`${label} must be a sha256 hex digest`);
  }
  return text.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
