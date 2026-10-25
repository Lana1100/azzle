#!/usr/bin/env node
// Secret / leak scan over the repo (skips node_modules, .next, data, jobs and binaries). Exit 1 on any finding.
// Looks for: 64-hex private keys / 32-byte secrets, common token formats, private key blocks, filled-in env
// assignments, and private machine paths. Known public 32-byte constants (pool ids, event topics, storage-slot
// math) are allowlisted by value below, each with the reason it is public.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data", "jobs", ".vercel", "out"]);
const SKIP_FILES = new Set(["package-lock.json", "tools/leak-scan.mjs"]);
const BIN = /\.(tsbuildinfo|png|jpe?g|webp|gif|ico|mp4|webm|woff2?|ttf|otf|pdf|tgz|zip)$/i;

// Public 32-byte values that legitimately appear in source.
const ALLOW = new Map([
  // filled in below from the pinned manifests (contract addresses are 20 bytes, so only hashes land here)
]);
const ALLOW_FILE_PATTERNS = [
  // the Uniswap v4 AZL pool id is public on-chain data
  { file: /src\/lib\/swap-core\.mjs$/, re: /AZL_POOL_ID/ },
];

const RULES = [
  { name: "64-hex secret (private key / 32-byte token)", re: /\b0x[0-9a-fA-F]{64}\b/g },
  { name: "bare 64-hex string", re: /(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: "Vercel token / blob token", re: /\bvercel_blob_rw_[A-Za-z0-9]{10,}\b|\bvc[pk]_[A-Za-z0-9]{20,}\b/g },
  { name: "Resend key", re: /\bre_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}\b/g },
  { name: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "Stripe / OpenAI style key", re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: "Privy app secret", re: /\bprivy_app_secret_[A-Za-z0-9]{10,}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "mnemonic-ish 12+ word seed", re: /\b(seed|mnemonic)\b\s*[:=]\s*["'][a-z]+( [a-z]+){11,}["']/gi },
  { name: "private machine path", re: /\/home\/box\/agent-data|\/cursor\/stores\/|secrets\/azzle-wallet/g },
  { name: "filled-in secret env assignment", re: /^\s*(OPS_TOKEN|CRON_SECRET|RESEND_API_KEY|BLOB_READ_WRITE_TOKEN|S3_SECRET_ACCESS_KEY|S3_ACCESS_KEY_ID|NOTIFY_WEBHOOK_SECRET|GITHUB_TOKEN|PRIVATE_KEY)[ \t]*=[ \t]*[^\s#]+/gm },
];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p);
    else if (!BIN.test(e.name)) yield p;
  }
}

// Public topic hashes / pool ids from the pinned manifests count as public.
for (const f of ["src/config/base-8453-micro-v2-pinned.json", "src/config/base-8453-standard-v2-pinned.json"]) {
  try {
    const txt = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of txt.matchAll(/0x[0-9a-fA-F]{64}/g)) ALLOW.set(m[0].toLowerCase(), `public value in ${f}`);
  } catch {}
}

const findings = [];
let files = 0;
for (const p of walk(root)) {
  const rel = path.relative(root, p);
  if (SKIP_FILES.has(rel)) continue;
  const txt = fs.readFileSync(p, "utf8");
  files++;
  const lines = txt.split("\n");
  for (const rule of RULES) {
    for (const m of txt.matchAll(rule.re)) {
      const v = m[0];
      if (ALLOW.has(v.toLowerCase()) || ALLOW.has(("0x" + v).toLowerCase())) continue;
      const line = txt.slice(0, m.index).split("\n").length;
      const lt = lines[line - 1];
      if (ALLOW_FILE_PATTERNS.some((a) => a.file.test(rel) && a.re.test(lt))) continue;
      if (rule.name.startsWith("filled-in") && /\.env\.example$/.test(rel) && /=\s*#/.test(lt)) continue;
      findings.push(`${rel}:${line}  ${rule.name}  ${v.slice(0, 10)}…(${v.length} chars)`);
    }
  }
}
if (findings.length) {
  console.error(`LEAK SCAN FAILED: ${findings.length} finding(s) in ${files} files (values truncated)`);
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log(`leak scan clean: ${files} files, ${RULES.length} rules, ${ALLOW.size} allowlisted public constants`);
