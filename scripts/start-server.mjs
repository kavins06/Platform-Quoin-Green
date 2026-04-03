import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import {
  applyDefaultLocalRuntimeEnv,
  stopManagedQuoinProcesses,
} from "./local-runtime.mjs";

const root = process.cwd();
const buildDir = path.join(root, ".next");
const standaloneDir = path.join(buildDir, "standalone");
const standaloneServer = path.join(standaloneDir, "server.js");
const standaloneNextDir = path.join(standaloneDir, ".next");
const standaloneStaticDir = path.join(standaloneNextDir, "static");
const buildStaticDir = path.join(buildDir, "static");
const publicDir = path.join(root, "public");
const standalonePublicDir = path.join(standaloneDir, "public");
const workerBundle = path.join(root, "dist", "server", "worker-entrypoint.js");
const workerNodeModulesDir = path.join(root, "dist", "node_modules", "@");

// Local starts should prefer the developer's .env values over .env.production.
dotenv.config({
  path: path.join(root, ".env"),
  override: true,
});

process.env = applyDefaultLocalRuntimeEnv(process.env);

const stopped = stopManagedQuoinProcesses(root);

if (stopped.length > 0) {
  console.log(`Stopped ${stopped.length} existing Quoin local process(es).`);
}

if (!existsSync(path.join(buildDir, "BUILD_ID"))) {
  console.error("No Next production build found in .next. Run `npm run build` first.");
  process.exit(1);
}

if (!existsSync(standaloneServer)) {
  console.error("No standalone server build found. Run `npm run build` first.");
  process.exit(1);
}

if (!existsSync(workerBundle)) {
  console.error("No worker build found in dist/server. Run `npm run build` first.");
  process.exit(1);
}

if (existsSync(buildStaticDir)) {
  cpSync(buildStaticDir, standaloneStaticDir, {
    force: true,
    recursive: true,
  });
}

if (existsSync(publicDir)) {
  cpSync(publicDir, standalonePublicDir, {
    force: true,
    recursive: true,
  });
}

function ensureWorkerAlias(aliasName, targetPath) {
  const aliasPath = path.join(workerNodeModulesDir, aliasName);
  rmSync(aliasPath, { force: true, recursive: true });
  symlinkSync(targetPath, aliasPath, "junction");
}

mkdirSync(workerNodeModulesDir, { recursive: true });
ensureWorkerAlias("server", path.join(root, "dist", "server"));
ensureWorkerAlias("generated", path.join(root, "src", "generated"));
ensureWorkerAlias("lib", path.join(root, "dist", "lib"));

const processes = [
  spawn(process.execPath, [standaloneServer], {
    cwd: standaloneDir,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, [workerBundle], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
];

function forwardSignal(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    forwardSignal(signal);
  });
}

processes.forEach((child) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      forwardSignal(signal);
      process.kill(process.pid, signal);
      return;
    }

    if ((code ?? 0) !== 0) {
      forwardSignal("SIGTERM");
      process.exit(code ?? 1);
      return;
    }
  });
});
