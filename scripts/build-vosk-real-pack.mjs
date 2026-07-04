#!/usr/bin/env node
/**
 * VOSK-OPS-1 — Download Vosk small-en-us model and build vosk-pack-v1.zip for Railway static.
 * Output: server/public/voice-packs/vosk-pack-v1.zip (manifest.json + models/*)
 *
 * Usage: node server/scripts/build-vosk-real-pack.mjs [--skip-download]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public/voice-packs");
const CACHE_DIR = path.join(ROOT, ".cache");
const MODEL_URL =
  process.env.VOSK_MODEL_URL ||
  "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
const MODEL_ZIP_NAME = "vosk-model-small-en-us-0.15.zip";
const PACK_ZIP = path.join(OUT_DIR, "vosk-pack-v1.zip");
const skipDownload = process.argv.includes("--skip-download");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function downloadModel(dest) {
  console.log(`Downloading ${MODEL_URL} ...`);
  const res = await fetch(MODEL_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5_000_000) {
    throw new Error(`model zip too small (${buf.length} bytes) — check URL`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(`Saved ${dest} (${buf.length} bytes)`);
}

function extractZip(zipPath, targetDir) {
  rmrf(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`unzip -q "${zipPath}" -d "${targetDir}"`, { stdio: "inherit" });
  }
}

function findModelRoot(extractedDir) {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
  const dir = entries.find((e) => e.isDirectory() && e.name.startsWith("vosk-model"));
  if (!dir) throw new Error(`no vosk-model-* folder under ${extractedDir}`);
  const root = path.join(extractedDir, dir.name);
  for (const required of ["am", "conf"]) {
    if (!fs.existsSync(path.join(root, required))) {
      throw new Error(`invalid vosk model: missing ${required}/ under ${root}`);
    }
  }
  return root;
}

function zipStaging(stagingDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stagingDir, "*").replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`cd "${stagingDir}" && zip -r "${zipPath}" manifest.json models`, {
      stdio: "inherit",
    });
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

const modelZip = path.join(CACHE_DIR, MODEL_ZIP_NAME);
if (!skipDownload || !fs.existsSync(modelZip)) {
  await downloadModel(modelZip);
} else {
  console.log(`Using cached ${modelZip}`);
}

const extractDir = path.join(CACHE_DIR, "vosk-model-extract");
extractZip(modelZip, extractDir);
const modelRoot = findModelRoot(extractDir);

const staging = path.join(CACHE_DIR, "vosk-pack-staging");
rmrf(staging);
fs.mkdirSync(staging, { recursive: true });

const modelsDir = path.join(staging, "models");
fs.cpSync(modelRoot, modelsDir, { recursive: true });

const manifest = {
  packId: "englishmind_vosk_pack_v1",
  version: "v1",
  engine: "vosk",
  executionMode: "on_device",
  languageProfile: "en-us",
  modelSubdir: "models",
  betaStatus: "production",
  publicClaimAllowed: false,
  description: "Vosk small-en-us offline STT for EnglishMind beta.",
};
fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));

zipStaging(staging, PACK_ZIP);

const hash = sha256File(PACK_ZIP);
const size = fs.statSync(PACK_ZIP).size;
if (size < 5_000_000) {
  throw new Error(`pack zip too small (${size} bytes) — build failed`);
}

const metaPath = path.join(OUT_DIR, "vosk-pack-v1.meta.json");
fs.writeFileSync(
  metaPath,
  JSON.stringify(
    {
      sha256: hash,
      sizeBytes: size,
      builtAt: new Date().toISOString(),
      modelUrl: MODEL_URL,
      publicUrl:
        "https://englishmind-backen-production.up.railway.app/static/voice-packs/vosk-pack-v1.zip",
    },
    null,
    2,
  ),
);

console.log("\n=== vosk-pack-v1.zip (REAL MODEL) ===");
console.log(`SHA256=${hash}`);
console.log(`SIZE_BYTES=${size}`);
console.log(`SIZE_MB=${(size / (1024 * 1024)).toFixed(1)}`);
console.log(`PATH=${PACK_ZIP}`);
console.log("\n========== Railway env ==========");
console.log("VOICE_PACK_ENABLED=true");
console.log("VOICE_PACK_VOSK_ENABLED=true");
console.log("VOICE_PACK_VOSK_PUBLIC_URL=https://englishmind-backen-production.up.railway.app/static/voice-packs/vosk-pack-v1.zip");
console.log(`VOICE_PACK_VOSK_SHA256=${hash}`);
console.log(`VOICE_PACK_VOSK_SIZE_BYTES=${size}`);
console.log("VOICE_PACK_VOSK_VERSION=v1");
console.log("VOICE_PACK_WHISPER_ENABLED=false");
