---
"flowershow": patch
---

Add a CI workflow that runs type-check and tests on every pull request and push to `main`. Uses the project's existing tooling (npm, tsc, vitest); doesn't introduce new tools. Biome is intentionally left out for now since the existing codebase has pre-existing findings.
