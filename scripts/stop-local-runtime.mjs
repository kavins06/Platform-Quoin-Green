import { stopManagedQuoinProcesses } from "./local-runtime.mjs";

const stopped = stopManagedQuoinProcesses(process.cwd());

if (stopped.length === 0) {
  console.log("No Quoin local runtime processes were running.");
  process.exit(0);
}

console.log(`Stopped ${stopped.length} Quoin local runtime process(es).`);
