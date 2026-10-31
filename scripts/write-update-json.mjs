// Writes update.json for the rolling `continuous` prerelease — the
// manifest installed APKs poll (lib/app-update.ts) to learn that a
// newer signed build exists. Run by android-release.yml on main
// pushes. Env in: VERSION_CODE, VERSION_NAME, APK_ASSET,
// GITHUB_REPOSITORY.
//
// apkUrl points at the never-re-uploaded versioned asset
// (APK_ASSET, e.g. nibrastube-123.apk), NOT the fixed nibrastube.apk
// — the fixed name gets deleted+re-uploaded every publish, and phones
// fetching it mid-publish got a 404 page/truncated file ("problem
// parsing the package"). update.json itself is uploaded LAST, after
// the APK bytes — it's the commit point of the publish.

import { writeFileSync } from "node:fs";

const versionCode = Number(process.env.VERSION_CODE);
const versionName = process.env.VERSION_NAME;
const apkAsset = process.env.APK_ASSET;
const repo = process.env.GITHUB_REPOSITORY;

if (!Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error(`bad VERSION_CODE: ${process.env.VERSION_CODE}`);
}
if (!versionName) throw new Error("VERSION_NAME is required");
if (!apkAsset) throw new Error("APK_ASSET is required");
if (!repo) throw new Error("GITHUB_REPOSITORY is required");

const releases = `https://github.com/${repo}/releases`;
const manifest = {
  versionCode,
  versionName,
  apkUrl: `${releases}/download/continuous/${apkAsset}`,
  releaseUrl: `${releases}/tag/continuous`,
  publishedAt: new Date().toISOString(),
};

writeFileSync("update.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`update.json: versionCode=${versionCode} ${versionName}`);
