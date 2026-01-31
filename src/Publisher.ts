import { App, TFile } from "obsidian";
import { IFlowershowSettings, API_URL } from "./settings";
import { validatePublishFrontmatter } from "./Validator";
import { FlowershowError, calculateFileSha, calculateTextSha } from "./utils";
import PublishStatusBar from "./PublishStatusBar";
import { FlowershowClient, FileMetadata } from "./FlowershowClient";

export interface PublishStatus {
  unchangedFiles: Array<TFile>;
  changedFiles: Array<TFile>;
  newFiles: Array<TFile>;
  deletedFiles: Array<string>;
}

export type PathToHashDict = { [key: string]: string };

export default class Publisher {
  private app: App;
  private settings: IFlowershowSettings;
  private publishStatusBar: PublishStatusBar;
  private client: FlowershowClient;
  private siteId: string | null = null;
  private username: string | null = null;

  constructor(
    app: App,
    settings: IFlowershowSettings,
    publishStatusBar: PublishStatusBar,
  ) {
    this.app = app;
    this.settings = settings;
    this.publishStatusBar = publishStatusBar;
    this.client = new FlowershowClient(API_URL, this.settings.flowershowToken);
  }

  /** Get username (cached or fetch) */
  private async getUsername(): Promise<string> {
    if (this.username) {
      return this.username;
    }
    const userInfo = await this.client.getUserInfo();
    this.username = userInfo.username!;
    return this.username;
  }

  /** Get site ID (may return null if site hasn't been created yet) */
  async getSiteId(): Promise<string | null> {
    if (this.siteId) {
      return this.siteId;
    }

    // Try to get existing site
    const username = await this.getUsername();
    const existingSite = await this.client.getSiteByName(
      username,
      this.settings.siteName,
    );

    if (existingSite) {
      this.siteId = existingSite.site.id;
      return this.siteId;
    }

    return null;
  }

  /** Get or create the site */
  private async ensureSite(): Promise<string> {
    if (this.siteId) {
      return this.siteId;
    }

    // Try to get existing site first
    const username = await this.getUsername();
    const existingSite = await this.client.getSiteByName(
      username,
      this.settings.siteName,
    );

    if (existingSite) {
      this.siteId = existingSite.site.id;
      return this.siteId;
    }

    // Create new site
    const { site } = await this.client.createSite(this.settings.siteName);
    this.siteId = site.id;
    return this.siteId;
  }

  /**
   * Publish note and optionally its embeds
   * @returns Site URL and publish status
   */
  async publishNote(
    file: TFile,
    withEmbeds = true,
  ): Promise<{
    siteUrl: string;
    filesPublished: number;
  }> {
    const cachedFile = this.app.metadataCache.getCache(file.path);
    if (!cachedFile) {
      throw new FlowershowError(`Note file ${file.path} not found!`);
    }

    const frontmatter = cachedFile.frontmatter;

    if (frontmatter && !validatePublishFrontmatter(frontmatter)) {
      throw new FlowershowError("Can't publish note with `publish: false`");
    }

    const filesToPublish: TFile[] = [file];

    // Check frontmatter for image and avatar fields with wikilinks
    if (frontmatter) {
      const imageFields = ["image", "avatar"];
      const wikilinkRegex = /^\[\[([^\]]+)\]\]$/;

      for (const field of imageFields) {
        if (typeof frontmatter[field] === "string") {
          const match = frontmatter[field].match(wikilinkRegex);
          if (match) {
            const link = match[1];
            const imageFile = this.app.metadataCache.getFirstLinkpathDest(
              link,
              file.path,
            );
            if (
              imageFile &&
              !filesToPublish.some((f) => f.path === imageFile.path)
            ) {
              filesToPublish.push(imageFile);
            }
          }
        }
      }
    }

    if (withEmbeds) {
      // Track unique embeds
      const uniqueEmbeds = new Map<string, TFile>();

      const markdown = await this.app.vault.read(file);
      cachedFile.embeds?.forEach((embed) => {
        const embedTFile = this.app.metadataCache.getFirstLinkpathDest(
          embed.link,
          markdown,
        );
        if (embedTFile && !uniqueEmbeds.has(embedTFile.path)) {
          uniqueEmbeds.set(embedTFile.path, embedTFile);
        }
      });

      filesToPublish.push(...uniqueEmbeds.values());
    }

    // Publish batch
    return await this.publishBatch({
      filesToPublish,
    });
  }

  /**
   * Publish multiple files
   */
  async publishBatch(opts: {
    filesToPublish?: TFile[];
    filesToDelete?: string[];
  }): Promise<{
    siteUrl: string;
    filesPublished: number;
  }> {
    if (!opts.filesToPublish?.length && !opts.filesToDelete?.length) {
      throw new FlowershowError("No files to delete or publish provided");
    }

    this.publishStatusBar.start({
      publishTotal: opts.filesToPublish?.length,
      deleteTotal: opts.filesToDelete?.length,
    });

    try {
      // Ensure site exists
      const siteId = await this.ensureSite();

      // Handle file deletions first if any
      if (opts.filesToDelete && opts.filesToDelete.length > 0) {
        await this.client.deleteFiles(siteId, opts.filesToDelete);
        this.publishStatusBar.incrementDelete();
      }

      // Handle file publishing
      if (opts.filesToPublish && opts.filesToPublish.length > 0) {
        // Prepare file metadata for selected files only
        const fileMetadata: FileMetadata[] = [];
        const filesToProcess = opts.filesToPublish;

        for (const file of filesToProcess) {
          const normalizedPath = this.normalizePath(file.path);

          // Calculate SHA
          let sha: string;
          if (this.isPlainTextExtension(file.extension)) {
            const text = await this.app.vault.cachedRead(file);
            sha = await calculateTextSha(text);
          } else {
            const bytes = await this.app.vault.readBinary(file);
            sha = await calculateFileSha(bytes);
          }

          fileMetadata.push({
            path: normalizedPath,
            size: file.stat.size,
            sha,
          });
        }

        // Publish specific files (doesn't affect other files)
        const publishResult = await this.client.publishFiles(
          siteId,
          fileMetadata,
        );

        // Upload files to R2
        for (const uploadInfo of publishResult.files) {
          const file = filesToProcess.find(
            (f) => this.normalizePath(f.path) === uploadInfo.path,
          );
          if (!file) continue;

          let content: ArrayBuffer | Uint8Array;
          if (this.isPlainTextExtension(file.extension)) {
            const text = await this.app.vault.cachedRead(file);
            content = new TextEncoder().encode(text);
          } else {
            const bytes = await this.app.vault.readBinary(file);
            content = bytes;
          }

          await this.client.uploadToR2(
            uploadInfo.uploadUrl,
            content,
            uploadInfo.contentType,
          );

          this.publishStatusBar.incrementPublish();
        }
      }

      this.publishStatusBar.finish(2000);

      // Get site info to return URL
      const username = await this.getUsername();
      const site = await this.client.getSiteByName(
        username,
        this.settings.siteName,
      );
      const siteUrl = site?.site.url || "";

      return {
        siteUrl,
        filesPublished:
          (opts.filesToPublish?.length || 0) +
          (opts.filesToDelete?.length || 0),
      };
    } catch (error) {
      this.publishStatusBar.finish(0);
      throw error;
    }
  }

  /** Get publish status */
  async getPublishStatus(): Promise<PublishStatus> {
    const unchangedFiles: Array<TFile> = [];
    const changedFiles: Array<TFile> = [];
    const deletedFiles: Array<string> = [];
    const newFiles: Array<TFile> = [];

    // Check if site exists without creating it
    const username = await this.getUsername();
    const existingSite = await this.client.getSiteByName(
      username,
      this.settings.siteName,
    );

    // If site doesn't exist, all local files are new
    if (!existingSite) {
      const localFiles = this.app.vault.getFiles();
      for (const file of localFiles) {
        if (!this.isExcluded(file.path)) {
          newFiles.push(file);
        }
      }
      return { unchangedFiles, changedFiles, deletedFiles, newFiles };
    }

    // Site exists, get status from server using dry-run mode
    const siteId = existingSite.site.id;
    this.siteId = siteId; // Cache it

    try {
      // Get local files
      const localFiles = this.app.vault.getFiles();
      const fileMetadata: FileMetadata[] = [];

      for (const file of localFiles) {
        if (this.isExcluded(file.path)) {
          continue;
        }

        const normalizedPath = this.normalizePath(file.path);

        let sha: string;
        if (this.isPlainTextExtension(file.extension)) {
          const text = await this.app.vault.cachedRead(file);
          sha = await calculateTextSha(text);
        } else {
          const bytes = await this.app.vault.readBinary(file);
          sha = await calculateFileSha(bytes);
        }

        fileMetadata.push({
          path: normalizedPath,
          size: file.stat.size,
          sha,
        });
      }

      // Use dry-run mode to see what would change without making any changes
      const syncResult = await this.client.syncFiles(
        siteId,
        fileMetadata,
        true,
      );

      // Categorize files
      for (const file of localFiles) {
        if (this.isExcluded(file.path)) {
          continue;
        }

        const normalizedPath = this.normalizePath(file.path);

        if (syncResult.unchanged.includes(normalizedPath)) {
          unchangedFiles.push(file);
        } else if (syncResult.toUpdate.some((u) => u.path === normalizedPath)) {
          changedFiles.push(file);
        } else if (syncResult.toUpload.some((u) => u.path === normalizedPath)) {
          newFiles.push(file);
        }
      }

      deletedFiles.push(...syncResult.deleted);
    } catch (error) {
      console.error("Error getting publish status:", error);
      // On error, treat all files as new
      const errorLocalFiles = this.app.vault.getFiles();
      for (const file of errorLocalFiles) {
        if (!this.isExcluded(file.path)) {
          newFiles.push(file);
        }
      }
    }

    return { unchangedFiles, changedFiles, deletedFiles, newFiles };
  }

  private normalizePath(p: string): string {
    let normalizedPath = p.replace(/^\/+/, "");

    // If rootDir is set, strip it from the path
    if (this.settings.rootDir) {
      const rootDirNormalized = this.settings.rootDir.replace(/^\/+|\/+$/g, "");
      if (normalizedPath.startsWith(rootDirNormalized + "/")) {
        normalizedPath = normalizedPath.slice(rootDirNormalized.length + 1);
      } else if (normalizedPath === rootDirNormalized) {
        normalizedPath = "";
      }
    }

    return normalizedPath;
  }

  private isWithinRootDir(path: string): boolean {
    // If no rootDir is set, all files are included
    if (!this.settings.rootDir) {
      return true;
    }

    const rootDirNormalized = this.settings.rootDir.replace(/^\/+|\/+$/g, "");
    const pathNormalized = path.replace(/^\/+/, "");

    // Check if path starts with rootDir
    return (
      pathNormalized.startsWith(rootDirNormalized + "/") ||
      pathNormalized === rootDirNormalized
    );
  }

  private isPlainTextExtension(ext: string): boolean {
    const plainTextExtensions = [
      "md",
      "mdx",
      "txt",
      "json",
      "yaml",
      "yml",
      "css",
      "js",
      "ts",
      "html",
      "xml",
      "csv",
      "tsv",
    ];
    return plainTextExtensions.includes(ext.toLowerCase());
  }

  private isExcluded(path: string): boolean {
    // First check if file is within rootDir
    if (!this.isWithinRootDir(path)) {
      return true;
    }

    // Then check exclude patterns
    return this.settings.excludePatterns?.some((pattern) => {
      try {
        const regex = new RegExp(pattern);
        return regex.test(path);
      } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e);
        return false;
      }
    });
  }
}
