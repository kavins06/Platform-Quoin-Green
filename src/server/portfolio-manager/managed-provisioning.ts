import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";
import {
  PortfolioManagerManagementMode,
  type ActorType,
  type PortfolioManagerManagement,
  type PortfolioManagerProvisioningState,
  type PropertyType,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { QUEUES, withQueue } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createJob, JOB_STATUS, markDead } from "@/server/lib/jobs";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";
import {
  AppError,
  NotFoundError,
  ValidationError,
  WorkflowStateError,
} from "@/server/lib/errors";
import type { ESPM } from "@/server/integrations/espm";
import { buildPortfolioManagerProvisioningEnvelope } from "@/server/pipelines/portfolio-manager-provisioning/envelope";
import {
  derivePrimaryFunctionFromUses,
  type BuildingPropertyUseKey,
} from "@/lib/buildings/property-use-registry";
import {
  parsePortfolioManagerMailingAddress,
  PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
} from "@/lib/buildings/portfolio-manager-address";

const PORTFOLIO_MANAGER_PROVISIONING_JOB_TYPE = "PORTFOLIO_MANAGER_PROPERTY_PROVISIONING";
const PROPERTY_FUNCTION_BY_TYPE: Partial<Record<PropertyType, string>> = {
  OFFICE: "Office",
  MULTIFAMILY: "Multifamily Housing",
};

type ParsedDcAddress = {
  address1: string;
  city: string;
  state: string;
  postalCode: string;
};

function buildProvisioningError(code: string, message: string, httpStatus = 422) {
  return new AppError(message, {
    code,
    httpStatus,
    exposeMessage: true,
    retryable: false,
  });
}

function extractCreatedEntityId(response: unknown) {
  const candidate =
    response &&
    typeof response === "object" &&
    "response" in response &&
    response.response &&
    typeof response.response === "object" &&
    "id" in response.response
      ? (response.response as { id?: number | string }).id
      : null;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseDcAddress(address: string): ParsedDcAddress {
  const parsed = parsePortfolioManagerMailingAddress(address);

  if (!parsed) {
    throw buildProvisioningError(
      "PM_ADDRESS_PARSE_FAILED",
      PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
    );
  }

  return parsed;
}

function splitName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      firstName: "Quoin",
      lastName: "Operator",
    };
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: "Operator",
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function buildManagedEspmUsername(organizationId: string) {
  return `quoin_${organizationId.slice(-8)}_${randomBytes(4).toString("hex")}`;
}

function buildManagedEspmPassword() {
  return randomBytes(18).toString("base64url");
}

async function getPrimaryOperatorContact(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const memberships = await (input.db ?? prisma).organizationMembership.findMany({
    where: {
      organizationId: input.organizationId,
      role: {
        in: ["ADMIN", "MANAGER"],
      },
    },
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const adminMembership =
    memberships.find((membership) => membership.role === "ADMIN") ?? memberships[0];

  if (!adminMembership?.user?.email) {
    throw buildProvisioningError(
      "PM_OPERATOR_CONTACT_INCOMPLETE",
      "Portfolio Manager provisioning requires an admin or manager user with a valid email address.",
      412,
    );
  }

  return {
    name: adminMembership.user.name ?? "Quoin Operator",
    email: adminMembership.user.email,
  };
}

function getSupportedPrimaryFunction(propertyType: PropertyType) {
  const functionName = PROPERTY_FUNCTION_BY_TYPE[propertyType];
  if (!functionName) {
    throw buildProvisioningError(
      "PM_PROPERTY_TYPE_NOT_SUPPORTED",
      "This property type is not supported for Quoin-managed Portfolio Manager provisioning in phase 1.",
    );
  }

  return functionName;
}

function getPrimaryFunctionForBuilding(input: {
  propertyType: PropertyType;
  propertyUses: Array<{ useKey: BuildingPropertyUseKey }>;
}) {
  const derivedPrimaryFunction = derivePrimaryFunctionFromUses(
    input.propertyUses.map((propertyUse) => propertyUse.useKey),
  );
  if (derivedPrimaryFunction) {
    return derivedPrimaryFunction;
  }

  return getSupportedPrimaryFunction(input.propertyType);
}

async function ensureManagedAccount(input: {
  organizationId: string;
  buildingAddress: string;
  management: PortfolioManagerManagement;
  jobId: string;
  espmClient: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;

  if (input.management.managementMode !== PortfolioManagerManagementMode.QUOIN_MANAGED) {
    throw buildProvisioningError(
      "PM_MANAGEMENT_NOT_ENABLED",
      "Portfolio Manager management is not enabled for this organization.",
      409,
    );
  }

  if (input.management.providerCustomerId != null) {
    if (input.management.status !== "READY") {
      await db.portfolioManagerManagement.update({
        where: { organizationId: input.organizationId },
        data: {
          status: "READY",
          latestJobId: input.jobId,
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });
    }

    return Number(input.management.providerCustomerId);
  }

  const contact = await getPrimaryOperatorContact({
    organizationId: input.organizationId,
    db,
  });
  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });
  if (!organization) {
    throw new NotFoundError("Organization not found for managed Portfolio Manager provisioning.");
  }
  const name = splitName(contact.name);
  const address = parseDcAddress(input.buildingAddress);

  await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      status: "RUNNING",
      latestJobId: input.jobId,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });

  try {
    const response = await input.espmClient.account.createCustomer({
      username: buildManagedEspmUsername(input.organizationId),
      password: buildManagedEspmPassword(),
      organization: organization.name,
      contact: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: contact.email,
        address1: address.address1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
      },
    });
    const customerId = extractCreatedEntityId(response);

    if (!customerId) {
      throw buildProvisioningError(
        "PM_CUSTOMER_ID_MISSING",
        "Portfolio Manager customer creation did not return an account id.",
      );
    }

    await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "READY",
        providerCustomerId: BigInt(customerId),
        latestJobId: input.jobId,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
    });

    return customerId;
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager customer creation failed.";
    const code =
      error instanceof AppError ? error.code : "PM_MANAGED_ACCOUNT_CREATE_FAILED";

    await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "FAILED",
        latestJobId: input.jobId,
        latestErrorCode: code,
        latestErrorMessage: message,
      },
    });

    throw error;
  }
}

export async function getPortfolioManagerManagedContext(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const [management, provisioning] = await Promise.all([
    db.portfolioManagerManagement.findUnique({
      where: { organizationId: input.organizationId },
    }),
    db.portfolioManagerProvisioningState.findUnique({
      where: { buildingId: input.buildingId },
    }),
  ]);

  return {
    management,
    provisioning,
    isManaged:
      management?.managementMode === PortfolioManagerManagementMode.QUOIN_MANAGED,
  };
}

export async function getPortfolioManagerManagementForOrganization(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await db.portfolioManagerManagement.findUnique({
    where: { organizationId: input.organizationId },
  });

  return {
    management,
    isManaged:
      management?.managementMode === PortfolioManagerManagementMode.QUOIN_MANAGED,
  };
}

export async function enqueuePortfolioManagerProvisioningForBuilding(input: {
  organizationId: string;
  buildingId: string;
  requestId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  trigger: "BUILDING_CREATE" | "RETRY";
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await db.portfolioManagerManagement.findUnique({
    where: { organizationId: input.organizationId },
  });

  if (!management || management.managementMode !== "QUOIN_MANAGED") {
    return {
      managed: false,
      queueName: null,
      queueJobId: null,
      operationalJobId: null,
    };
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-provisioning:${input.organizationId}:${input.buildingId}`,
    async (tx) => {
      const existingProvisioning = await tx.portfolioManagerProvisioningState.findUnique({
        where: { buildingId: input.buildingId },
        select: {
          status: true,
        },
      });

      if (
        existingProvisioning?.status === "QUEUED" ||
        existingProvisioning?.status === "RUNNING"
      ) {
        throw new WorkflowStateError(
          "Portfolio Manager provisioning is already queued or running for this building.",
        );
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_PROVISIONING_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerProvisioningState.upsert({
        where: { buildingId: input.buildingId },
        create: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          status: "QUEUED",
          latestJobId: queuedJob.id,
          retryCount: input.trigger === "RETRY" ? 1 : 0,
          lastAttemptedAt: null,
          lastSucceededAt: null,
          lastFailedAt: null,
        },
        update: {
          status: "QUEUED",
          latestJobId: queuedJob.id,
          retryCount: input.trigger === "RETRY" ? { increment: 1 } : undefined,
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });

      await tx.building.update({
        where: { id: input.buildingId },
        data: {
          espmShareStatus: "PENDING",
        },
      });

      await tx.portfolioManagerManagement.update({
        where: { organizationId: input.organizationId },
        data: {
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });

      return {
        job: queuedJob,
        now: queuedAt,
      };
    },
  );

  const envelope = buildPortfolioManagerProvisioningEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: job.id,
    trigger: input.trigger,
    triggeredAt: now,
  });
  const queueJobId = `pm-provisioning-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_PROVISIONING, async (queue) => {
      await queue.add("portfolio-manager-property-provisioning", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager provisioning could not be queued.";
    await markPortfolioManagerProvisioningFailed({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      errorCode: "PM_PROVISIONING_QUEUE_FAILED",
      errorMessage: message,
      db,
    });
    await markDead(job.id, message, db).catch(() => null);
    throw error;
  }

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestId: envelope.requestId,
    action:
      input.trigger === "RETRY"
        ? "PORTFOLIO_MANAGER_PROVISIONING_REQUEUED"
        : "PORTFOLIO_MANAGER_PROVISIONING_QUEUED",
    outputSnapshot: {
      queueName: QUEUES.PORTFOLIO_MANAGER_PROVISIONING,
      queueJobId,
      operationalJobId: job.id,
    },
  });

  return {
    managed: true,
    queueName: QUEUES.PORTFOLIO_MANAGER_PROVISIONING,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function retryPortfolioManagerProvisioningFromOperator(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await getPortfolioManagerManagedContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (!context.isManaged) {
    throw new ValidationError(
      "Managed Portfolio Manager provisioning is not enabled for this organization.",
    );
  }

  if (!context.provisioning) {
    throw new NotFoundError(
      "Portfolio Manager provisioning state was not found for this building.",
    );
  }

  if (context.provisioning.status === "QUEUED" || context.provisioning.status === "RUNNING") {
    throw new WorkflowStateError(
      "Portfolio Manager provisioning is already queued or running for this building.",
    );
  }

  if (context.provisioning.status !== "FAILED") {
    throw new ValidationError(
      "Portfolio Manager provisioning can only be retried after a failed attempt.",
    );
  }

  return enqueuePortfolioManagerProvisioningForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestId: input.requestId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    trigger: "RETRY",
    db,
  });
}

export async function runPortfolioManagerProvisioning(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  espmClient: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const [management, building, provisioning] = await Promise.all([
    db.portfolioManagerManagement.findUnique({
      where: { organizationId: input.organizationId },
    }),
    db.building.findUnique({
      where: { id: input.buildingId },
      include: {
        propertyUses: {
          select: {
            useKey: true,
          },
        },
      },
    }),
    db.portfolioManagerProvisioningState.findUnique({
      where: { buildingId: input.buildingId },
    }),
  ]);

  if (!management || management.managementMode !== "QUOIN_MANAGED") {
    throw buildProvisioningError(
      "PM_MANAGEMENT_NOT_ENABLED",
      "Managed Portfolio Manager provisioning is not enabled for this organization.",
      409,
    );
  }

  if (!building || building.organizationId !== input.organizationId) {
    throw new NotFoundError("Building not found for Portfolio Manager provisioning.");
  }

  if (!provisioning) {
    throw new NotFoundError("Portfolio Manager provisioning state is missing for this building.");
  }

  const now = new Date();
  await db.$transaction([
    db.portfolioManagerProvisioningState.update({
      where: { buildingId: input.buildingId },
      data: {
        status: "RUNNING",
        latestJobId: input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        lastAttemptedAt: now,
        attemptCount: { increment: 1 },
      },
    }),
    db.building.update({
      where: { id: input.buildingId },
      data: {
        espmShareStatus: "PENDING",
      },
    }),
    db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        latestJobId: input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        status:
          management.providerCustomerId == null ? "RUNNING" : management.status,
      },
    }),
  ]);

  const customerId = await ensureManagedAccount({
    organizationId: input.organizationId,
    buildingAddress: building.address,
    management,
    jobId: input.operationalJobId,
    espmClient: input.espmClient,
    db,
  });

  const primaryFunction = getPrimaryFunctionForBuilding({
    propertyType: building.propertyType,
    propertyUses: building.propertyUses.map((propertyUse) => ({
      useKey: propertyUse.useKey as BuildingPropertyUseKey,
    })),
  });
  const address = parseDcAddress(building.address);
  const propertyResponse = await input.espmClient.property.createProperty(customerId, {
    name: building.name,
    primaryFunction,
    grossFloorArea: building.grossSquareFeet,
    yearBuilt:
      building.yearBuilt ?? building.plannedConstructionCompletionYear ?? 2000,
    address,
    numberOfBuildings: building.numberOfBuildings,
    occupancyPercentage:
      building.occupancyRate != null
        ? Math.max(0, Math.min(100, Math.round(building.occupancyRate)))
        : 100,
    irrigatedAreaSquareFeet: building.irrigatedAreaSquareFeet ?? undefined,
    constructionStatus:
      building.yearBuilt == null && building.plannedConstructionCompletionYear != null
        ? "New"
        : "Existing",
  });
  const propertyId = extractCreatedEntityId(propertyResponse);

  if (!propertyId) {
    throw buildProvisioningError(
      "PM_PROPERTY_ID_MISSING",
      "Portfolio Manager property creation did not return a property id.",
    );
  }

  await db.$transaction([
    db.portfolioManagerProvisioningState.update({
      where: { buildingId: input.buildingId },
      data: {
        status: "SUCCEEDED",
        espmPropertyId: BigInt(propertyId),
        latestJobId: input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        lastSucceededAt: new Date(),
      },
    }),
    db.building.update({
      where: { id: input.buildingId },
      data: {
        espmPropertyId: BigInt(propertyId),
        espmShareStatus: "LINKED",
      },
    }),
    db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "READY",
        latestJobId: input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
    }),
  ]);

  return {
    customerId,
    propertyId,
    primaryFunction,
  };
}

export async function markPortfolioManagerProvisioningFailed(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;

  await db.$transaction([
    db.portfolioManagerProvisioningState.updateMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      data: {
        status: "FAILED",
        latestJobId: input.operationalJobId,
        latestErrorCode: input.errorCode,
        latestErrorMessage: input.errorMessage,
        lastFailedAt: new Date(),
      },
    }),
    db.building.updateMany({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      data: {
        espmShareStatus: "FAILED",
      },
    }),
  ]);
}
