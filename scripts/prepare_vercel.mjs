// Package the complete local assets rather than deploying Git-ignored SOGs
// through a source upload. Only the static build is published to Vercel.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const required = ["chop_suey.sog", "chop_suey_50.sog", "chop_suey_25.sog"];
for (const file of required) {
  const path = resolve(root, "public", file);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing public/${file}. Restore the scene assets before deploying.`);
}

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
const dist = resolve(root, "dist");
for (const file of [...required, "ar.html", "memory.html", "external/xr/xr.js", "external/xr/xr-slam.js", "external/xr/LICENSE"]) {
  if (!existsSync(resolve(dist, file))) throw new Error(`Build is missing ${file}`);
}

const output = resolve(root, ".vercel/output");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(dist, resolve(output, "static"), { recursive: true });
writeFileSync(resolve(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [{ src: "^/$", dest: "/ar.html" }, { handle: "filesystem" }],
}, null, 2) + "\n");
console.log("Prepared .vercel/output with the AR landing page, previews, photographs, SOGs, and tracking engine.");
