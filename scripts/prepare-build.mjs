import { rmSync } from "node:fs";
import path from "node:path";
import { stopManagedQuoinProcesses } from "./local-runtime.mjs";

const root = process.cwd();
const buildDir = path.join(root, ".next");
const distServerDir = path.join(root, "dist", "server");
const distLibDir = path.join(root, "dist", "lib");
const stopped = stopManagedQuoinProcesses(root);

if (stopped.length > 0) {
  console.log(
    `Stopped ${stopped.length} Quoin local runtime process(es) before build.`,
  );
}

rmSync(buildDir, { force: true, recursive: true });
rmSync(distServerDir, { force: true, recursive: true });
rmSync(distLibDir, { force: true, recursive: true });

console.log("Cleaned .next, dist/server, and dist/lib before build.");
