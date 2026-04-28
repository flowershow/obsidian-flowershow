import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizePath,
  isWithinRootDir,
  matchesExcludePatterns,
  hasPublishFalse,
  shouldSkipFile,
  validatePublishFrontmatter,
  validateSettings,
  rewriteWikilinks,
  rewriteEmbeds,
  rewriteMarkdownLinks,
  rewriteBaseQueryPaths,
  rewriteFrontmatterPaths,
  rewriteRootDirPaths,
} from "./publisherHelpers";
import { IFlowershowSettings } from "src/settings";
import { App, TFile } from "obsidian";

describe("normalizePath", () => {
  describe("without rootDir", () => {
    it("returns path unchanged when no rootDir", () => {
      expect(normalizePath("notes/file.md", "")).toBe("notes/file.md");
    });

    it("removes leading slashes", () => {
      expect(normalizePath("/notes/file.md", "")).toBe("notes/file.md");
      expect(normalizePath("///notes/file.md", "")).toBe("notes/file.md");
    });
  });

  describe("with rootDir", () => {
    it("strips rootDir prefix from path", () => {
      expect(normalizePath("blog/posts/file.md", "blog")).toBe("posts/file.md");
    });

    it("handles rootDir with trailing slash", () => {
      expect(normalizePath("blog/posts/file.md", "blog/")).toBe(
        "posts/file.md",
      );
    });

    it("handles rootDir with leading slash", () => {
      expect(normalizePath("blog/posts/file.md", "/blog")).toBe(
        "posts/file.md",
      );
    });

    it("handles rootDir with both leading and trailing slashes", () => {
      expect(normalizePath("blog/posts/file.md", "/blog/")).toBe(
        "posts/file.md",
      );
    });

    it("does not strip partial matches", () => {
      expect(normalizePath("blog-posts/file.md", "blog")).toBe(
        "blog-posts/file.md",
      );
    });

    it("handles nested rootDir", () => {
      expect(normalizePath("content/blog/posts/file.md", "content/blog")).toBe(
        "posts/file.md",
      );
    });

    it("handles path with leading slash and rootDir", () => {
      expect(normalizePath("/blog/posts/file.md", "blog")).toBe(
        "posts/file.md",
      );
    });

    it("returns path unchanged if not under rootDir", () => {
      expect(normalizePath("other/file.md", "blog")).toBe("other/file.md");
    });
  });

  describe("Windows backslash handling", () => {
    it("normalizes backslashes in path", () => {
      expect(normalizePath("blog\\posts\\file.md", "blog")).toBe(
        "posts/file.md",
      );
    });

    it("normalizes backslashes in rootDir", () => {
      expect(normalizePath("blog/posts/file.md", "blog\\")).toBe(
        "posts/file.md",
      );
    });

    it("normalizes backslashes in both path and rootDir", () => {
      expect(normalizePath("Notes\\subfolder\\file.md", "Notes\\subfolder")).toBe(
        "file.md",
      );
    });

    it("handles mixed slashes", () => {
      expect(normalizePath("Notes/subfolder\\file.md", "Notes\\subfolder")).toBe(
        "file.md",
      );
    });
  });
});

describe("isWithinRootDir", () => {
  describe("without rootDir", () => {
    it("returns true for any path when no rootDir set", () => {
      expect(isWithinRootDir("any/path/file.md", "")).toBe(true);
    });
  });

  describe("with rootDir", () => {
    it("returns true for files directly under rootDir", () => {
      expect(isWithinRootDir("blog/file.md", "blog")).toBe(true);
    });

    it("returns true for files in nested folders under rootDir", () => {
      expect(isWithinRootDir("blog/posts/2024/file.md", "blog")).toBe(true);
    });

    it("returns false for files outside rootDir", () => {
      expect(isWithinRootDir("other/file.md", "blog")).toBe(false);
    });

    it("returns false for partial directory name matches", () => {
      expect(isWithinRootDir("blog-archive/file.md", "blog")).toBe(false);
    });

    it("handles rootDir with slashes", () => {
      expect(isWithinRootDir("blog/file.md", "/blog/")).toBe(true);
      expect(isWithinRootDir("blog/file.md", "/blog")).toBe(true);
      expect(isWithinRootDir("blog/file.md", "blog/")).toBe(true);
    });

    it("handles path with leading slash", () => {
      expect(isWithinRootDir("/blog/file.md", "blog")).toBe(true);
    });

    it("handles nested rootDir", () => {
      expect(isWithinRootDir("content/blog/file.md", "content/blog")).toBe(
        true,
      );
      expect(isWithinRootDir("content/other/file.md", "content/blog")).toBe(
        false,
      );
    });
  });

  describe("Windows backslash handling", () => {
    it("normalizes backslashes in rootDir", () => {
      expect(isWithinRootDir("Notes/subfolder/file.md", "Notes\\subfolder")).toBe(true);
      expect(isWithinRootDir("other/file.md", "Notes\\subfolder")).toBe(false);
    });

    it("normalizes backslashes in path", () => {
      expect(isWithinRootDir("Notes\\subfolder\\file.md", "Notes/subfolder")).toBe(true);
    });

    it("normalizes backslashes in both path and rootDir", () => {
      expect(isWithinRootDir("Notes\\subfolder\\file.md", "Notes\\subfolder")).toBe(true);
      expect(isWithinRootDir("Other\\file.md", "Notes\\subfolder")).toBe(false);
    });
  });
});

describe("matchesExcludePatterns", () => {
  it("returns false when no patterns provided", () => {
    expect(matchesExcludePatterns("file.md", [])).toBe(false);
  });

  it("returns false when patterns is undefined", () => {
    expect(matchesExcludePatterns("file.md", undefined as any)).toBe(false);
  });

  it("matches simple extension pattern", () => {
    expect(matchesExcludePatterns("file.excalidraw", ["\\.excalidraw$"])).toBe(
      true,
    );
    expect(matchesExcludePatterns("file.md", ["\\.excalidraw$"])).toBe(false);
  });

  it("matches directory prefix pattern", () => {
    expect(matchesExcludePatterns("private/secret.md", ["^private/"])).toBe(
      true,
    );
    expect(matchesExcludePatterns("public/file.md", ["^private/"])).toBe(false);
  });

  it("matches filename pattern", () => {
    expect(matchesExcludePatterns("folder/.DS_Store", ["\\.DS_Store$"])).toBe(
      true,
    );
  });

  it("matches complex excalidraw pattern", () => {
    const pattern = "\\.excalidraw(\\.(md|excalidraw))?$";
    expect(matchesExcludePatterns("drawing.excalidraw", [pattern])).toBe(true);
    expect(matchesExcludePatterns("drawing.excalidraw.md", [pattern])).toBe(
      true,
    );
    expect(
      matchesExcludePatterns("drawing.excalidraw.excalidraw", [pattern]),
    ).toBe(true);
    expect(matchesExcludePatterns("drawing.md", [pattern])).toBe(false);
  });

  it("matches if any pattern matches", () => {
    const patterns = ["^private/", "\\.tmp$", "^drafts/"];
    expect(matchesExcludePatterns("private/file.md", patterns)).toBe(true);
    expect(matchesExcludePatterns("cache.tmp", patterns)).toBe(true);
    expect(matchesExcludePatterns("drafts/post.md", patterns)).toBe(true);
    expect(matchesExcludePatterns("public/file.md", patterns)).toBe(false);
  });

  it("handles invalid regex gracefully", () => {
    expect(matchesExcludePatterns("file.md", ["[invalid"])).toBe(false);
  });

  it("handles mixed valid and invalid patterns", () => {
    expect(matchesExcludePatterns("file.tmp", ["[invalid", "\\.tmp$"])).toBe(
      true,
    );
  });
});

describe("hasPublishFalse", () => {
  const createMockFile = (
    path: string,
    extension: string,
    frontmatter?: any,
  ): TFile => {
    return {
      path,
      extension,
    } as TFile;
  };

  const createMockApp = (frontmatter?: any): App => {
    return {
      metadataCache: {
        getCache: vi.fn(() => ({
          frontmatter,
        })),
      },
    } as unknown as App;
  };

  it("returns false for non-markdown files", () => {
    const file = createMockFile("image.png", "png");
    const app = createMockApp();
    expect(hasPublishFalse(file, app)).toBe(false);
  });

  it("returns false for markdown files without publish frontmatter", () => {
    const file = createMockFile("note.md", "md");
    const app = createMockApp({ title: "My Note" });
    expect(hasPublishFalse(file, app)).toBe(false);
  });

  it("returns false when publish is true", () => {
    const file = createMockFile("note.md", "md");
    const app = createMockApp({ publish: true });
    expect(hasPublishFalse(file, app)).toBe(false);
  });

  it("returns true when publish is false", () => {
    const file = createMockFile("note.md", "md");
    const app = createMockApp({ publish: false });
    expect(hasPublishFalse(file, app)).toBe(true);
  });

  it("returns true for mdx files with publish: false", () => {
    const file = createMockFile("note.mdx", "mdx");
    const app = createMockApp({ publish: false });
    expect(hasPublishFalse(file, app)).toBe(true);
  });

  it("returns false when frontmatter is undefined", () => {
    const file = createMockFile("note.md", "md");
    const app = createMockApp(undefined);
    expect(hasPublishFalse(file, app)).toBe(false);
  });
});

describe("shouldSkipFile", () => {
  const createMockFile = (path: string, extension: string = "md"): TFile => {
    return {
      path,
      extension,
    } as TFile;
  };

  const createMockApp = (frontmatter?: any): App => {
    return {
      metadataCache: {
        getCache: vi.fn(() => ({
          frontmatter,
        })),
      },
    } as unknown as App;
  };

  it("skips files outside rootDir", () => {
    const file = createMockFile("other/file.md");
    const app = createMockApp();
    expect(shouldSkipFile(file, app, "blog", [])).toBe(true);
  });

  it("does not skip files inside rootDir with no patterns or publish: false", () => {
    const file = createMockFile("blog/file.md");
    const app = createMockApp();
    expect(shouldSkipFile(file, app, "blog", [])).toBe(false);
  });

  it("skips files matching exclude patterns within rootDir", () => {
    const file = createMockFile("blog/file.excalidraw", "excalidraw");
    const app = createMockApp();
    expect(shouldSkipFile(file, app, "blog", ["\\.excalidraw$"])).toBe(true);
  });

  it("does not skip files not matching patterns within rootDir", () => {
    const file = createMockFile("blog/file.md");
    const app = createMockApp();
    expect(shouldSkipFile(file, app, "blog", ["\\.excalidraw$"])).toBe(false);
  });

  it("skips based on rootDir first, then patterns", () => {
    const file = createMockFile("other/file.excalidraw", "excalidraw");
    const app = createMockApp();
    expect(shouldSkipFile(file, app, "blog", ["\\.excalidraw$"])).toBe(true);
  });

  it("handles empty rootDir with exclude patterns", () => {
    const file1 = createMockFile("private/file.md");
    const file2 = createMockFile("public/file.md");
    const app = createMockApp();
    expect(shouldSkipFile(file1, app, "", ["^private/"])).toBe(true);
    expect(shouldSkipFile(file2, app, "", ["^private/"])).toBe(false);
  });

  it("combines rootDir filtering with multiple patterns", () => {
    const patterns = ["\\.excalidraw$", "^blog/drafts/", "\\.tmp$"];
    const app = createMockApp();

    // Inside rootDir, matches pattern
    const file1 = createMockFile("blog/drafts/post.md");
    expect(shouldSkipFile(file1, app, "blog", patterns)).toBe(true);

    // Inside rootDir, no pattern match
    const file2 = createMockFile("blog/posts/file.md");
    expect(shouldSkipFile(file2, app, "blog", patterns)).toBe(false);

    // Outside rootDir
    const file3 = createMockFile("other/file.md");
    expect(shouldSkipFile(file3, app, "blog", patterns)).toBe(true);
  });

  it("skips files with publish: false in frontmatter", () => {
    const file = createMockFile("blog/secret.md");
    const app = createMockApp({ publish: false });
    expect(shouldSkipFile(file, app, "blog", [])).toBe(true);
  });

  it("does not skip files with publish: true in frontmatter", () => {
    const file = createMockFile("blog/public.md");
    const app = createMockApp({ publish: true });
    expect(shouldSkipFile(file, app, "blog", [])).toBe(false);
  });

  it("skips files that match patterns even if publish is true", () => {
    const file = createMockFile("blog/file.excalidraw", "excalidraw");
    const app = createMockApp({ publish: true });
    expect(shouldSkipFile(file, app, "blog", ["\\.excalidraw$"])).toBe(true);
  });

  it("skips files outside rootDir even if publish is true", () => {
    const file = createMockFile("other/file.md");
    const app = createMockApp({ publish: true });
    expect(shouldSkipFile(file, app, "blog", [])).toBe(true);
  });
});

describe("validatePublishFrontmatter", () => {
  it("returns true when publish is not set", () => {
    const frontmatter = { title: "My Note" } as any;
    expect(validatePublishFrontmatter(frontmatter)).toBe(true);
  });

  it("returns true when publish is true", () => {
    const frontmatter = { publish: true } as any;
    expect(validatePublishFrontmatter(frontmatter)).toBe(true);
  });

  it("returns false when publish is false", () => {
    const frontmatter = { publish: false } as any;
    expect(validatePublishFrontmatter(frontmatter)).toBe(false);
  });

  it("returns true when publish is a string (not boolean false)", () => {
    const frontmatter = { publish: "false" } as any;
    expect(validatePublishFrontmatter(frontmatter)).toBe(true);
  });

  it("returns true when frontmatter is empty", () => {
    const frontmatter = {} as any;
    expect(validatePublishFrontmatter(frontmatter)).toBe(true);
  });
});

describe("validateSettings", () => {
  it("returns true for valid settings", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "fs_pat_abc123",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(true);
  });

  it("returns false when token is missing", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(false);
  });

  it("returns false when siteName is missing", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "fs_pat_abc123",
      siteName: "",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(false);
  });

  it("returns false when token format is invalid", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "invalid_token",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(false);
  });

  it("returns false when token does not start with fs_pat_", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "pat_abc123",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(false);
  });

  it("returns true when token starts with fs_pat_ and has content after", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "fs_pat_",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(true);
  });

  it("validates token format before checking siteName", () => {
    // Token is checked first, even if siteName is valid
    const settings: IFlowershowSettings = {
      flowershowToken: "invalid",
      siteName: "my-site",
      rootDir: "",
      excludePatterns: [],
      lastSeenVersion: "",
    };
    expect(validateSettings(settings)).toBe(false);
  });

  it("returns true with optional fields populated", () => {
    const settings: IFlowershowSettings = {
      flowershowToken: "fs_pat_abc123xyz",
      siteName: "my-blog",
      rootDir: "content",
      excludePatterns: ["^private/", "\\.tmp$"],
      lastSeenVersion: "4.0.0",
    };
    expect(validateSettings(settings)).toBe(true);
  });
});

describe("rewriteWikilinks", () => {
  it("returns content unchanged when no rootDir", () => {
    expect(rewriteWikilinks("[[Public/note]]", "")).toBe("[[Public/note]]");
  });

  it("strips rootDir prefix from simple wikilink", () => {
    expect(rewriteWikilinks("[[Public/note]]", "Public")).toBe("[[note]]");
  });

  it("strips rootDir prefix from nested path", () => {
    expect(rewriteWikilinks("[[Public/Archive/note]]", "Public")).toBe("[[Archive/note]]");
  });

  it("preserves alias", () => {
    expect(rewriteWikilinks("[[Public/Archive/note|My Note]]", "Public")).toBe("[[Archive/note|My Note]]");
  });

  it("preserves heading ref", () => {
    expect(rewriteWikilinks("[[Public/Archive/note#heading]]", "Public")).toBe("[[Archive/note#heading]]");
  });

  it("preserves heading ref with alias", () => {
    expect(rewriteWikilinks("[[Public/Archive/note#heading|alias]]", "Public")).toBe("[[Archive/note#heading|alias]]");
  });

  it("does not rewrite links outside rootDir", () => {
    expect(rewriteWikilinks("[[Other/note]]", "Public")).toBe("[[Other/note]]");
  });

  it("does not rewrite partial directory name matches", () => {
    expect(rewriteWikilinks("[[PublicArchive/note]]", "Public")).toBe("[[PublicArchive/note]]");
  });

  it("does not touch embeds", () => {
    expect(rewriteWikilinks("![[Public/image.png]]", "Public")).toBe("![[Public/image.png]]");
  });

  it("rewrites multiple wikilinks in one document", () => {
    const content = "See [[Public/a]] and [[Public/b]].";
    expect(rewriteWikilinks(content, "Public")).toBe("See [[a]] and [[b]].");
  });

  it("handles rootDir with leading/trailing slashes", () => {
    expect(rewriteWikilinks("[[Public/note]]", "/Public/")).toBe("[[note]]");
  });
});

describe("rewriteEmbeds", () => {
  it("returns content unchanged when no rootDir", () => {
    expect(rewriteEmbeds("![[Public/image.png]]", "")).toBe("![[Public/image.png]]");
  });

  it("strips rootDir prefix from embed", () => {
    expect(rewriteEmbeds("![[Public/image.png]]", "Public")).toBe("![[image.png]]");
  });

  it("strips rootDir prefix from nested embed path", () => {
    expect(rewriteEmbeds("![[Public/Assets/photo.jpg]]", "Public")).toBe("![[Assets/photo.jpg]]");
  });

  it("preserves alias in embed", () => {
    expect(rewriteEmbeds("![[Public/image.png|200]]", "Public")).toBe("![[image.png|200]]");
  });

  it("preserves heading ref in embed", () => {
    expect(rewriteEmbeds("![[Public/note#section]]", "Public")).toBe("![[note#section]]");
  });

  it("does not rewrite embeds outside rootDir", () => {
    expect(rewriteEmbeds("![[Other/image.png]]", "Public")).toBe("![[Other/image.png]]");
  });

  it("does not touch plain wikilinks", () => {
    expect(rewriteEmbeds("[[Public/note]]", "Public")).toBe("[[Public/note]]");
  });

  it("rewrites multiple embeds", () => {
    const content = "![[Public/a.png]] and ![[Public/b.png]]";
    expect(rewriteEmbeds(content, "Public")).toBe("![[a.png]] and ![[b.png]]");
  });
});

describe("rewriteMarkdownLinks", () => {
  it("returns content unchanged when no rootDir", () => {
    expect(rewriteMarkdownLinks("[text](Public/note.md)", "")).toBe("[text](Public/note.md)");
  });

  it("strips rootDir prefix from markdown link", () => {
    expect(rewriteMarkdownLinks("[text](Public/note.md)", "Public")).toBe("[text](note.md)");
  });

  it("strips rootDir prefix from nested path", () => {
    expect(rewriteMarkdownLinks("[text](Public/Archive/note.md)", "Public")).toBe("[text](Archive/note.md)");
  });

  it("preserves anchor fragment", () => {
    expect(rewriteMarkdownLinks("[text](Public/note.md#section)", "Public")).toBe("[text](note.md#section)");
  });

  it("does not rewrite external http links", () => {
    expect(rewriteMarkdownLinks("[text](https://example.com/Public/note)", "Public")).toBe(
      "[text](https://example.com/Public/note)"
    );
  });

  it("does not rewrite absolute paths starting with /", () => {
    expect(rewriteMarkdownLinks("[text](/Public/note.md)", "Public")).toBe("[text](/Public/note.md)");
  });

  it("does not rewrite fragment-only links", () => {
    expect(rewriteMarkdownLinks("[text](#section)", "Public")).toBe("[text](#section)");
  });

  it("does not rewrite links outside rootDir", () => {
    expect(rewriteMarkdownLinks("[text](Other/note.md)", "Public")).toBe("[text](Other/note.md)");
  });

  it("rewrites multiple markdown links", () => {
    const content = "[a](Public/a.md) and [b](Public/b.md)";
    expect(rewriteMarkdownLinks(content, "Public")).toBe("[a](a.md) and [b](b.md)");
  });

  it("does not rewrite mailto links", () => {
    expect(rewriteMarkdownLinks("[email](mailto:user@example.com)", "Public")).toBe(
      "[email](mailto:user@example.com)"
    );
  });

  it("does not rewrite ftp links", () => {
    expect(rewriteMarkdownLinks("[file](ftp://example.com/Public/file)", "Public")).toBe(
      "[file](ftp://example.com/Public/file)"
    );
  });
});

describe("rewriteBaseQueryPaths", () => {
  it("returns content unchanged when no rootDir", () => {
    const content = '```base\npath contains "Public/Archive"\n```';
    expect(rewriteBaseQueryPaths(content, "")).toBe(content);
  });

  it("strips rootDir from double-quoted path in base block", () => {
    const content = '```base\npath contains "Public/Archive"\n```';
    const expected = '```base\npath contains "Archive"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });

  it("strips rootDir from single-quoted path in base block", () => {
    const content = "```base\npath contains 'Public/Archive'\n```";
    const expected = "```base\npath contains 'Archive'\n```";
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });

  it("strips rootDir from exact path literal", () => {
    const content = '```base\npath = "Public/Archive/note.md"\n```';
    const expected = '```base\npath = "Archive/note.md"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });

  it("does not rewrite paths outside base blocks", () => {
    const content = 'Some text "Public/Archive/note.md" here.';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(content);
  });

  it("does not rewrite paths that don't start with rootDir", () => {
    const content = '```base\npath contains "Other/Archive"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(content);
  });

  it("rewrites multiple quoted paths in one base block", () => {
    const content = '```base\npath contains "Public/a" OR path contains "Public/b"\n```';
    const expected = '```base\npath contains "a" OR path contains "b"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });

  it("handles multiple base blocks in document", () => {
    const content = '```base\npath = "Public/a"\n```\n\nText\n\n```base\npath = "Public/b"\n```';
    const expected = '```base\npath = "a"\n```\n\nText\n\n```base\npath = "b"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });

  it("does not touch non-base fenced blocks", () => {
    const content = '```sql\npath contains "Public/Archive"\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(content);
  });

  it("rewrites inFolder call with exact rootDir value to empty string", () => {
    const content = '```base\nfile.inFolder("Public")\n```';
    const expected = '```base\nfile.inFolder("")\n```';
    expect(rewriteBaseQueryPaths(content, "Public")).toBe(expected);
  });
});

describe("rewriteFrontmatterPaths", () => {
  it("returns content unchanged when no rootDir", () => {
    const content = "---\ncover: Public/Assets/hero.jpg\n---\n# Title";
    expect(rewriteFrontmatterPaths(content, "")).toBe(content);
  });

  it("strips rootDir from bare YAML value", () => {
    const content = "---\ncover: Public/Assets/hero.jpg\n---\n# Title";
    const expected = "---\ncover: Assets/hero.jpg\n---\n# Title";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(expected);
  });

  it("strips rootDir from double-quoted YAML value", () => {
    const content = '---\ncover: "Public/Assets/hero.jpg"\n---';
    const expected = '---\ncover: "Assets/hero.jpg"\n---';
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(expected);
  });

  it("strips rootDir from single-quoted YAML value", () => {
    const content = "---\ncover: 'Public/Assets/hero.jpg'\n---";
    const expected = "---\ncover: 'Assets/hero.jpg'\n---";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(expected);
  });

  it("does not rewrite non-path YAML values", () => {
    const content = "---\ntitle: My Note\ntags: [public, archive]\n---";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(content);
  });

  it("does not rewrite paths in document body", () => {
    const content = "---\ntitle: Title\n---\ncover: Public/Assets/hero.jpg";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(content);
  });

  it("does not rewrite if no frontmatter present", () => {
    const content = "# Title\ncover: Public/Assets/hero.jpg";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(content);
  });

  it("rewrites multiple path values in frontmatter", () => {
    const content = "---\ncover: Public/Assets/hero.jpg\nthumbnail: Public/Assets/thumb.png\n---";
    const expected = "---\ncover: Assets/hero.jpg\nthumbnail: Assets/thumb.png\n---";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(expected);
  });

  it("handles rootDir with slashes", () => {
    const content = "---\ncover: Public/Assets/hero.jpg\n---";
    expect(rewriteFrontmatterPaths(content, "/Public/")).toBe("---\ncover: Assets/hero.jpg\n---");
  });

  it("handles $ characters in rewritten value without corruption", () => {
    const content = "---\ncover: Public/cost$&report.jpg\n---\n# Body";
    const expected = "---\ncover: cost$&report.jpg\n---\n# Body";
    expect(rewriteFrontmatterPaths(content, "Public")).toBe(expected);
  });
});

describe("rewriteRootDirPaths", () => {
  it("returns content unchanged when no rootDir", () => {
    const content = "[[Public/note]] ![[Public/img.png]] [t](Public/n.md)";
    expect(rewriteRootDirPaths(content, "")).toBe(content);
  });

  it("applies all rewriters in one call", () => {
    const content = [
      "---",
      "cover: Public/Assets/hero.jpg",
      "---",
      "[[Public/Archive/note]]",
      "![[Public/Assets/img.png]]",
      "[link](Public/Archive/doc.md)",
      "```base",
      'path contains "Public/Archive"',
      "```",
    ].join("\n");

    const expected = [
      "---",
      "cover: Assets/hero.jpg",
      "---",
      "[[Archive/note]]",
      "![[Assets/img.png]]",
      "[link](Archive/doc.md)",
      "```base",
      'path contains "Archive"',
      "```",
    ].join("\n");

    expect(rewriteRootDirPaths(content, "Public")).toBe(expected);
  });
});
