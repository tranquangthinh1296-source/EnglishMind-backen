/** Rebuild voice pack zips under server/public/voice-packs/.
 * Beta policy: publish Vosk only. Whisper artifacts are research-only.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");

const dir = path.join(__dirname, "../public/voice-packs");

function buildZip(manifestName, zipName) {
  const manifest = path.join(dir, manifestName);
  const zip = path.join(dir, zipName);
  if (!fs.existsSync(manifest)) {
    console.error(`missing ${manifestName}`);
    process.exit(1);
  }
  if (process.platform === "win32") {
    if (fs.existsSync(zip)) fs.unlinkSync(zip);
    execSync(
      `powershell -NoProfile -Command "` +
        `$tmp = Join-Path $env:TEMP 'vp-${zipName}'; ` +
        `New-Item -ItemType Directory -Force -Path $tmp | Out-Null; ` +
        `Copy-Item '${manifest.replace(/'/g, "''")}' (Join-Path $tmp 'manifest.json') -Force; ` +
        `Compress-Archive -Path (Join-Path $tmp 'manifest.json') -DestinationPath '${zip.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    const staging = path.join(dir, `.staging-${zipName}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.copyFileSync(manifest, path.join(staging, "manifest.json"));
    execSync(`cd "${staging}" && zip -j "${zip}" manifest.json`, { stdio: "inherit" });
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const hash = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  const size = fs.statSync(zip).size;
  console.log(`\n=== ${zipName} ===`);
  console.log(`SHA256=${hash}`);
  console.log(`SIZE_BYTES=${size}`);
  console.log(`URL=/static/voice-packs/${zipName}`);
  return { hash, size, zipName };
}

const vosk = buildZip("vosk-manifest.json", "vosk-pack-v1.zip");

console.log("\n========== Railway env (Vosk beta) ==========");
console.log("VOICE_PACK_ENABLED=true");
console.log("VOICE_PACK_VOSK_ENABLED=true");
console.log("VOICE_PACK_VOSK_PUBLIC_URL=https://englishmind-backen-production.up.railway.app/static/voice-packs/vosk-pack-v1.zip");
console.log(`VOICE_PACK_VOSK_SHA256=${vosk.hash}`);
console.log(`VOICE_PACK_VOSK_SIZE_BYTES=${vosk.size}`);
console.log("VOICE_PACK_VOSK_VERSION=v1");
console.log("VOICE_PACK_WHISPER_ENABLED=false");
