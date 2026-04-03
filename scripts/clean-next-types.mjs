import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const generatedRoot = path.join(repoRoot, ".next", "types", "app");
const sourceRoot = path.join(repoRoot, "src", "app");
const tsBuildInfoFile = path.join(repoRoot, "tsconfig.tsbuildinfo");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(fullPath)));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

async function removeEmptyDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => removeEmptyDirs(path.join(dir, entry.name))),
  );

  const remaining = await fs.readdir(dir);
  if (remaining.length === 0) {
    await fs.rmdir(dir).catch(() => undefined);
  }
}

async function main() {
  await fs.unlink(tsBuildInfoFile).catch(() => undefined);

  try {
    await fs.access(generatedRoot);
  } catch {
    return;
  }

  const generatedFiles = await walk(generatedRoot);

  for (const generatedFile of generatedFiles) {
    const relativePath = path.relative(generatedRoot, generatedFile);
    const normalizedRelativePath = relativePath
      .replace(/\.js$/, "")
      .replace(/\\/g, path.sep);
    const sourceCandidates = [
      path.join(sourceRoot, normalizedRelativePath),
      path.join(
        sourceRoot,
        normalizedRelativePath.replace(/\.ts$/, ".tsx"),
      ),
    ];

    const sourceExists = await Promise.all(
      sourceCandidates.map(async (candidate) => {
        try {
          await fs.access(candidate);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (!sourceExists.some(Boolean)) {
      await fs.unlink(generatedFile).catch(() => undefined);
    }
  }

  await removeEmptyDirs(generatedRoot).catch(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
