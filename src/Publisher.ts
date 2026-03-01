import { App, Notice, TFile } from "obsidian";
import { IFlowershowSettings, API_URL } from "./settings";
import {
  FlowershowError,
  calculateFileSha,
  calculateTextSha,
  isPlainTextExtension,
} from "./utils";
import { FlowershowClient, FileMetadata } from "./FlowershowClient";
import {
  normalizePath,
  shouldSkipFile,
  validatePublishFrontmatter,
} from "./utils/publisherHelpers";

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
  private client: FlowershowClient;
  private siteId: string | null = null;
  private username: string | null = null;

  constructor(app: App, settings: IFlowershowSettings) {
    this.app = app;
    this.settings = settings;
    this.client = new FlowershowClient(API_URL, this.settings.flowershowToken);
  }

  /** Get site name, defaulting to vault name if not set */
  getSiteName(): string {
    return this.settings.siteName || this.app.vault.getName();
  }

  /** Get username */
  private async getUsername(): Promise<string> {
    // (cached)
    if (this.username) {
      return this.username;
    }
    const userInfo = await this.client.getUserInfo();
    this.username = userInfo.username!;
    return this.username;
  }

  /** Get site ID (may return null if site hasn't been created yet) */
  async getSiteId(): Promise<string | null> {
    // (cached)
    if (this.siteId) {
      return this.siteId;
    }

    // Try to get existing site
    const username = await this.getUsername();
    const existingSite = await this.client.getSiteByName(
      username,
      this.getSiteName(),
    );

    if (existingSite) {
      this.siteId = existingSite.site.id;
      return this.siteId;
    }

    return null;
  }

  /** Get or create the site */
  private async ensureSite(): Promise<string> {
    const existingSiteId = await this.getSiteId();
    if (existingSiteId) {
      return existingSiteId;
    }

    // Create new site
    const { site } = await this.client.createSite(this.getSiteName());
    this.siteId = site.id;
    return this.siteId;
  }

  /**
   * Publish note and optionally its embeds
   * @returns Site URL and publish status
   */
  async publishSingleNoteWithEmbeds(
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

    const totalPublish = opts.filesToPublish?.length ?? 0;
    const totalDelete = opts.filesToDelete?.length ?? 0;
    const total = totalPublish + totalDelete;
    let done = 0;

    const label = totalPublish > 0 ? "Publishing" : "Unpublishing";
    const progress = new Notice(`⌛ ${label} (0/${total})...`, 0);

    try {
      // Ensure site exists
      const siteId = await this.ensureSite();

      // Handle file deletions first if any
      if (opts.filesToDelete && opts.filesToDelete.length > 0) {
        // Normalize paths before deletion
        const normalizedPathsToDelete = opts.filesToDelete.map((path) =>
          normalizePath(path, this.settings.rootDir),
        );

        const deleteResult = await this.client.deleteFiles(
          siteId,
          normalizedPathsToDelete,
        );

        // Check if any files were not found
        if (deleteResult.notFound.length > 0) {
          throw new FlowershowError(
            `Failed to delete ${
              deleteResult.notFound.length
            } file(s): ${deleteResult.notFound.join(
              ", ",
            )}. Files not found on server.`,
          );
        }

        done += totalDelete;
        progress.setMessage(`⌛ ${label} (${done}/${total})...`);
      }

      // Handle file publishing
      if (opts.filesToPublish && opts.filesToPublish.length > 0) {
        // Prepare file metadata for selected files only
        const fileMetadata: FileMetadata[] = [];
        const filesToProcess = opts.filesToPublish;

        for (const file of filesToProcess) {
          const normalizedPath = normalizePath(
            file.path,
            this.settings.rootDir,
          );

          // Calculate SHA
          let sha: string;
          if (isPlainTextExtension(file.extension)) {
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
            (f) =>
              normalizePath(f.path, this.settings.rootDir) === uploadInfo.path,
          );
          if (!file) continue;

          let content: ArrayBuffer | Uint8Array;
          if (isPlainTextExtension(file.extension)) {
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

          done++;
          progress.setMessage(`⌛ ${label} (${done}/${total})...`);
        }
      }

      progress.hide();

      // Get site info to return URL
      const username = await this.getUsername();
      const site = await this.client.getSiteByName(
        username,
        this.getSiteName(),
      );
      const siteUrl = site?.site.url || "";

      return {
        siteUrl,
        filesPublished:
          (opts.filesToPublish?.length || 0) +
          (opts.filesToDelete?.length || 0),
      };
    } catch (error) {
      progress.hide();
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
      this.getSiteName(),
    );

    // If site doesn't exist, all local files are new
    if (!existingSite) {
      const localFiles = this.app.vault.getFiles();
      for (const file of localFiles) {
        if (
          !shouldSkipFile(
            file,
            this.app,
            this.settings.rootDir,
            this.settings.excludePatterns,
          )
        ) {
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
        if (
          shouldSkipFile(
            file,
            this.app,
            this.settings.rootDir,
            this.settings.excludePatterns,
          )
        ) {
          continue;
        }

        const normalizedPath = normalizePath(file.path, this.settings.rootDir);

        let sha: string;
        if (isPlainTextExtension(file.extension)) {
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
        if (
          shouldSkipFile(
            file,
            this.app,
            this.settings.rootDir,
            this.settings.excludePatterns,
          )
        ) {
          continue;
        }

        const normalizedPath = normalizePath(file.path, this.settings.rootDir);

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
        if (
          !shouldSkipFile(
            file,
            this.app,
            this.settings.rootDir,
            this.settings.excludePatterns,
          )
        ) {
          newFiles.push(file);
        }
      }
    }

    return { unchangedFiles, changedFiles, deletedFiles, newFiles };
  }
}
