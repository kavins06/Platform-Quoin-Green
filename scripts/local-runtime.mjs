import { execFileSync } from "node:child_process";

const MANAGED_TOKENS = [
  "scripts\\start-server.mjs",
  "scripts/start-server.mjs",
  ".next\\standalone\\server.js",
  ".next/standalone/server.js",
  "dist\\server\\worker-entrypoint.js",
  "dist/server/worker-entrypoint.js",
];

/**
 * Returns true when a process command line belongs to Quoin's local runtime.
 *
 * @param {string | null | undefined} commandLine
 * @param {string} rootDir
 * @returns {boolean}
 */
export function isManagedQuoinCommandLine(commandLine, rootDir) {
  if (!commandLine) {
    return false;
  }

  const normalizedRoot = rootDir.replace(/\\/g, "/").toLowerCase();
  const normalizedCommand = commandLine.replace(/\\/g, "/").toLowerCase();

  const hasManagedToken = MANAGED_TOKENS.some((token) =>
    normalizedCommand.includes(token.replace(/\\/g, "/").toLowerCase()),
  );

  const isNextBuild = normalizedCommand.includes("next") &&
    normalizedCommand.includes(" build");
  const isNextDev = normalizedCommand.includes("next") &&
    normalizedCommand.includes(" dev");

  return normalizedCommand.includes(normalizedRoot) &&
    (hasManagedToken || isNextBuild || isNextDev);
}

/**
 * Adds stable local host and port defaults without overriding explicit env values.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function applyDefaultLocalRuntimeEnv(env) {
  return {
    ...env,
    HOSTNAME: env.HOSTNAME || "127.0.0.1",
    PORT: env.PORT || "3101",
  };
}

/**
 * Lists running Quoin local runtime processes for the current workspace.
 *
 * @param {string} rootDir
 * @returns {{ pid: number; name: string; commandLine: string }[]}
 */
export function getManagedQuoinProcesses(rootDir) {
  const processes =
    process.platform === "win32"
      ? listWindowsProcesses()
      : listPosixProcesses();

  return processes.filter(
    (item) =>
      item.pid !== process.pid &&
      isManagedQuoinCommandLine(item.commandLine, rootDir),
  );
}

/**
 * Stops all Quoin-managed local runtime processes for the current workspace.
 *
 * @param {string} rootDir
 * @returns {{ pid: number; name: string; commandLine: string }[]}
 */
export function stopManagedQuoinProcesses(rootDir) {
  const processes = getManagedQuoinProcesses(rootDir);

  for (const item of processes) {
    stopProcessTree(item.pid);
  }

  return processes;
}

/**
 * Reads the Windows process list through PowerShell in JSON form.
 *
 * @returns {{ pid: number; name: string; commandLine: string }[]}
 */
function listWindowsProcesses() {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  ).trim();

  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map((item) => ({
    pid: Number(item.ProcessId),
    name: String(item.Name || ""),
    commandLine: String(item.CommandLine || ""),
  }));
}

/**
 * Reads the POSIX process list in a shell-friendly format.
 *
 * @returns {{ pid: number; name: string; commandLine: string }[]}
 */
function listPosixProcesses() {
  const output = execFileSync("ps", ["-axo", "pid=,comm=,args="], {
    encoding: "utf8",
  }).trim();

  if (!output) {
    return [];
  }

  return output.split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);

    return {
      pid: Number(match?.[1] || 0),
      name: match?.[2] || "",
      commandLine: match?.[3] || "",
    };
  });
}

/**
 * Stops a process tree using the native platform tooling.
 *
 * @param {number} pid
 * @returns {void}
 */
function stopProcessTree(pid) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 128) {
        return;
      }

      throw error;
    }
    return;
  }

  process.kill(pid, "SIGTERM");
}
