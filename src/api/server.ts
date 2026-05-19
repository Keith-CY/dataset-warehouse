import type { DatasetRole, DatasetService } from "../datasets/service";
import { DatasetAuthorizationError } from "../datasets/service";

export interface DatasetApi {
  fetch(request: Request): Promise<Response>;
}

export function createDatasetApi({ service }: { service: DatasetService }): DatasetApi {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

        if (segments[0] !== "api") {
          return json({ error: "not found" }, 404);
        }

        if (segments[1] === "datasets") {
          return await handleDatasetRoute(service, request, segments);
        }

        if (segments[1] !== "repos") {
          return json({ error: "not found" }, 404);
        }

        const repo = requiredSegment(segments, 2, "repo");
        const role = roleFromRequest(request);

        if (request.method === "GET" && segments[3] === "refs" && segments.at(-1) === "objects") {
          const ref = branchFromSegments(segments, 4, segments.length - 1);
          return json(
            await service.listObjects({
              role,
              repo,
              ref,
              prefix: url.searchParams.get("prefix") ?? "",
            }),
          );
        }

        if (request.method === "GET" && segments[3] === "refs" && segments.at(-1) === "presign-download") {
          const ref = branchFromSegments(segments, 4, segments.length - 1);
          return json(
            await service.presignDownload({
              role,
              repo,
              ref,
              path: requiredQuery(url, "path"),
            }),
          );
        }

        if (request.method === "POST" && segments[3] === "branches" && segments.length === 4) {
          const body = await readJsonObject(request);
          return json(
            await service.createBranch({
              role,
              repo,
              name: requiredBodyString(body, "name"),
              sourceRef: requiredBodyString(body, "source_ref"),
            }),
            201,
          );
        }

        if (segments[3] === "branches") {
          return await handleBranchRoute(service, request, role, repo, segments);
        }

        if (request.method === "POST" && segments[3] === "tags" && segments.length === 4) {
          const body = await readJsonObject(request);
          return json(
            await service.createTag({
              role,
              repo,
              name: requiredBodyString(body, "name"),
              ref: requiredBodyString(body, "ref"),
            }),
            201,
          );
        }

        return json({ error: "not found" }, 404);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

function handleDatasetRoute(
  service: DatasetService,
  request: Request,
  segments: string[],
): Promise<Response> {
  if (request.method === "GET" && segments[3] === "versions" && segments.length === 4) {
    const datasetId = requiredSegment(segments, 2, "dataset_id");
    return service
      .listDatasetVersions({
        role: roleFromRequest(request),
        datasetId,
      })
      .then((body) => json(body));
  }
  return Promise.resolve(json({ error: "not found" }, 404));
}

async function handleBranchRoute(
  service: DatasetService,
  request: Request,
  role: DatasetRole,
  repo: string,
  segments: string[],
): Promise<Response> {
  const action = segments.at(-1);
  if (!action) {
    return json({ error: "not found" }, 404);
  }

  if (request.method === "POST" && action === "presign-upload") {
    const body = await readJsonObject(request);
    const branch = branchFromSegments(segments, 4, segments.length - 1);
    return json(
      await service.presignUpload({
        role,
        repo,
        branch,
        path: requiredBodyString(body, "path"),
      }),
    );
  }

  if (request.method === "POST" && action === "commit") {
    const body = await readJsonObject(request);
    const branch = branchFromSegments(segments, 4, segments.length - 1);
    return json(
      await service.commitBranch({
        role,
        repo,
        branch,
        message: requiredBodyString(body, "message"),
        ...optionalProperty(
          "metadata",
          optionalStringRecord(body.metadata, "metadata"),
        ),
      }),
      201,
    );
  }

  if (request.method === "POST" && action === "validate-manifest") {
    const body = await readJsonObject(request);
    const branch = branchFromSegments(segments, 4, segments.length - 1);
    return json(
      await service.validateManifest({
        role,
        repo,
        branch,
        datasetPath: requiredBodyString(body, "dataset_path"),
        manifest: body.manifest,
      }),
    );
  }

  const mergeIndex = segments.lastIndexOf("merge");
  if (request.method === "POST" && mergeIndex > 4) {
    const body = await readJsonObject(request);
    const source = branchFromSegments(segments, 4, mergeIndex);
    const target = branchFromSegments(segments, mergeIndex + 1, segments.length);
    return json(
      await service.mergeBranches({
        role,
        repo,
        source,
        target,
        ...optionalProperty("message", optionalBodyString(body, "message")),
      }),
    );
  }

  return json({ error: "not found" }, 404);
}

function roleFromRequest(request: Request): DatasetRole {
  const role = request.headers.get("x-dataset-role") ?? "viewer";
  if (
    role === "dataset-admin" ||
    role === "data-engineer" ||
    role === "ci-pipeline" ||
    role === "trainer" ||
    role === "viewer"
  ) {
    return role;
  }
  throw new DatasetAuthorizationError("unknown dataset role");
}

function branchFromSegments(segments: string[], start: number, end: number): string {
  const branch = segments.slice(start, end).join("/");
  if (!branch) {
    throw new Error("branch is required");
  }
  return branch;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) {
    return {};
  }
  const body = await request.json();
  if (!isRecord(body)) {
    throw new Error("request body must be a JSON object");
  }
  return body;
}

function requiredSegment(segments: string[], index: number, label: string): string {
  const value = segments[index];
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function requiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function optionalStringRecord(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    record[key] = item;
  }
  return record;
}

function optionalProperty<T, K extends string>(
  key: K,
  value: T | undefined,
): Record<K, T> | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as Record<K, T>;
}

function errorResponse(error: unknown): Response {
  if (error instanceof DatasetAuthorizationError) {
    return json({ error: error.message }, error.status);
  }
  if (error instanceof SyntaxError) {
    return json({ error: "invalid JSON request body" }, 400);
  }
  if (error instanceof Error) {
    return json({ error: error.message }, 400);
  }
  return json({ error: "unknown error" }, 500);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
