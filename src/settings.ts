export const DEFAULT_SETTINGS: IFlowershowSettings = {
  flowershowToken: "",
  siteName: "",
  excludePatterns: ["\\.excalidraw(\\.(md|excalidraw))?$"],
};

export interface IFlowershowSettings {
  flowershowToken: string; // Flowershow PAT token (fs_pat_...)
  siteName: string; // Project/site name
  excludePatterns: string[]; // Array of regex patterns to exclude files/folders
}

// API URL from environment (set at build time via esbuild define)
export const API_URL = process.env.FLOWERSHOW_API_URL!;
