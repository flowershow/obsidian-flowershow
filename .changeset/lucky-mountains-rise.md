---
"flowershow": patch
---

Add tests for the SHA-matches-upload invariant in `Publisher.publishBatch`. The pure-helper layer in `publisherHelpers.ts` has been heavily tested, but the orchestrator that uses those helpers had no coverage. New tests pin: (a) the SHA submitted to `publishFiles` matches the bytes uploaded to R2, (b) `rootDir` path normalization and content rewriting are applied consistently to both surfaces, and (c) the deletion path normalizes paths through `rootDir`. The `obsidian` mock gains a `Notice.setMessage`/`hide` stub and the vitest config substitutes the build-time env vars so the production code under test compiles.
