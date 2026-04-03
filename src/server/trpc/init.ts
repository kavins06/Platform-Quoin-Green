import { randomUUID } from "node:crypto";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "@/server/lib/db";
import type { ESPM } from "@/server/integrations/espm";
import {
  AuthorizationError,
  getAppErrorLogLevel,
  toAppError,
  toTrpcError,
} from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import {
  requireTenantContext,
} from "@/server/lib/tenant-access";
import type { AppRole } from "@/server/lib/organization-membership";
import { resolveRequestAuth } from "@/server/lib/auth";
import { requireCapability, type Capability } from "@/server/lib/capabilities";

export interface Context {
  requestId?: string;
  authUserId?: string | null;
  activeOrganizationId?: string | null;
  email?: string | null;
  name?: string | null;
  prisma: typeof prisma;
  espmFactory?: (() => ESPM) | undefined;
}

export async function createContext(): Promise<Context> {
  const auth = await resolveRequestAuth();

  return {
    requestId: randomUUID(),
    authUserId: auth.authUserId,
    activeOrganizationId: auth.activeOrganizationId,
    email: auth.email,
    name: auth.name,
    prisma,
  };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    const appError = toAppError(error.cause ?? error);

    return {
      ...shape,
      message: appError.exposeMessage ? appError.message : shape.message,
      data: {
        ...shape.data,
        requestId: ctx?.requestId ?? null,
        appErrorCode: appError.code,
        retryable: appError.retryable,
      },
    };
  },
});

export const router = t.router;

const normalizeProcedureErrors = t.middleware(async ({ ctx, path, type, next }) => {
  try {
    return await next();
  } catch (error) {
    const appError = toAppError(error);
    const logger = createLogger({
      requestId: ctx.requestId,
      organizationId: "organizationId" in ctx ? String(ctx.organizationId ?? "") : undefined,
      buildingId: undefined,
      userId: ctx.authUserId ?? undefined,
      router: path.includes(".") ? path.split(".").slice(0, -1).join(".") : path,
      procedure: path,
      procedureType: type,
    });
    const level = getAppErrorLogLevel(appError);
    logger[level]("tRPC procedure failed", {
      error: appError,
    });
    throw toTrpcError(appError);
  }
});

export const publicProcedure = t.procedure.use(normalizeProcedureErrors);

const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.authUserId) {
    throw new AuthorizationError("Unauthorized", {
      httpStatus: 401,
    });
  }

  return next();
});

export const protectedProcedure = publicProcedure.use(enforceAuth);

const enforceTenant = t.middleware(async ({ ctx, next }) => {
  const tenant = await requireTenantContext({
    authUserId: ctx.authUserId,
    email: ctx.email,
    name: ctx.name,
    activeOrganizationId: ctx.activeOrganizationId,
  });

  return next({
    ctx: {
      ...ctx,
      ...tenant,
    },
  });
});

export const tenantProcedure = publicProcedure.use(enforceTenant);

const enforceCapability = (capability: Capability) =>
  t.middleware(async ({ ctx, next }) => {
    const maybeAppRole = "appRole" in ctx ? ctx.appRole : null;
    const appRole =
      maybeAppRole === "ADMIN" ||
      maybeAppRole === "MANAGER" ||
      maybeAppRole === "ENGINEER" ||
      maybeAppRole === "VIEWER"
        ? maybeAppRole
        : null;

    if (!appRole) {
      throw new AuthorizationError("Tenant access is required for this action.", {
        httpStatus: 403,
      });
    }

    requireCapability({
      role: appRole,
      capability,
    });

    return next();
  });

export const withCapability = <TProcedure extends typeof tenantProcedure>(
  procedure: TProcedure,
  capability: Capability,
) => procedure.use(enforceCapability(capability));

const OPERATOR_ROLES: AppRole[] = ["ADMIN", "MANAGER"];

const enforceOperator = t.middleware(async ({ ctx, next }) => {
  const maybeAppRole = "appRole" in ctx ? ctx.appRole : null;
  const appRole =
    maybeAppRole === "ADMIN" || maybeAppRole === "MANAGER" || maybeAppRole === "ENGINEER" || maybeAppRole === "VIEWER"
      ? maybeAppRole
      : null;

  if (!appRole || !OPERATOR_ROLES.includes(appRole)) {
    throw new AuthorizationError("Operator access is required for this action.", {
      httpStatus: 403,
      details: {
        requiredRoles: OPERATOR_ROLES,
      },
    });
  }

  return next({
    ctx: {
      ...ctx,
      appRole,
    },
  });
});

export const operatorProcedure = tenantProcedure.use(enforceOperator);
