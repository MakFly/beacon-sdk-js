# CLAUDE.md — @makfly/beacon-sdk-js

Rules for working in this repo. Read before any change that ships.

## What this is

The browser/node/Next.js telemetry SDK. Published to **npmjs** (public) as
`@makfly/beacon-sdk-js`. **Depends on `@makfly/beacon-protocol`** (the wire contract).

In the `iautos-telemetry` monorepo this dep is `workspace:*`; **`bun publish` rewrites it
to the exact published protocol version** at pack time. So a standalone clone installs
the npm version, the monorepo uses the local one.

## Versioning (SemVer — strict)

Version lives in `package.json` `"version"`; git tag `vX.Y.Z` **must** match it.

- **PATCH**: fix/internal, no API change.
- **MINOR**: additive, backward-compatible new API.
- **MAJOR**: breaking public API change.

## Release workflow (order matters)

```bash
# 0. If beacon-protocol changed: release IT FIRST (its own repo), then bump the dep here.
# 1. bump "version" in package.json
git add -A && git commit -m "release: vX.Y.Z"
git tag vX.Y.Z                       # MUST equal package.json version
git push origin main && git push origin vX.Y.Z
bun run build && bun publish         # protocol must already be on npmjs
```

After publish, verify the dependency was rewritten (no `workspace:*` leaked):

```bash
bun pm view @makfly/beacon-sdk-js dependencies   # → @makfly/beacon-protocol pinned to a real version
```

## Hard rules

- **Tags are immutable.** Bad release → next PATCH, never rewrite a published tag.
- Tag `vX.Y.Z` **always** equals `package.json` `version`.
- **Publish `@makfly/beacon-protocol` before this package** whenever the protocol changed.
- `files: ["dist"]` → **always `bun run build` before `bun publish`.**
- Git **submodule** of a private telemetry monorepo → bump its pointer after release.
- `ig` for search (never `grep`/`rg`); `bun`/`bunx` only; native `fetch`, never `axios`.
