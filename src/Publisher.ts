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

    constructor(app: App, settings: IFlowershowSettings, publishStatusBar: PublishStatusBar) {
        this.app = app;
        this.settings = settings;
        this.publishStatusBar = publishStatusBar;
    }

    /** Get or create Octokit instance with current settings */
    private get octokit(): Octokit {
      // Always recreate to ensure we use the latest token
      return new Octokit({
        auth: this.settings.githubToken,
        request: {
          // Force fresh network fetches
          fetch: (url: any, options: any) =>
            fetch(url, { ...options, cache: "no-store" }),
          // and disable ETag conditional requests
          // (Octokit won't add If-None-Match if you pass an empty one)
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
        message:
          "Please fill in all GitHub settings (username, repository, token, branch).",
      };
    }

    const owner = this.settings.githubUserName.trim();
    const repo = this.settings.githubRepo.trim();
    const branch = this.settings.branch?.trim() || "main";
    const token = this.settings.githubToken?.trim() ?? "";
    const tokenType = getTokenType(token);

    try {
      //
      // 1. For classic tokens: check scopes via x-oauth-scopes
      //
      if (tokenType === "classic") {
        try {
          const userResp = await this.octokit.request("GET /user");
          const scopesHeader = userResp.headers["x-oauth-scopes"];
          const scopes =
            typeof scopesHeader === "string"
              ? scopesHeader
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];

          if (!scopes.includes("repo")) {
            return {
              success: false,
              message:
                "Connected, but your personal access token (classic) is missing the 'repo' scope. " +
                "Edit the token on GitHub and enable the full 'repo' scope (or create a new token).",
            };
          }
        } catch (scopeError: any) {
          // Missing read:user or other oddities – don't fail the whole test.
          console.warn("Warning: Could not verify classic token scopes:", scopeError);
        }
      }

      //
      // 2. Repo exists & user can see it
      //
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });

      // This is user-level permission (their membership), still useful feedback.
      const canPushByRole =
        repoData.permissions?.push ||
        repoData.permissions?.admin ||
        repoData.permissions?.maintain;

      if (!canPushByRole) {
        return {
          success: false,
          message:
            "Connected, but your GitHub account only has read access to this repository. " +
            "You need write (push) access on the repo itself to publish.",
        };
      }

      //
      // 3. Branch exists
      //
      await this.octokit.repos.getBranch({ owner, repo, branch });

      //
      // 4. For fine-grained tokens: *actual* write-permission probe
      //
      if (tokenType === "fine-grained") {
        const writeCheck = await checkFineGrainedWriteAccess(
          this.octokit,
          owner,
          repo,
        );

        if (!writeCheck.ok) {
          return {
            success: false,
            message: writeCheck.message ?? "Fine-grained token lacks write access.",
          };
        }
      }

      //
      // 5. Pull request visibility check (read-level, but catches obvious PR permission issues)
      //
      try {
        await this.octokit.rest.pulls.list({
          owner,
          repo,
          state: "open",
          per_page: 1,
        });
      } catch (prError: any) {
        const status = prError?.status;
        const acceptedPerms = prError?.response?.headers?.[
          "x-accepted-github-permissions"
        ] as string | undefined;

        if (status === 403) {
          if (acceptedPerms) {
            return {
              success: false,
              message:
                "Connected to the repository, but your token cannot access pull requests.\n\n" +
                `GitHub reports these required permissions: ${acceptedPerms}\n\n` +
                (tokenType === "fine-grained"
                  ? "For fine-grained tokens, make sure it has at least:\n" +
                    "- Repository: Contents (Read and write)\n" +
                    "- Repository: Metadata (Read)\n" +
                    "- Repository: Pull requests (Read and write)\n"
                  : "For classic tokens, ensure the token includes the 'repo' scope (which covers pull requests)."),
            };
          }

          return {
            success: false,
            message:
              "Connected, but unable to access pull requests (403).\n" +
              (tokenType === "fine-grained"
                ? "For fine-grained tokens, enable 'Contents' and 'Pull requests' permissions for this repo."
                : "For classic tokens, ensure the token includes the 'repo' scope."),
          };
        }

        console.warn("Warning: Could not verify pull request permissions:", prError);
      }

      //
      // 6. Success
      //
      const tokenInfo =
        tokenType === "classic"
          ? "Classic token detected."
          : tokenType === "fine-grained"
          ? "Fine-grained token detected."
          : "Token type could not be determined (non-standard prefix).";

      return {
        success: true,
        message: "Connected to the repo with required permissions."
      };
    } catch (error: any) {
      const status = error?.status;
      const acceptedPerms = error?.response?.headers?.[
        "x-accepted-github-permissions"
      ] as string | undefined;

      if (status === 404) {
        return {
          success: false,
          message:
            "Repository or branch not found. " +
            `Make sure "${owner}/${repo}" exists and the branch "${branch}" is correct.`,
        };
      }

      if (status === 401) {
        return {
          success: false,
          message:
            "Authentication failed (401). Check your personal access token and make sure it is valid.",
        };
      }

      if (status === 403) {
        if (acceptedPerms) {
          return {
            success: false,
            message:
              "Access denied (403). Your token or account is missing required permissions.\n\n" +
              `GitHub reports these required permissions: ${acceptedPerms}\n\n` +
              (tokenType === "fine-grained"
                ? "For fine-grained tokens, adjust the token to include the listed repository permissions for this repo."
                : "For classic tokens, ensure it has the 'repo' scope and access to this repository."),
          };
        }

        return {
          success: false,
          message:
            "Access denied (403). Check repository permissions and token scopes.\n" +
            (tokenType === "fine-grained"
              ? "For fine-grained tokens, make sure the repository is selected and that it has Contents (Read and write) and Pull requests permissions."
              : "For classic tokens, ensure the token includes the 'repo' scope."),
        };
      }

      return {
        success: false,
        message: `Connection failed: ${error?.message ?? String(error)}`,
      };
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

      const payload = {
          owner: this.settings.githubUserName,
          repo: this.settings.githubRepo,
          path,
          message: `Delete content ${path}`,
          sha: ''
      };

      const response = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner: this.settings.githubUserName,
          repo: this.settings.githubRepo,
          path
      });

      // Handle both single file and directory responses
      const fileData = Array.isArray(response.data) ? null : response.data;
      
      if (response.status === 200 && fileData?.type === "file") {
          payload.sha = fileData.sha;
      }

      await this.octokit.request('DELETE /repos/{owner}/{repo}/contents/{path}', payload);
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

type TokenType = "classic" | "fine-grained" | "unknown";

function getTokenType(token: string | undefined | null): TokenType {
  if (!token) return "unknown";
  const t = token.trim();
  if (t.startsWith("github_pat_")) return "fine-grained";
  if (t.startsWith("ghp_")) return "classic";
  return "unknown";
}


/**
 * For fine-grained tokens, actually probe write access by creating
 * a Git blob. This requires write permission to repo contents.
 *
 * It doesn't create commits or files in the tree – just an unreachable
 * blob object, which is harmless.
 */
async function checkFineGrainedWriteAccess(
  octokit: any,
  owner: string,
  repo: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await octokit.git.createBlob({
      owner,
      repo,
      content: "flowershow-permission-check",
      encoding: "utf-8",
    });

    // If we get here, the token could create a blob => has write to contents.
    return { ok: true };
  } catch (error: any) {
    const status = error?.status;
    const acceptedPerms = error?.response?.headers?.[
      "x-accepted-github-permissions"
    ] as string | undefined;

    if (status === 401 || status === 403) {
      let message =
        "Connected to the repository, but your fine-grained token does not have write access to repository contents.";

      if (acceptedPerms) {
        message +=
          "\n\nGitHub reports these required permissions: " +
          acceptedPerms +
          "\n\n" +
          "When editing the token, make sure it has at least:\n" +
          "- Repository: Contents (Read and write)\n" +
          "- Repository: Metadata (Read)\n";
      } else {
        message +=
          "\n\nFor fine-grained tokens, ensure that:\n" +
          "- This repository is selected in the token settings, and\n" +
          "- 'Contents' is set to 'Read and write'.";
      }

      return { ok: false, message };
    }

    // Any other error: treat as inconclusive but don't hard-fail connection.
    console.warn(
      "Warning: Could not conclusively verify write access for fine-grained token:",
      error,
    );
    return { ok: true };
  }
}