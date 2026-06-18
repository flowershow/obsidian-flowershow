import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
    },
  },
  // esbuild replaces these at build time; vitest needs the same substitution
  // so modules that read process.env.FLOWERSHOW_API_URL at load time work.
  define: {
    "process.env.FLOWERSHOW_API_URL": JSON.stringify(
      "https://test.flowershow.app",
    ),
    "process.env.FLOWERSHOW_PLUGIN_VERSION": JSON.stringify("test"),
  },
});
