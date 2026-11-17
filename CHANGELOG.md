# flowershow

## 4.2.4

### Patch Changes

- 2cdabc4: Fix publish status for vaults with more than 1,000 files. The status check sent the whole vault to the server in one request; above 1,000 files the server rejected it and the plugin silently listed every file as "New". Together with the server-side fix, large vaults now show the right Changed/New/Deleted files. Publishing and unpublishing more than 1,000 files (or more than 500 MB) at once now goes out in batches, and if the status check fails the plugin shows the error instead of guessing.

## 4.2.3

### Patch Changes

- cc0a64b: Fix broken canvas images when publishing from a subfolder. Canvas (`.canvas`) files are now rewritten on publish so their `file`/`text` node references drop the configured rootDir prefix, matching the stripped blob keys the plugin already uploads. Previously canvas files uploaded as raw binary and kept the prefix, so published canvases pointed at paths that 404'd.

## 4.2.2

### Patch Changes

- c25fa37: Never create sites from the plugin. Publishing now requires a Flowershow site that already exists with the exact same name as the "Site Name" setting; if it doesn't exist, publishing fails with a clear error instead of creating one.

## 4.2.1

### Patch Changes

- dca7631: Wait for the server to finish finalizing a publish or unpublish before reporting it complete. Uploading a file to R2 (or deleting one) only stages the change — the server processes blobs asynchronously — so the publish status view briefly showed just-published files as still "New" (and just-unpublished files as still present) until processing caught up, making it look as if the operation had stalled. The plugin now waits for finalization before refreshing status: publishes poll the site status endpoint until nothing is pending, and unpublishes poll a dry-run sync until the removed paths are gone. Files now land in the correct section immediately, without needing to close and reopen the modal.

## 4.2.0

Require an explicit site name before publishing. Previously an empty site name silently fell back to the vault name, and the existing settings validation was never actually run. The plugin now validates settings at every publish entry point (single note, publish all, and the publish status modal) and blocks publishing with a clear notice until a site name is set.

## 4.1.2

### Patch Changes

- 6635b94: Remove unused runtime dependencies left over from the pre-v4 GitHub-publishing era (`axios`, `@octokit/core`, `@octokit/rest`, `@sindresorhus/slugify`, `github-slugger`, `luxon`, and `@types/luxon`). None were imported anywhere; removing them trims install time and supply-chain surface.
- 8600136: Fix published files always showing as "Changed" in the publish status view. The plugin computed a plain `SHA-1` of file content, but the server stores and compares a **git blob** SHA-1 (`SHA-1("blob " + byteLength + "\0" + content)`, matching the CLI and `git hash-object`). The two never matched, so every published file was reported as changed forever. Both `calculateFileSha` and `calculateTextSha` now produce the git blob SHA. No republish is needed after updating — the next status refresh reconciles automatically.

## 4.1.1

### Patch Changes

- Preserve backslash-escaped pipes in wikilinks inside tables.

## 4.1.0

### Minor Changes

- Publish history tracking: the plugin now sends a `publish-id` header with every R2 upload, enabling per-file status tracking and a full publish history in the Flowershow dashboard.

## 4.0.17

### Patch Changes

- Scope checkbox CSS to avoid conflicting with other plugins.

## 4.0.16

### Patch Changes

- 49f41f6: Fix broken internal links when publishing a vault subdirectory — wikilinks, embeds, markdown links, Base query filters, and frontmatter path values are now rewritten to be relative to rootDir

## 4.0.15

### Patch Changes

- Remove info box about v4 from the plugin options page.

## 4.0.14

### Patch Changes

- Hide warning about v4 changes.

## 4.0.13

### Patch Changes

- 60e8515: feat: show publish progress in a Notice instead of the status bar

  Progress is now displayed via a self-updating `Notice` ("⌛ Publishing (X/N)...") that works on both desktop and mobile. The status bar 💐 icon is kept on desktop as a shortcut to open the publish panel. `PublishStatusBar` class has been removed.

## 4.0.12

### Patch Changes

- 0eaa93f: fix: mobile and Windows compatibility improvements
  - Replace `fetch()` with Obsidian's `requestUrl()` in `FlowershowClient` so HTTP requests work on iOS and Android (Capacitor WebView blocks cross-origin `fetch`)
  - Normalize backslashes to forward slashes in `rootDir` and file paths so Windows users with `Notes\subfolder` style settings can publish correctly
  - Guard `addStatusBarItem()` with `Platform.isDesktop` to avoid dead UI code on mobile

## 4.0.11

### Patch Changes

- Add `X-Flowershow-Plugin-Version` header to API requests for server-side tracking.
- Rename plugin to "Publish with Flowershow"

## 4.0.10

### Patch Changes

- Fix: broken unpublishing of selected files when `rootDir` is set.

## 4.0.9

### Patch Changes

- Don't publish files with `publish: false`.

## 4.0.8

### Patch Changes

- Default site name to vault name throughout Publisher

## 4.0.7

### Patch Changes

- Default displayed site name to vault name.

## 4.0.6

### Patch Changes

- Fix esbuild config and rm unneeded console logs.

## 4.0.5

### Patch Changes

- Remove console logs.

## 4.0.4

### Patch Changes

- Fix exclude patterns config and add rootDir config option.

## 4.0.3

### Patch Changes

- Show update info in a modal.

## 4.0.2

### Patch Changes

- Add info box about the new version to the Settings Tab.

## 4.0.1

### Patch Changes

- Improve Publish Modal UX and remove Test Connection button.

## 4.0.0

### Major Changes

- BREAKING: Publish directly to Flowershow using PAT, without GitHub repository as an intermediary.

## 3.0.7

### Patch Changes

- Fixed incorrect "Test connection" button message for fine-grained tokens.

## 3.0.6

### Patch Changes

- Make "unchanged" section folded by default and change the color of checkboxes.

## 3.0.5

### Patch Changes

- Fix flaky auth test button.

## 3.0.4

### Patch Changes

- Fix bug #30 (Broken single file publish due to incorrect branch names used.)

## 3.0.3

### Patch Changes

- Fix bug: duplicate status bar element.

## 3.0.2

### Patch Changes

- Fix publish status bar counter https://github.com/datopian/obsidian-flowershow/issues/28
