export function resolveServerPort(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  const cliPort = argv
    .map((arg) => arg.match(/^--port=(\d+)$/)?.[1])
    .find((value): value is string => value !== undefined);
  const configuredPort = cliPort ?? env.DATASET_API_PORT;
  return configuredPort ? parsePort(configuredPort) : undefined;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("server port must be an integer between 1 and 65535");
  }
  return port;
}
