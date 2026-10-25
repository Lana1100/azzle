#!/usr/bin/env node
// Switch the active service to an example: `npm run use-example cb20` (or `default` to go back).
// Copies examples/<name>/service.mjs -> src/config/services/<name>.mjs, copies examples/<name>/public/* into
// public/ (never overwriting without --force), and points src/config/service.mjs at it.
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const name = process.argv[2];
const force = process.argv.includes("--force");
if (!name || !/^[a-z0-9-]+$/.test(name)) { console.error("usage: use-example <name> [--force]"); process.exit(1); }

const target = path.join(root, "src/config/services", `${name}.mjs`);
if (name !== "default") {
  const ex = path.join(root, "examples", name);
  const src = await fs.readFile(path.join(ex, "service.mjs"), "utf8").catch(() => null);
  if (!src) { console.error(`examples/${name}/service.mjs not found`); process.exit(1); }
  await fs.writeFile(target, src.replace('import("../../src/config/service-types")', 'import("../service-types")'));
  const pub = path.join(ex, "public");
  for (const f of await fs.readdir(pub).catch(() => [])) {
    const dst = path.join(root, "public", f);
    const exists = await fs.stat(dst).then(() => true, () => false);
    if (exists && !force) { console.log(`skip public/${f} (exists; --force to overwrite)`); continue; }
    await fs.copyFile(path.join(pub, f), dst);
    console.log(`public/${f}`);
  }
}
await fs.writeFile(path.join(root, "src/config/service.mjs"),
  `// The active service. Switch with \`npm run use-example <name>\` or by importing another file here.\nexport { default } from "./services/${name}.mjs";\nexport { default as service } from "./services/${name}.mjs";\n`);
console.log(`active service: src/config/services/${name}.mjs`);
