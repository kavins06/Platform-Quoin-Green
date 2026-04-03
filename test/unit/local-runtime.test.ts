import { describe, expect, it } from "vitest";
import {
  applyDefaultLocalRuntimeEnv,
  isManagedQuoinCommandLine,
} from "../../scripts/local-runtime.mjs";

describe("local runtime helpers", () => {
  it("matches Quoin-managed standalone and build processes", () => {
    expect(
      isManagedQuoinCommandLine(
        "\"C:\\Program Files\\nodejs\\node.exe\" C:\\Quoin\\.next\\standalone\\server.js",
        "C:\\Quoin",
      ),
    ).toBe(true);

    expect(
      isManagedQuoinCommandLine(
        "\"node\" \"C:\\Quoin\\node_modules\\.bin\\..\\next\\dist\\bin\\next\" build",
        "C:\\Quoin",
      ),
    ).toBe(true);
  });

  it("ignores unrelated processes", () => {
    expect(
      isManagedQuoinCommandLine(
        "\"C:\\Program Files\\nodejs\\node.exe\" C:\\OTC\\node_modules\\next\\dist\\bin\\next start",
        "C:\\Quoin",
      ),
    ).toBe(false);
  });

  it("applies stable local host and port defaults without overriding explicit values", () => {
    expect(
      applyDefaultLocalRuntimeEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).toMatchObject({
      HOSTNAME: "127.0.0.1",
      PORT: "3101",
    });

    expect(
      applyDefaultLocalRuntimeEnv({
        NODE_ENV: "test",
        HOSTNAME: "0.0.0.0",
        PORT: "4200",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      HOSTNAME: "0.0.0.0",
      PORT: "4200",
    });
  });
});
