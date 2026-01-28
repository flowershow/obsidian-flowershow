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
  if (!settings.githubRepo) {
    new Notice(
      "Config error: You need to define a GitHub repo in the plugin settings",
    );
    return false;
  }
  if (!settings.githubUserName) {
    new Notice(
      "Config error: You need to define a GitHub Username in the plugin settings",
    );
    return false;
  }
  if (!settings.githubToken) {
    new Notice(
      "Config error: You need to define a GitHub Token in the plugin settings",
    );
    return false;
  }
  if (!settings.branch?.trim()) {
    new Notice(
      "Config error: Branch cannot be empty. Using 'main' as default.",
    );
    settings.branch = "main";
  }
  return true;
}
