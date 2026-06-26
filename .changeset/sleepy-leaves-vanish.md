---
"flowershow": patch
---

Remove dead source files, unused exports, and inert code that survived earlier migrations. No behavior change.

- Delete `src/FlowershowPluginInfo.ts`, `src/ObsidianFrontMatterEngine.ts`, `src/components/UpdateModal.ts`, `src/ui/suggest.ts`, `src/ui/file-suggest.ts` — none were imported anywhere; the latter three were entirely commented-out bodies or had their callers commented out in `main.ts`.
- Strip the unused `startupAnalytics` / `logStartupEvent` infrastructure from `main.ts` (written to once, never read).
- Strip the unused `debouncedSaveAndUpdate` / `saveSiteSettingsAndUpdateEnv` from `src/SettingView.ts`.
- Remove the duplicate `isPlainTextExtension` from `src/utils/publisherHelpers.ts` (the publish path imports from `src/utils/index.ts`; the helpers copy was orphaned).
- Remove the unused `GitAlgo` type export.

Net: ~560 lines deleted, build clean, 116 vitest cases unchanged.
