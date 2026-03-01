---
"flowershow": patch
---

feat: show publish progress in a Notice instead of the status bar

Progress is now displayed via a self-updating `Notice` ("⌛ Publishing (X/N)...") that works on both desktop and mobile. The status bar 💐 icon is kept on desktop as a shortcut to open the publish panel. `PublishStatusBar` class has been removed.
