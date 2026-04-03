import { describe, expect, it, vi } from "vitest";
import { createAuditLog } from "@/server/lib/audit-log";

describe("createAuditLog", () => {
  it("persists structured audit payloads", async () => {
    const db = {
      auditLog: {
        create: vi.fn(async (args) => args),
      },
    };

    await createAuditLog(
      {
        actorType: "USER",
        actorId: "user_1",
        organizationId: "org_1",
        buildingId: "building_1",
        action: "portfolio_manager.sync.started",
        inputSnapshot: {
          reportingYear: 2025,
        },
        outputSnapshot: {
          status: "RUNNING",
        },
        errorCode: null,
        requestId: "req_1",
      },
      db as Parameters<typeof createAuditLog>[1],
    );

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: "USER",
        actorId: "user_1",
        organizationId: "org_1",
        buildingId: "building_1",
        action: "portfolio_manager.sync.started",
        inputSnapshot: {
          reportingYear: 2025,
        },
        outputSnapshot: {
          status: "RUNNING",
        },
        errorCode: null,
        requestId: "req_1",
        timestamp: undefined,
      },
    });
  });
});
