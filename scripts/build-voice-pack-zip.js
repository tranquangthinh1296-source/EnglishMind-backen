/** Rebuild server/public/voice-packs/voice-pack-v1.zip from manifest.json */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");

const dir = path.join(__dirname, "../public/voice-packs");
const manifest = path.join(dir, "manifest.json");
const zip = path.join(dir, "voice-pack-v1.zip");

if (!fs.existsSync(manifest)) {
  console.error("missing manifest.json");
  process.exit(1);
}

if (process.platform === "win32") {
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${manifest.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" },
  );
} else {
  execSync(`zip -j "${zip}" "${manifest}"`, { stdio: "inherit" });
}

const hash = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
const size = fs.statSync(zip).size;
console.log(`VOICE_PACK_SHA256=${hash}`);
console.log(`VOICE_PACK_SIZE_BYTES=${size}`);
console.log(`URL path: /static/voice-packs/voice-pack-v1.zip`);
