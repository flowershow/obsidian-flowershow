export const DEFAULT_SETTINGS: IFlowershowSettings = {
  flowershowToken: "",
  siteName: "",
  excludePatterns: ["\\.excalidraw(\\.(md|excalidraw))?$"],
  lastSeenVersion: "",
};

export interface IFlowershowSettings {
  flowershowToken: string; // Flowershow PAT token (fs_pat_...)
  siteName: string; // Project/site name
  excludePatterns: string[]; // Array of regex patterns to exclude files/folders
  lastSeenVersion: string; // Last version user has seen (for update notifications)
}

// API URL from environment (set at build time via esbuild define)
export const API_URL = process.env.FLOWERSHOW_API_URL!;
