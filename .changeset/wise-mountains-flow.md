---
"flowershow": patch
---

Refactor `FlowershowClient` to centralize HTTP error handling in `apiRequest`. The same `if (response.status >= 300) { ... throw new Error(...) }` block was duplicated across eight methods; it now lives in one place and each method becomes a one-liner. `getSiteByName` keeps its 404 → `null` behavior via a new `allowedStatuses` parameter. No behavior change.
