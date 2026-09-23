const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return "";

  const entry = fs.readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m);
  if (!entry) return "";

  const value = entry[1];
  const isQuoted = value[0] === "\"" || value[0] === "'";
  return value.length >= 2 && isQuoted && value.at(-1) === value[0]
    ? value.slice(1, -1)
    : value;
}

const databaseUrl = getDatabaseUrl();
let schemaPath;
if (/^(postgres|postgresql):\/\//i.test(databaseUrl)) {
  schemaPath = "prisma/postgresql/schema.prisma";
} else if (!databaseUrl || /^file:/i.test(databaseUrl)) {
  schemaPath = "prisma/schema.prisma";
} else {
  console.error("DATABASE_URL must use file:, postgres://, or postgresql:// for Prisma client generation.");
  process.exit(1);
}

const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [prismaCli, "generate", "--schema", schemaPath], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
