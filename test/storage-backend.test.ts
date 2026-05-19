import { describe, expect, test } from "bun:test";
import {
  createRepositoryStorageBinding,
  normalizeStorageBackendProfile,
  storageNamespaceForRepo,
} from "../src/storage/backend";

describe("storage backend profiles", () => {
  test("normalizes an S3-compatible backend without leaking vendor concepts", () => {
    const profile = normalizeStorageBackendProfile("primary", {
      type: "minio",
      endpoint: "https://object-store.internal/",
      region: "us-east-1",
      bucket: "lakefs-blockstore",
      namespacePrefix: "/datasets/",
      pathStyle: true,
      tls: true,
      credentialsRef: "secret://storage/primary",
      capabilities: {
        multipartUpload: true,
        presignedUrl: true,
        versioning: true,
        objectLock: false,
        lifecycle: true,
        replication: false,
        metrics: true,
      },
    });

    expect(profile.endpoint).toBe("https://object-store.internal");
    expect(profile.namespacePrefix).toBe("datasets");
    expect(profile.capabilities.presignedUrl).toBe(true);
    expect(profile.type).toBe("minio");
  });

  test("derives lakeFS storage namespaces from backend profile and repo name", () => {
    const profile = normalizeStorageBackendProfile("primary", {
      type: "ceph_rgw",
      endpoint: "https://rgw.internal",
      region: "us-east-1",
      bucket: "lakefs-blockstore",
      namespacePrefix: "datasets",
      pathStyle: true,
      tls: true,
      credentialsRef: "secret://storage/primary",
    });

    expect(storageNamespaceForRepo(profile, "llm-datasets")).toBe(
      "s3://lakefs-blockstore/datasets/llm-datasets",
    );
  });

  test("creates immutable repo bindings so backend swaps require migration", () => {
    const profile = normalizeStorageBackendProfile("primary", {
      type: "aws_s3",
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      bucket: "lakefs-blockstore",
      namespacePrefix: "datasets",
      pathStyle: false,
      tls: true,
      credentialsRef: "secret://storage/primary",
    });

    const binding = createRepositoryStorageBinding(profile, "llm-datasets");

    expect(binding).toMatchObject({
      repo: "llm-datasets",
      backend: "primary",
      storageNamespace: "s3://lakefs-blockstore/datasets/llm-datasets",
      immutableAfterCreate: true,
    });
  });

  test("rejects invalid names that could escape the storage namespace", () => {
    expect(() =>
      normalizeStorageBackendProfile("primary/minio", {
        type: "minio",
        endpoint: "https://object-store.internal",
        region: "us-east-1",
        bucket: "lakefs-blockstore",
        namespacePrefix: "datasets",
        pathStyle: true,
        tls: true,
        credentialsRef: "secret://storage/primary",
      }),
    ).toThrow("backend id");

    const profile = normalizeStorageBackendProfile("primary", {
      type: "minio",
      endpoint: "https://object-store.internal",
      region: "us-east-1",
      bucket: "lakefs-blockstore",
      namespacePrefix: "datasets",
      pathStyle: true,
      tls: true,
      credentialsRef: "secret://storage/primary",
    });

    expect(() => storageNamespaceForRepo(profile, "../llm-datasets")).toThrow(
      "repo",
    );
  });
});
