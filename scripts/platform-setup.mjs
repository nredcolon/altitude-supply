import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { initialPlatformSql } from "../lib/catalog/platform.ts";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(
    'Local administrator setup: npm run platform:setup -- --owner-id <trusted-login-id> --name "山海供" --price-basis "人民币含税商品供货价，国内运费另计"',
  );
  process.exit(0);
}
const values = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--owner-id", "--name", "--price-basis"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error("Unknown or missing setup argument; use --help.");
  values[args[i]] = args[i + 1];
}
const sql = initialPlatformSql({
  ownerId: values["--owner-id"],
  name: values["--name"] || "山海供 · 螺蛳湾货盘",
  priceBasis: values["--price-basis"] || "人民币含税商品供货价，国内运费另计",
});
if (!existsSync(path.join(projectRoot, "dist/server/wrangler.json")))
  throw new Error(
    "Run npm run build and apply the documented D1 migrations first.",
  );
const directory = mkdtempSync(path.join(tmpdir(), "shanhai-setup-"));
try {
  const file = path.join(directory, "initialize.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--file",
      file,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0)
    console.log(
      "Local setup SQL executed. It inserts only into an empty catalog; existing workspaces and administrator identities are never overwritten.",
    );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
