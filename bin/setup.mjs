#!/usr/bin/env node

import process from "node:process";
import { runSetup, setupSnippet } from "../dist/setup.js";

const write = process.argv.includes("--write");
const result = runSetup(process.cwd(), { write });

if (result.status === "ready") {
  console.log(`Beacon instrumentation ready: ${result.path}`);
  process.exit(0);
}

if (result.status === "created") {
  console.log(`Created ${result.path}`);
  console.log("Set BEACON_TOKEN and BEACON_SERVICE_NAME to enable telemetry. BEACON_ENDPOINT defaults to https://ingest.pulseview.app.");
  process.exit(0);
}

if (result.status === "incomplete") {
  console.error(`Beacon did not modify ${result.path}. Complete the integration manually:`);
  console.log(setupSnippet());
  process.exit(1);
}

console.log("No instrumentation.ts file was found.");
console.log(write ? "Creating a new file was not possible." : "Run beacon-setup --write to create one, or add this snippet manually:");
console.log(setupSnippet());
process.exit(write ? 1 : 0);
