// Copies the 8th Wall engine binary into public/external/xr so Vite serves it.
//
// xr.js lazy-loads its `slam` chunk (xr-slam.js) and resources relative to its
// own URL, so the dist folder has to be served intact rather than bundled.
// The license requires the files to stay unmodified, which copying preserves.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@8thwall/engine-binary/dist");
const target = resolve(root, "public/external/xr");

if (!existsSync(source)) {
  console.error(`8th Wall engine not found at ${source}. Run \`npm install\` first.`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Copied 8th Wall engine to ${target}`);
