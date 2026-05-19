import { createDatasetApi } from "./api/server";
import { resolveServerPort } from "./config/server";
import { createDatasetService } from "./datasets/service";
import { createMemoryLakeFSClient } from "./lakefs/memory";

const port = resolveServerPort(Bun.argv, process.env);

const lakefs = createMemoryLakeFSClient();
const service = createDatasetService({ lakefs });
const api = createDatasetApi({ service });

const server = Bun.serve({
  ...(port === undefined ? {} : { port }),
  fetch: (request) => api.fetch(request),
});

console.log(`Dataset API listening on http://localhost:${server.port}`);
