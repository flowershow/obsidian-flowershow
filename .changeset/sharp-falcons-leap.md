---
"flowershow": patch
---

Validate the plugin's settings before every publish attempt. `validateSettings` was already implemented and tested but never wired up — users with an empty token or site name would hit the network and see a generic 401 in the console. Now the publish entry points (single-note, publish-all, and every modal action) bail out early with the specific "you need to define a Flowershow PAT Token" / "you need to define a Site Name" notice.
