import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageMetadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
assert.equal(manifest.version, packageMetadata.version, "manifest and package versions must match");

const archive = new URL("../outputs/youtube-playlist-bookmarks.zip", import.meta.url);
const entries = execFileSync("unzip", ["-Z1", archive.pathname], { encoding: "utf8" }).trim().split("\n");
for (const required of ["manifest.json", "options.html", "popup.html", "src/background.js", "src/github-auth.js"]) {
  assert.ok(entries.includes(required), `release archive is missing ${required}`);
}
for (const forbidden of ["extension.pem", "extension.crx", ".DS_Store"]) {
  assert.ok(!entries.some((entry) => entry.endsWith(forbidden)), `release archive contains ${forbidden}`);
}

console.log(`Verified ${entries.length} packaged files for version ${manifest.version}.`);
