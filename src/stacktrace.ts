import type { StackFrame } from "@makfly/beacon-protocol";

/** V8 stack frame lines: "at fn (file:line:col)" or "at file:line:col". */
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/**
 * Parse an Error.stack string into Beacon stack frames. Best-effort and dependency-free:
 * covers the V8 format used by Node, Chrome, Bun, and Next.js server runtimes.
 */
export function parseStack(stack: string | undefined, appRoot?: string): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = V8_FRAME.exec(line);
    if (!m) continue;
    const [, fnRaw, file, lineNo, colNo] = m;
    const fn = fnRaw?.trim();
    let className: string | null = null;
    let method: string | null = fn ?? null;
    if (fn && fn.includes(".")) {
      const idx = fn.lastIndexOf(".");
      className = fn.slice(0, idx);
      method = fn.slice(idx + 1);
    }
    frames.push({
      file: file!,
      lineNumber: Number(lineNo),
      columnNumber: Number(colNo),
      class: className,
      method,
      isApplicationFrame: isAppFrame(file!, appRoot),
    });
  }
  return frames;
}

function isAppFrame(file: string, appRoot?: string): boolean {
  if (file.includes("node_modules")) return false;
  if (file.startsWith("node:") || file.startsWith("internal/")) return false;
  if (appRoot) return file.startsWith(appRoot);
  return !file.includes("node_modules");
}
