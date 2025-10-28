import { App, Notice, TFile } from "obsidian";
import { IFlowershowSettings } from "./settings";
import { Octokit } from "@octokit/rest";
import { validatePublishFrontmatter, validateSettings } from "./Validator";
import { detectGitAlgoFromSha, FlowershowError, gitBlobOidFromBinary, gitBlobOidFromText, isPlainTextExtension } from "./utils";
import PublishStatusBar from "./PublishStatusBar";
import { slug } from "github-slugger";

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
    private octokit: Octokit;

    constructor(app: App, settings: IFlowershowSettings, publishStatusBar: PublishStatusBar) {
        this.app = app;
        this.settings = settings;
        this.publishStatusBar = publishStatusBar;
        this.octokit = new Octokit({
          auth: this.settings.githubToken,
          request: {
            // Force fresh network fetches
            fetch: (url: any, options: any) =>
              fetch(url, { ...options, cache: "no-store" }),
            // and disable ETag conditional requests
            // (Octokit won’t add If-None-Match if you pass an empty one)
            // You can also set this per-call instead of globally.
            // headers: { 'If-None-Match': '' } // optional global default
          }
         });
    }

  /** ---------- Public API ---------- */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!validateSettings(this.settings)) {
      return {
        success: false,
        message: "Please fill in all GitHub settings (username, repository, token, branch).",
      };
    }

    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;
    const branch = this.settings.branch?.trim() || "main";

    try {
      // Repo exists & we can read it
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });

      // Check push permission
      const canPush =
        repoData.permissions?.push ||
        repoData.permissions?.admin ||
        repoData.permissions?.maintain;
      if (!canPush) {
        return {
          success: false,
          message: "Connected, but you don't have write access to this repository.",
        };
      }

      // Branch exists
      await this.octokit.repos.getBranch({ owner, repo, branch });

      return {
        success: true,
        message: `Connected. Repo "${owner}/${repo}" and branch "${branch}" are accessible with write permission.`,
      };
    } catch (error: any) {
      const status = error?.status;
      if (status === 404)
        return { success: false, message: "Repository or branch not found." };
      if (status === 401)
        return { success: false, message: "Authentication failed. Check your token." };
      if (status === 403)
        return {
          success: false,
          message:
            "Access denied (403). Check repository permissions or token scopes (need 'repo').",
        };
      return { success: false, message: `Connection failed: ${error?.message ?? error}` };
    }
  }

  
  /** Publish any file */
  async publishFile(file: TFile) {
    const cachedFile = this.app.metadataCache.getCache(file.path)
    if (!cachedFile) {
      throw new FlowershowError(`Note file ${file.path} not found!`)
    }

    if (file.extension === "md" || file.extension === "mdx") {
      const frontmatter = cachedFile.frontmatter

      if (frontmatter && !validatePublishFrontmatter(frontmatter)) {
          throw new FlowershowError("Can't publish note with `publish: false`")
      }

      const markdown = await this.app.vault.cachedRead(file);
      await this.uploadToGithub(file.path, Buffer.from(markdown).toString('base64'))
    } else if (file.extension === "json" || file.extension === "css" || file.extension === "yaml" || file.extension === "yml") {
      const content = await this.app.vault.cachedRead(file);
      await this.uploadToGithub(file.path, Buffer.from(content).toString('base64'))
    } else {
      const content = await this.app.vault.readBinary(file);
      await this.uploadToGithub(file.path, Buffer.from(content).toString('base64'))
    }
  }


    /**
     * Publish note and optionally its embeds by creating a PR
     * @returns PR information including branch name, PR number, URL and merge status
     */
    async publishNote(file: TFile, withEmbeds = true): Promise<{ branch: string; prNumber: number; prUrl: string; merged: boolean }> {
      const cachedFile = this.app.metadataCache.getCache(file.path)
      if (!cachedFile) {
        throw new FlowershowError(`Note file ${file.path} not found!`)
      }

      const frontmatter = cachedFile.frontmatter

      if (frontmatter && !validatePublishFrontmatter(frontmatter)) {
          throw new FlowershowError("Can't publish note with `publish: false`")
      }

      const filesToPublish: TFile[] = [file];

      // Check frontmatter for image and avatar fields with wikilinks
      if (frontmatter) {
        const imageFields = ['image', 'avatar'];
        const wikilinkRegex = /^\[\[([^\]]+)\]\]$/;
        
        for (const field of imageFields) {
          if (typeof frontmatter[field] === 'string') {
            const match = frontmatter[field].match(wikilinkRegex);
            if (match) {
              const link = match[1]; // Get the content between [[]]
              const imageFile = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
              if (imageFile && !filesToPublish.some(f => f.path === imageFile.path)) {
                filesToPublish.push(imageFile);
              }
            }
          }
        }
      }

      if (withEmbeds) {
        // Track unique embeds for this publish run
        const uniqueEmbeds = new Map<string, TFile>();
        
        // First collect unique embeds
        const markdown = await this.app.vault.read(file);
        cachedFile.embeds?.forEach(embed => {
          const embedTFile = this.app.metadataCache.getFirstLinkpathDest(embed.link, markdown);
          if (embedTFile && !uniqueEmbeds.has(embedTFile.path)) {
            uniqueEmbeds.set(embedTFile.path, embedTFile);
          }
        });

        // Add embeds to files to publish
        filesToPublish.push(...uniqueEmbeds.values());
      }

      // Create PR with all files
      return await this.publishBatch({
        filesToPublish,
        branchNameHint: `publish-${slug(file.name)}`
      });
    }

    async unpublishFile(notePath: string) {
        await this.deleteFromGithub(notePath);
        // TODO what about embeds that are not used elsewhere?
    }

    async getPublishStatus(): Promise<PublishStatus> {
        const unchangedFiles: Array<TFile> = []; // published and unchanged files in vault
        const changedFiles: Array<TFile> = []; // published and changed files in vault
        const deletedFiles: Array<string> = []; // published but deleted files from vault
        const newFiles: Array<TFile> = []; // new, not yet published files

        const remoteFileHashes = await this.getRemoteFileHashes();
        // console.log({remoteFileHashes})
        
        const localFiles = this.app.vault.getFiles();
        // console.log({localFiles})
        
        const seenRemoteFiles = new Set<string>();
        const algo = detectGitAlgoFromSha(remoteFileHashes[0])
        
        // Find new and changed files
        for (const file of localFiles) {
            const normalizedPath = this.normalizePath(file.path);

            // Check if file matches any exclude pattern
            if (this.settings.excludePatterns?.some(pattern => {
                try {
                    const regex = new RegExp(pattern);
                    return regex.test(normalizedPath);
                } catch (e) {
                    console.error(`Invalid regex pattern: ${pattern}`, e);
                    return false;
                }
            })) {
                continue; // Skip excluded files
            }

            const remoteHash = remoteFileHashes[normalizedPath];
            
            if (!remoteHash) {
                // File exists locally but not remotely
                newFiles.push(file);
                continue;
            }
            
            // Mark this remote file as seen
            seenRemoteFiles.add(normalizedPath);
            
            let localOid: string;
            if (isPlainTextExtension(file.extension)) {
              const text = await this.app.vault.cachedRead(file); // string
              localOid = await gitBlobOidFromText(text, algo);
            } else {
              const bytes = await this.app.vault.readBinary(file); // Uint8Array
              localOid = await gitBlobOidFromBinary(bytes, algo);
            }

            // console.log({file: file.path, localOid, remoteHash})
            // Compare hashes to determine if file has changed
            if (localOid === remoteHash) {
                unchangedFiles.push(file);
            } else {
                changedFiles.push(file);
            }
        }
        
        // Find deleted files (exist remotely but not locally)
        for (const [remotePath, _] of Object.entries(remoteFileHashes)) {
            if (!seenRemoteFiles.has(remotePath)) {
                deletedFiles.push(remotePath);
            }
        }

        return {unchangedFiles, changedFiles, deletedFiles, newFiles };
    }

    private normalizePath(p: string): string {
      return p.replace(/^\/+/, "");
    }

    private async getFileSha(owner: string, repo: string, path: string): Promise<string | null> {
      const octo = this.octokit;
      try {
        const res = await octo.rest.repos.getContent({
          owner,
          repo,
          path: this.normalizePath(path),
          ref: this.settings.branch,
          headers: {
            'If-None-Match': ''
          }
         })
        // If it's a file, return its sha; if directory/array, treat as missing for single-file ops
        return Array.isArray(res.data) ? null : (res.data.type === "file" ? res.data.sha ?? null : null);
      } catch (e: any) {
        if (e?.status === 404) return null;
        console.error({e})
        throw e;
      }
    }

  /**
   * Publish/delete multiple files on a new branch, commit each change separately,
   * open a PR, and optionally auto-merge.
   */
  async publishBatch(opts: {
    filesToPublish?: TFile[];
    filesToDelete?: string[];
    branchNameHint?: string; // optional custom branch name, note: needs to be a valid ref, so e.g. no special signs or spaces
  }): Promise<{ branch: string; prNumber: number; prUrl: string; merged: boolean }> {
    if (!validateSettings(this.settings)) {
      throw new FlowershowError("Invalid Flowershow GitHub settings");
    }

    if (!opts.filesToPublish?.length && !opts.filesToDelete?.length) {
      throw new FlowershowError("No files to delete or publish provided")
    }

    this.publishStatusBar.start({
      publishTotal: opts.filesToPublish?.length,
      deleteTotal: opts.filesToDelete?.length
    })

    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;
    const baseBranch = (this.settings.branch?.trim() || "main");

    const workBranch = await this.createWorkingBranch(baseBranch, opts.branchNameHint);

    const filesToPublish = opts.filesToPublish ?? [];
    const filesToDelete = opts.filesToDelete ?? [];

    // One commit per file: PUSH
    for (const file of filesToPublish) {
      const normalizedPath = this.normalizePath(file.path);
      
      // Skip excluded files
      if (this.settings.excludePatterns?.some(pattern => {
        try {
          const regex = new RegExp(pattern);
          return regex.test(normalizedPath);
        } catch (e) {
          console.error(`Invalid regex pattern: ${pattern}`, e);
          return false;
        }
      })) {
        console.log(`Skipping excluded file: ${normalizedPath}`);
        continue;
      }

      let base64content: string;

      if (isPlainTextExtension(file.extension)) {
        const text = await this.app.vault.cachedRead(file);
        base64content = Buffer.from(text).toString("base64");
      } else {
        const bytes = await this.app.vault.readBinary(file);
        base64content = Buffer.from(bytes).toString("base64");
      }

      const filePath = this.normalizePath(file.path);
      const sha = await this.getFileShaOnBranch(filePath, workBranch);
      const committer = {
        name: this.settings.githubUserName,
        email: `${this.settings.githubUserName}@users.noreply.github.com`,
      };

      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner, repo,
        path: filePath,
        message: `PUSH: ${filePath}`,
        content: base64content,
        sha: sha ?? undefined,
        branch: workBranch,
        committer,
        author: committer,
        headers: { "If-None-Match": "" }
      });

      this.publishStatusBar.incrementPublish()

    }

    // One commit per file: DELETE
    for (const path of filesToDelete) {
      const sha = await this.getFileShaOnBranch(path, workBranch);
      if (!sha) continue; // nothing to delete

      const committer = {
        name: this.settings.githubUserName,
        email: `${this.settings.githubUserName}@users.noreply.github.com`,
      };

      await this.octokit.rest.repos.deleteFile({
        owner, repo,
        path,
        message: `DELETE: ${path}`,
        sha,
        branch: workBranch,
        committer,
        author: committer,
        headers: { "If-None-Match": "" }
      });

      this.publishStatusBar.incrementDelete()
    }

    // Compose PR info
    const title = `Flowershow: ${filesToPublish.length} push(es), ${filesToDelete.length} delete(s)`;
    const body = [
      filesToPublish.length ? `### Pushed\n${filesToPublish.map(f => `- ${this.normalizePath(f.path)}`).join("\n")}` : "",
      filesToDelete.length ? `### Deleted\n${filesToDelete.map(p => `- ${this.normalizePath(p)}`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");

    const { prNumber, prUrl, merged } = await this.createPRAndMaybeMerge({
      branch: workBranch,
      baseBranch,
      title,
      body
    });

    this.publishStatusBar.finish(5000)

    return { branch: workBranch, prNumber, prUrl, merged };
  }

  // content is base64 string
  private async uploadToGithub(path: string, content: string) {
    // console.log(`Uploading ${path}`)
    if (!validateSettings(this.settings)) throw new FlowershowError("Invalid Flowershow GitHub settings");

    const normalizedPath = this.normalizePath(path);
    
    // Check if file should be excluded
    if (this.settings.excludePatterns?.some(pattern => {
      try {
        const regex = new RegExp(pattern);
        return regex.test(normalizedPath);
      } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e);
        return false;
      }
    })) {
      throw new FlowershowError(`File ${path} matches exclude pattern and cannot be published`);
    }

    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;
    const branch = this.settings.branch?.trim() || 'main';
    const filePath = this.normalizePath(path);
    const octo = this.octokit;
    const committer = {
        name: this.settings.githubUserName,
        email: `${this.settings.githubUserName}@users.noreply.github.com`
    };

    const createOrUpdate = async () => {
      const sha = await this.getFileSha(owner, repo, filePath);
      const message = `${sha ? "Update" : "Add"} content ${filePath}`;

      await octo.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message,
        content,
        sha: sha ?? undefined,
        branch,
        committer,
        author: committer,
        headers: {
          'If-None-Match': ''
        }
      })
    }

    try {
      await createOrUpdate()
    } catch (e) {
      await new Promise(r => setTimeout(createOrUpdate, 1000));
    }
  }

  private async deleteFromGithub(path: string) {
      if (!validateSettings(this.settings)) {
          throw {}
      }

      const octokit = new Octokit({ auth: this.settings.githubToken });
      const payload = {
          owner: this.settings.githubUserName,
          repo: this.settings.githubRepo,
          path,
          message: `Delete content ${path}`,
          sha: ''
      };

      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner: this.settings.githubUserName,
          repo: this.settings.githubRepo,
          path
      });

      // Handle both single file and directory responses
      const fileData = Array.isArray(response.data) ? null : response.data;
      
      if (response.status === 200 && fileData?.type === "file") {
          payload.sha = fileData.sha;
      }

      await octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', payload);
  }

  /** Get dictionary of path->hash of all the files in the repo */
  private async getRemoteFileHashes(): Promise<PathToHashDict> {
    // Get the full tree at HEAD (recursive) and bypass caches
    const { data } = await this.octokit.rest.git.getTree({
      owner: this.settings.githubUserName,
      repo: this.settings.githubRepo,
      tree_sha: "HEAD",
      recursive: "1",
      headers: {
        // Forces GitHub to skip ETag-based caching and return fresh data
        "If-None-Match": ""
      }
    });

    const files = data.tree ?? [];

    const notes: Array<{ path: string; sha: string }> = files
      .filter((file)  => !!file && file.type === "blob" && typeof file.path === "string"
      )
      .map(({ path, sha }) => ({ path, sha }));

    const hashes: PathToHashDict = notes.reduce<PathToHashDict>((dict, note) => {
      dict[note.path] = note.sha;
      return dict;
    }, {});

    return hashes;
  }

  private async createWorkingBranch(baseBranch: string, desiredName?: string): Promise<string> {
    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;
    const octo = this.octokit;

    // Get base ref SHA
    const baseRef = await octo.rest.git.getRef({
      owner, repo, ref: `heads/${baseBranch}`,
      headers: { "If-None-Match": "" }
    }).then(r => r.data);

    // Find a unique branch name
    const baseName = desiredName || `flowershow/publish-${Date.now()}`;
    let branchName = baseName;
    let i = 1;
    while (true) {
      try {
        await octo.rest.git.getRef({ owner, repo, ref: `heads/${branchName}` });
        branchName = `${baseName}-${i++}`;
      } catch (e: any) {
        if (e?.status === 404) break; // unique
        throw e;
      }
    }

    // Create ref
    await octo.rest.git.createRef({
      owner, repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha
    });

    return branchName;
  }

  private async getFileShaOnBranch(path: string, branch: string): Promise<string | null> {
    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;
    try {
      const res = await this.octokit.rest.repos.getContent({
        owner, repo,
        path: this.normalizePath(path),
        ref: branch,
        headers: { "If-None-Match": "" }
      });

      return Array.isArray(res.data)
        ? null
        : (res.data.type === "file" ? (res.data.sha ?? null) : null);
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  private async createPRAndMaybeMerge(params: {
    branch: string;
    baseBranch: string;
    title: string;
    body?: string;
  }) {
    const owner = this.settings.githubUserName;
    const repo = this.settings.githubRepo;

    // Create PR
    const pr = await this.octokit.rest.pulls.create({
      owner, repo,
      head: params.branch,
      base: params.baseBranch,
      title: params.title,
      body: params.body ?? ""
    });

    const prNumber = pr.data.number;
    const prUrl = pr.data.html_url;

    if (!this.settings.autoMergePullRequests) {
      return { prNumber, prUrl, merged: false };
    }

    // Try immediate merge via REST
    try {
      const merge = await this.octokit.rest.pulls.merge({
        owner, repo,
        pull_number: prNumber,
        merge_method: "squash",
        commit_title: this.settings.mergeCommitMessage || `Merge PR #${prNumber}`
        // commit_message (body) is optional; GitHub will compose by default for squash
      });
      return { prNumber, prUrl, merged: merge.data.merged === true };
    } catch (e: any) {
      // If it can't merge yet (checks required, etc.), we *attempt* to enable auto-merge via GraphQL.
      // This requires the repo to have auto-merge enabled and the token to have permissions.
      try {
        const prNode = await this.octokit.graphql<{ repository: { pullRequest: { id: string } } }>(
          `
          query($owner:String!, $repo:String!, $number:Int!) {
            repository(owner:$owner, name:$repo) {
              pullRequest(number:$number) { id }
            }
          }`,
          { owner, repo, number: prNumber }
        );

        const prId = prNode.repository.pullRequest.id;

        // Enable auto-merge (SQUASH) — fallback if REST merge fails now
        await (this.octokit as any).graphql(
          `
          mutation($prId:ID!, $title:String!) {
            enablePullRequestAutoMerge(input:{
              pullRequestId:$prId,
              mergeMethod:SQUASH,
              commitHeadline:$title
            }) { clientMutationId }
          }`,
          { prId, title: this.settings.mergeCommitMessage || `Auto-merge PR #${prNumber}` }
        );

        return { prNumber, prUrl, merged: false }; // will merge when checks pass
      } catch {
        // If enabling auto-merge fails, just return PR info.
        return { prNumber, prUrl, merged: false };
      }
    }
  }
}
