---
"flowershow": patch
---

Fix publish status for vaults with more than 1,000 files. The status check sent the whole vault to the server in one request; above 1,000 files the server rejected it and the plugin silently listed every file as "New". Together with the server-side fix, large vaults now show the right Changed/New/Deleted files. Publishing and unpublishing more than 1,000 files (or more than 500 MB) at once now goes out in batches, and if the status check fails the plugin shows the error instead of guessing.
