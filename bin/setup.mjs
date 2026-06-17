#!/usr/bin/env node
/**
 * Beacon SDK — postinstall patcher for Next.js instrumentation.ts.
 *
 * Detects the consumer project's instrumentation.ts and injects Beacon hooks.
 * Idempotent: skips if already patched. Silent on failure (never breaks `bun install`).
 *
 * What it does:
 * 1. Adds `import { autoRegister, createOnRequestError } from "@makfly/beacon-sdk-js/nextjs"`
 * 2. Adds `autoRegister()` call at the top of register()
 * 3. Adds beacon relay at the top of onRequestError()
 *
 * Env: BEACON_SERVICE_NAME (optional) — injected into the resource at runtime.
 * The SDK reads BEACON_URL + BEACON_TOKEN at runtime; if absent, everything is a silent no-op.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MARKER = "@makfly/beacon-sdk-js";
const IMPORT_LINE = `import { autoRegister, createOnRequestError } from "${MARKER}/nextjs";`;
const REGISTER_CALL = `  await autoRegister();`;
const ON_REQUEST_ERROR_RELAY = `  await createOnRequestError()(err, request, context);`;

function findProjectRoot() {
  // Walk up from node_modules/@makfly/beacon-sdk-js/ to the consumer project root.
  let dir = resolve(process.cwd());
  // If we're inside node_modules, walk up to the project root.
  const nmIdx = dir.lastIndexOf("node_modules");
  if (nmIdx !== -1) {
    dir = dir.slice(0, nmIdx);
  }
  return dir;
}

function findInstrumentation(root) {
  for (const name of ["instrumentation.ts", "instrumentation.js", "src/instrumentation.ts", "src/instrumentation.js"]) {
    const p = resolve(root, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function patchFile(filePath) {
  let content = readFileSync(filePath, "utf-8");

  // Already patched — skip.
  if (content.includes(MARKER)) return false;

  const lines = content.split("\n");
  const patched = [];
  let importInserted = false;
  let registerPatched = false;
  let onRequestErrorPatched = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Insert import after the last existing import (or at the top).
    if (!importInserted && (trimmed.startsWith("import ") || trimmed.startsWith("import{"))) {
      // Find the last import line.
      let lastImport = i;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t.startsWith("import ") || t.startsWith("import{") || t.startsWith("import(") || t === "") {
          if (t.startsWith("import")) lastImport = j;
        } else break;
      }
      // Insert our import right after the last import.
      if (i === lastImport) {
        patched.push(line);
        patched.push(IMPORT_LINE);
        importInserted = true;
        continue;
      }
    }

    // If we passed all imports without inserting, do it now (before first non-import, non-empty line).
    if (!importInserted && trimmed !== "" && !trimmed.startsWith("import") && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
      patched.push(IMPORT_LINE);
      patched.push("");
      importInserted = true;
    }

    // Patch register() — inject autoRegister() after the opening brace.
    if (!registerPatched && /export\s+(async\s+)?function\s+register\s*\(/.test(trimmed)) {
      patched.push(line);
      // Find the opening brace (might be on this line or next).
      if (trimmed.includes("{")) {
        patched.push(REGISTER_CALL);
        registerPatched = true;
      } else {
        // Look for { on next lines.
        for (let j = i + 1; j < lines.length; j++) {
          patched.push(lines[j]);
          if (lines[j].includes("{")) {
            patched.push(REGISTER_CALL);
            registerPatched = true;
            i = j;
            break;
          }
        }
      }
      continue;
    }

    // Patch onRequestError — inject relay after the arrow/function body opens.
    if (!onRequestErrorPatched && /onRequestError/.test(trimmed) && /export/.test(trimmed)) {
      patched.push(line);
      // Scan forward for the function body opening `{` after the arrow `=>`
      let braceFound = trimmed.includes("=> {") || trimmed.includes("=>{") || (trimmed.includes("{") && trimmed.includes("=>"));
      if (braceFound) {
        patched.push(ON_REQUEST_ERROR_RELAY);
        onRequestErrorPatched = true;
      } else {
        for (let j = i + 1; j < lines.length; j++) {
          patched.push(lines[j]);
          const jt = lines[j].trim();
          if (jt.includes("{") || jt.includes("=> {")) {
            patched.push(ON_REQUEST_ERROR_RELAY);
            onRequestErrorPatched = true;
            i = j;
            break;
          }
        }
      }
      continue;
    }

    patched.push(line);
  }

  // Edge case: no import section found at all.
  if (!importInserted) {
    patched.unshift(IMPORT_LINE, "");
  }

  const result = patched.join("\n");
  if (result === content) return false;

  writeFileSync(filePath, result, "utf-8");
  return true;
}

// --- Main ---
try {
  const root = findProjectRoot();
  const instrPath = findInstrumentation(root);

  if (!instrPath) {
    // No instrumentation file — nothing to patch. Silent exit.
    process.exit(0);
  }

  const changed = patchFile(instrPath);
  if (changed) {
    console.log(`\x1b[36m@makfly/beacon-sdk-js\x1b[0m patched ${instrPath.replace(root, ".")}`);
    console.log("  Set BEACON_URL + BEACON_TOKEN env vars to enable telemetry.");
  }
} catch {
  // Never break the consumer's install.
  process.exit(0);
}
