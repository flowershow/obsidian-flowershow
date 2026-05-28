---
"flowershow": patch
---

Remove unused runtime dependencies left over from the pre-v4 GitHub-publishing era (`axios`, `@octokit/core`, `@octokit/rest`, `@sindresorhus/slugify`, `github-slugger`, `luxon`, and `@types/luxon`). None were imported anywhere; removing them trims install time and supply-chain surface.
