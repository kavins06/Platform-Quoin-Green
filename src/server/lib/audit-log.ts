import type { AuditLog, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";

interface AuditLogClient {
  auditLog: {
    create(args: {
      data: {
        actorType: string;
        actorId: string | null;
        organizationId: string | null;
        buildingId: string | null;
        action: string;
        inputSnapshot?: Prisma.InputJsonValue;
        outputSnapshot?: Prisma.InputJsonValue;
        errorCode: string | null;
        requestId: string | null;
        timestamp?: Date;
      };
    }): Promise<AuditLog>;
  };
}

export interface CreateAuditLogInput {
  actorType: string;
  actorId?: string | null;
  organizationId?: string | null;
  buildingId?: string | null;
  action: string;
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
  errorCode?: string | null;
  requestId?: string | null;
  timestamp?: Date;
}

function toJson(value: unknown) {
  return (value ?? undefined) as Prisma.InputJsonValue | undefined;
}

export async function createAuditLog(
  input: CreateAuditLogInput,
  db: AuditLogClient = prisma,
): Promise<AuditLog> {
  return db.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId ?? null,
      buildingId: input.buildingId ?? null,
      action: input.action,
      inputSnapshot: toJson(input.inputSnapshot),
      outputSnapshot: toJson(input.outputSnapshot),
      errorCode: input.errorCode ?? null,
      requestId: input.requestId ?? null,
      timestamp: input.timestamp ?? undefined,
    },
  });
}
