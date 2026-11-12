---
"flowershow": patch
---

Make "site not found" errors actionable. If "Site Name" looks like a URL or custom domain (e.g. `example.com`), the error now says explicitly that it must be the site's name from your Flowershow dashboard, not its URL or domain; otherwise it reminds you the name must match exactly (case-sensitive). The publish status view shows the same warning instead of silently listing every file as "New". Site Name is now trimmed on save and URL-encoded in API requests, so stray spaces no longer cause a lookup miss.
