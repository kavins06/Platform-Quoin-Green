import "dotenv/config";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

function fail(message) {
  console.error(`platform-contract: ${message}`);
  process.exit(1);
}

function ensureEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    fail(`missing required environment variable ${name}`);
  }
}

ensureEnv("NEXT_PUBLIC_SUPABASE_URL");
ensureEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const activeSourceFiles = globSync("src/**/*.{ts,tsx}", {
  cwd: process.cwd(),
  windowsPathsNoEscape: true,
});

const forbiddenPatterns = [
  { pattern: /@clerk\//i, label: "@clerk import" },
  { pattern: /\bCLERK_[A-Z0-9_]+\b/, label: "Clerk environment variable" },
];

for (const relativePath of activeSourceFiles) {
  const content = readFileSync(relativePath, "utf8");
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(content)) {
      fail(`${forbidden.label} found in active source file ${relativePath}`);
    }
  }
}

console.log("platform-contract: Supabase auth contract and active-source boundary validated");
