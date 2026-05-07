import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "www");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "manifest.json",
  "sw.js",
  "icons"
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  await cp(join(root, file), join(out, file), { recursive: true });
}

console.log("Prepared Capacitor web assets in www/.");
