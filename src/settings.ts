export const DEFAULT_SETTINGS: IFlowershowSettings = {
  githubRepo: "",
  githubToken: "",
  githubUserName: "",
  branch: "main",
  autoMergePullRequests: true,
  mergeCommitMessage: "Merge content updates",
  excludePatterns: ["\.excalidraw(\.(md|excalidraw))?$"],
};

export interface IFlowershowSettings {
  githubToken: string;
  githubRepo: string;
  githubUserName: string;
  branch: string;
  autoMergePullRequests: boolean;
  mergeCommitMessage: string;
  excludePatterns: string[]; // Array of regex patterns to exclude files/folders
}
