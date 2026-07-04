#!/usr/bin/env node
/**
 * Publish debug APK + manifest for in-app beta OTA.
 * Usage:
 *   node server/scripts/publish-app-update.mjs
 *   node server/scripts/publish-app-update.mjs --apk path/to.apk --notes "Fix quota"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const defaultApk = path.join(root, "app/build/outputs/apk/debug/app-debug.apk");
const outDir = path.join(root, "server/public/app");
const outApk = path.join(outDir, "app-debug.apk");
const outManifest = path.join(outDir, "manifest.json");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readAppVersion() {
  const propsFile = path.join(root, "app/version.properties");
  if (!fs.existsSync(propsFile)) {
    throw new Error("Missing app/version.properties");
  }
  const text = fs.readFileSync(propsFile, "utf8");
  const code = text.match(/^VERSION_CODE=(\d+)/m)?.[1];
  const base = text.match(/^VERSION_NAME_BASE=(.+)$/m)?.[1]?.trim();
  if (!code || !base) throw new Error("Cannot parse VERSION_CODE / VERSION_NAME_BASE from app/version.properties");
  return { versionCode: Number(code), versionName: `${base}.${code}` };
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

const sourceApk = path.resolve(root, arg("--apk", defaultApk));
const releaseNotes = arg("--notes", "Beta debug build");
const forceUpdate = process.argv.includes("--force");

if (!fs.existsSync(sourceApk)) {
  console.error(`APK not found: ${sourceApk}`);
  console.error("Run .\\scripts\\build-beta.ps1 first.");
  process.exit(1);
}

const { versionCode, versionName } = readAppVersion();
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(sourceApk, outApk);
const sha256 = sha256File(outApk);
const sizeBytes = fs.statSync(outApk).size;

const manifest = {
  versionCode,
  versionName,
  apkUrl: "/static/app/app-debug.apk",
  sha256,
  sizeBytes,
  forceUpdate,
  releaseNotes,
};

fs.writeFileSync(outManifest, JSON.stringify(manifest, null, 2) + "\n");

console.log("Published beta OTA:");
console.log(`  versionCode: ${versionCode}`);
console.log(`  versionName: ${versionName}`);
console.log(`  sha256: ${sha256}`);
console.log(`  sizeBytes: ${sizeBytes}`);
console.log(`  apk: ${outApk}`);
console.log(`  manifest: ${outManifest}`);
console.log("");
console.log("Deploy server/ to Railway, then open app — update dialog should appear if versionCode > installed.");
