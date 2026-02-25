import { readFileSync, writeFileSync } from "fs";

// Read version from package.json (changeset version updates package.json directly,
// so we read from there rather than relying on the npm_package_version env var)
const { version: targetVersion } = JSON.parse(readFileSync("package.json", "utf8"));

let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

console.log(`Updated manifest.json and versions.json to version ${targetVersion}`);
