import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATES = [
  "instrumentation.ts",
  "instrumentation.js",
  "src/instrumentation.ts",
  "src/instrumentation.js",
] as const;

export interface SetupInspection {
  hasBeaconImport: boolean;
  hasRegister: boolean;
  hasOnRequestError: boolean;
  ready: boolean;
}

export type SetupResult =
  | { status: "ready" | "incomplete" | "created"; path: string; inspection: SetupInspection }
  | { status: "missing"; path: null; inspection: null };

export function setupSnippet(): string {
  return `import { registerBeacon, createOnRequestError } from "@makfly/beacon-sdk-js/nextjs";

export function register() {
  registerBeacon({
    endpoint: process.env.BEACON_ENDPOINT!,
    token: process.env.BEACON_TOKEN!,
    resource: {
      "service.name": process.env.BEACON_SERVICE_NAME ?? "next-app",
      "service.stage": process.env.NODE_ENV === "production" ? "production" : "dev",
    },
  });
}

export const onRequestError = createOnRequestError();
`;
}

export function inspectInstrumentation(content: string): SetupInspection {
  const hasBeaconImport = content.includes("@makfly/beacon-sdk-js/nextjs");
  const hasRegister = /export\s+(async\s+)?function\s+register\s*\(/.test(content)
    && /(registerBeacon|autoRegister)\s*\(/.test(content);
  const hasOnRequestError = /export\s+const\s+onRequestError\s*=/.test(content)
    && /createOnRequestError\s*\(/.test(content);

  return {
    hasBeaconImport,
    hasRegister,
    hasOnRequestError,
    ready: hasBeaconImport && hasRegister && hasOnRequestError,
  };
}

export function findInstrumentation(root: string): string | null {
  for (const candidate of CANDIDATES) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

export function runSetup(root: string, options: { write?: boolean } = {}): SetupResult {
  const path = findInstrumentation(root);
  if (path) {
    const inspection = inspectInstrumentation(readFileSync(path, "utf8"));
    return { status: inspection.ready ? "ready" : "incomplete", path, inspection };
  }

  if (!options.write) {
    return { status: "missing", path: null, inspection: null };
  }

  const createdPath = resolve(root, "instrumentation.ts");
  const content = setupSnippet();
  writeFileSync(createdPath, content, { encoding: "utf8", flag: "wx" });
  return { status: "created", path: createdPath, inspection: inspectInstrumentation(content) };
}
