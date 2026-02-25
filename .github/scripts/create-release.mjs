import { execSync } from "child_process";
import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

// Check if this tag already exists to avoid duplicate releases on non-version commits
try {
  execSync(`git rev-parse ${version}`, { stdio: "ignore" });
  console.log(`Tag ${version} already exists, nothing to release`);
  process.exit(0);
} catch {
  // Tag doesn't exist, proceed with release
}

// Create and push git tag
execSync(`git tag ${version}`);
execSync(`git push origin ${version}`);

// Create draft GitHub release with build artifacts
execSync(
  `gh release create "${version}" --title="${version}" --draft main.js manifest.json styles.css`,
  { stdio: "inherit" }
);

console.log(`Released version ${version}`);
