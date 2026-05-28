/**
 * Pure utility functions for Publisher
 * Extracted for testability
 */

import { App, FrontMatterCache, Notice, TFile } from "obsidian";
import { IFlowershowSettings } from "src/settings";

/**
 * Normalize a file path by removing leading slashes and stripping rootDir prefix
 */
export function normalizePath(path: string, rootDir: string): string {
  let normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");

  if (rootDir) {
    const rootDirNormalized = rootDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalizedPath.startsWith(rootDirNormalized + "/")) {
      normalizedPath = normalizedPath.slice(rootDirNormalized.length + 1);
    } else if (normalizedPath === rootDirNormalized) {
      normalizedPath = "";
    }
  }

  return normalizedPath;
}

/**
 * Check if a path is within the specified root directory
 */
export function isWithinRootDir(path: string, rootDir: string): boolean {
  if (!rootDir) {
    return true;
  }

  const rootDirNormalized = rootDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const pathNormalized = path.replace(/\\/g, "/").replace(/^\/+/, "");

  return (
    pathNormalized.startsWith(rootDirNormalized + "/") ||
    pathNormalized === rootDirNormalized
  );
}

/**
 * Check if a path matches any of the exclude patterns
 */
export function matchesExcludePatterns(
  path: string,
  excludePatterns: string[],
): boolean {
  if (!excludePatterns || excludePatterns.length === 0) {
    return false;
  }

  return excludePatterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern);
      return regex.test(path);
    } catch (e) {
      console.error(`Invalid regex pattern: ${pattern}`, e);
      return false;
    }
  });
}

/** Check if a file has publish: false in frontmatter */
export function hasPublishFalse(file: TFile, app: App): boolean {
  if (file.extension !== "md" && file.extension !== "mdx") {
    return false;
  }
  const cachedFile = app.metadataCache.getCache(file.path);
  return cachedFile?.frontmatter?.["publish"] === false;
}

/**
 * Check if a file should be skipped from publishing
 * Combines checks for exclusion patterns and publish: false frontmatter
 */
export function shouldSkipFile(
  file: TFile,
  app: App,
  rootDir: string,
  excludePatterns: string[],
): boolean {
  return (
    !isWithinRootDir(file.path, rootDir) ||
    matchesExcludePatterns(file.path, excludePatterns) ||
    hasPublishFalse(file, app)
  );
}

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

// --- rootDir content rewriting ---

function normalizeRootDir(rootDir: string): string {
  return rootDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function stripRootDirPrefix(path: string, rootDirNormalized: string): string {
  const p = path.replace(/\\/g, "/");
  if (p.startsWith(`${rootDirNormalized}/`)) {
    return p.slice(rootDirNormalized.length + 1);
  }
  if (p === rootDirNormalized) {
    return "";
  }
  return p;
}

export function rewriteWikilinks(content: string, rootDir: string): string {
  if (!rootDir) return content;
  const root = normalizeRootDir(rootDir);
  // Negative lookbehind excludes ![[embeds]]
  return content.replace(
    /(?<!!)(\[\[)([^\]#|]+?)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
    (_match, open, path, anchor, alias) => {
      const rewritten = stripRootDirPrefix(path.trim(), root);
      return `${open}${rewritten}${anchor ?? ""}${alias ?? ""}]]`;
    },
  );
}

export function rewriteEmbeds(content: string, rootDir: string): string {
  if (!rootDir) return content;
  const root = normalizeRootDir(rootDir);
  return content.replace(
    /!\[\[([^\]#|]+?)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
    (_match, path, anchor, alias) => {
      const rewritten = stripRootDirPrefix(path.trim(), root);
      return `![[${rewritten}${anchor ?? ""}${alias ?? ""}]]`;
    },
  );
}

export function rewriteMarkdownLinks(content: string, rootDir: string): string {
  if (!rootDir) return content;
  const root = normalizeRootDir(rootDir);
  return content.replace(
    /\[([^\]]*)\]\(([^)#\s]+?)(#[^)]*)?\)/g,
    (_match, text, url, anchor) => {
      // Skip absolute URLs, protocol-relative, absolute paths, fragments, other schemes
      if (/^(https?:\/\/|ftp:\/\/|\/\/|\/|#|[a-z][a-z0-9+.-]*:)/i.test(url)) return _match;
      const rewritten = stripRootDirPrefix(url, root);
      return `[${text}](${rewritten}${anchor ?? ""})`;
    },
  );
}

export function rewriteFrontmatterPaths(content: string, rootDir: string): string {
  if (!rootDir) return content;
  const root = normalizeRootDir(rootDir);

  // Match frontmatter block at start of file
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return content;

  const fmBlock = fmMatch[0];
  const rewrittenBlock = fmBlock.replace(
    /^([a-zA-Z_][a-zA-Z0-9_-]*:\s+)(["']?)([^\n"']+)\2$/gm,
    (match, key, quote, value) => {
      const rewritten = stripRootDirPrefix(value, root);
      if (rewritten === value) return match;
      return `${key}${quote}${rewritten}${quote}`;
    },
  );

  return content.replace(fmBlock, () => rewrittenBlock);
}

export function rewriteRootDirPaths(content: string, rootDir: string): string {
  if (!rootDir) return content;
  let result = content;
  result = rewriteFrontmatterPaths(result, rootDir);
  result = rewriteWikilinks(result, rootDir);
  result = rewriteEmbeds(result, rootDir);
  result = rewriteMarkdownLinks(result, rootDir);
  result = rewriteBaseQueryPaths(result, rootDir);
  return result;
}

export function rewriteBaseQueryPaths(content: string, rootDir: string): string {
  if (!rootDir) return content;
  const root = normalizeRootDir(rootDir);
  return content.replace(
    /(```base\n)([\s\S]*?)(\n```)/g,
    (_match, open, body, close) => {
      const rewrittenBody = body.replace(
        /("([^"]+)"|'([^']+)')/g,
        (qmatch: string, _full: string, dq: string | undefined, sq: string | undefined) => {
          const inner = dq ?? sq ?? "";
          const rewritten = stripRootDirPrefix(inner, root);
          if (rewritten === inner) return qmatch;
          return dq !== undefined ? `"${rewritten}"` : `'${rewritten}'`;
        },
      );
      return `${open}${rewrittenBody}${close}`;
    },
  );
}
