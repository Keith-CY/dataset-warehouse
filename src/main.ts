import { createDatasetApi } from "./api/server";
import { createDatasetService } from "./datasets/service";
import { createMemoryLakeFSClient } from "./lakefs/memory";

const port = Number(process.env.DATASET_API_PORT ?? "3000");

const lakefs = createMemoryLakeFSClient();
const service = createDatasetService({ lakefs });
const api = createDatasetApi({ service });

Bun.serve({
  port,
  fetch: (request) => api.fetch(request),
});

console.log(`Dataset API listening on http://localhost:${port}`);
