import { FrontMatterCache, Notice } from "obsidian";
import { IFlowershowSettings } from "./settings";

export function validatePublishFrontmatter(
  frontMatter: FrontMatterCache,
): boolean {
  if (frontMatter && frontMatter["publish"] === false) {
    new Notice("Note is marked as not publishable.");
    return false;
  }
  return true;
}

export function validateSettings(settings: IFlowershowSettings): boolean {
  if (!settings.flowershowToken) {
    new Notice(
      "Config error: You need to define a Flowershow PAT Token in the plugin settings",
    );
    return false;
  }
  if (!settings.siteName) {
    new Notice(
      "Config error: You need to define a Site Name in the plugin settings",
    );
    return false;
  }
  if (!settings.flowershowToken.startsWith("fs_pat_")) {
    new Notice(
      "Config error: Invalid token format. Token should start with 'fs_pat_'",
    );
    return false;
  }
  return true;
}
