---
"flowershow": patch
---

Cache rewritten text content within a publish batch. `Publisher.publishBatch` used to run the `rootDir` rewriter chain twice per text file — once for SHA computation, once for the R2 upload bytes. A small per-call `Map<string, string>` now memoizes the result so each text file is rewritten once, halving the regex work during a batch publish. The cache also enforces the invariant that the SHA submitted to the server matches the bytes uploaded, since both reads come from the same rewriter pass.
