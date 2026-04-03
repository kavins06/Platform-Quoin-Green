import { z } from "zod";
import type {
  ActorType,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
  Prisma,
  SubmissionWorkflowState,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { transitionSubmissionWorkflow } from "@/server/compliance/submission-workflows";
import { deleteBuildingLifecycle } from "@/server/lifecycle/building-teardown";
import { toAppError, ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { deleteRemotePropertyForBuilding } from "@/server/portfolio-manager/provider-property-writes";
import { enqueuePortfolioManagerUsagePush } from "@/server/portfolio-manager/usage";

const submissionWorkflowTransitionStateSchema = z.enum([
  "READY_FOR_REVIEW",
  "APPROVED_FOR_SUBMISSION",
  "SUBMITTED",
  "COMPLETED",
  "NEEDS_CORRECTION",
]);

const pmUsagePushPayloadSchema = z.object({
  buildingId: z.string().min(1),
  reportingYear: z.number().int().min(2000).max(2100).nullable().optional(),
});

const remoteBuildingDeletePayloadSchema = z.object({
  buildingId: z.string().min(1),
  propertyId: z.string().min(1),
  actionKind: z.enum(["DELETE_PROPERTY", "UNSHARE_PROPERTY"]).optional(),
});

const submissionWorkflowTransitionPayloadSchema = z.object({
  buildingId: z.string().min(1),
  workflowId: z.string().min(1),
  nextState: submissionWorkflowTransitionStateSchema,
  notes: z.string().nullable().optional(),
});

export interface HighRiskActionResult {
  outcome: "EXECUTED" | "PENDING_APPROVAL";
  message: string;
  approvalRequestId: string | null;
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function toSummary(action: ApprovalRequestType, payload: Record<string, unknown>) {
  switch (action) {
    case "PM_USAGE_PUSH":
      return {
        title: "Push local readings to Portfolio Manager",
        summary:
          typeof payload.reportingYear === "number"
            ? `Push Quoin readings for reporting year ${payload.reportingYear} to the linked ESPM property.`
            : "Push the latest Quoin readings to the linked ESPM property.",
      };
    case "REMOTE_BUILDING_DELETE":
      if (payload.actionKind === "UNSHARE_PROPERTY") {
        return {
          title: "Remove provider access and delete building",
          summary:
            typeof payload.propertyId === "string"
              ? `Remove Quoin's provider access to linked ESPM property ${payload.propertyId}, then remove the local Quoin building.`
              : "Remove Quoin's provider access to the linked ESPM property, then remove the local Quoin building.",
        };
      }
      return {
        title: "Delete linked ESPM property and building",
        summary:
          typeof payload.propertyId === "string"
            ? `Delete ESPM property ${payload.propertyId} through Quoin's provider account, then remove the linked Quoin building.`
            : "Delete the linked ESPM property and remove the local Quoin building.",
      };
    case "SUBMISSION_WORKFLOW_TRANSITION":
      return {
        title: "Advance governed submission workflow",
        summary:
          typeof payload.nextState === "string"
            ? `Advance the building's governed submission workflow to ${payload.nextState.replaceAll("_", " ").toLowerCase()}.`
            : "Advance the governed submission workflow.",
      };
  }
}

async function createApprovalRequest(input: {
  organizationId: string;
  buildingId?: string | null;
  requestType: ApprovalRequestType;
  payload: Record<string, unknown>;
  requestedByType: ActorType;
  requestedById?: string | null;
  requestId?: string | null;
}) {
  const summary = toSummary(input.requestType, input.payload);
  const approvalRequest = await prisma.approvalRequest.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId ?? null,
      requestType: input.requestType,
      title: summary.title,
      summary: summary.summary,
      payload: toJson(input.payload),
      requestId: input.requestId ?? null,
      requestedByType: input.requestedByType,
      requestedById: input.requestedById ?? null,
    },
  });

  await createAuditLog({
    actorType: input.requestedByType,
    actorId: input.requestedById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId ?? null,
    action: "APPROVAL_REQUEST_CREATED",
    inputSnapshot: {
      approvalRequestId: approvalRequest.id,
      requestType: approvalRequest.requestType,
      payload: input.payload,
    },
    outputSnapshot: {
      status: approvalRequest.status,
      title: approvalRequest.title,
    },
    requestId: input.requestId ?? null,
  });

  return approvalRequest;
}

export async function requestPmUsagePushApproval(input: {
  organizationId: string;
  buildingId: string;
  reportingYear?: number | null;
  requestedByType: ActorType;
  requestedById?: string | null;
  requestId?: string | null;
}): Promise<HighRiskActionResult> {
  const approvalRequest = await createApprovalRequest({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestType: "PM_USAGE_PUSH",
    payload: {
      buildingId: input.buildingId,
      reportingYear: input.reportingYear ?? null,
    },
    requestedByType: input.requestedByType,
    requestedById: input.requestedById ?? null,
    requestId: input.requestId ?? null,
  });

  return {
    outcome: "PENDING_APPROVAL",
    approvalRequestId: approvalRequest.id,
    message: "Push request submitted for admin approval.",
  };
}

export async function requestRemoteBuildingDeleteApproval(input: {
  organizationId: string;
  buildingId: string;
  propertyId: string;
  actionKind?: "DELETE_PROPERTY" | "UNSHARE_PROPERTY";
  requestedByType: ActorType;
  requestedById?: string | null;
  requestId?: string | null;
}): Promise<HighRiskActionResult> {
  const approvalRequest = await createApprovalRequest({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestType: "REMOTE_BUILDING_DELETE",
    payload: {
      buildingId: input.buildingId,
      propertyId: input.propertyId,
      actionKind: input.actionKind ?? "DELETE_PROPERTY",
    },
    requestedByType: input.requestedByType,
    requestedById: input.requestedById ?? null,
    requestId: input.requestId ?? null,
  });

  return {
    outcome: "PENDING_APPROVAL",
    approvalRequestId: approvalRequest.id,
    message:
      input.actionKind === "UNSHARE_PROPERTY"
        ? "Provider access removal request submitted for admin approval."
        : "Remote delete request submitted for admin approval.",
  };
}

export async function requestSubmissionWorkflowTransitionApproval(input: {
  organizationId: string;
  buildingId: string;
  workflowId: string;
  nextState: Exclude<SubmissionWorkflowState, "DRAFT" | "SUPERSEDED">;
  notes?: string | null;
  requestedByType: ActorType;
  requestedById?: string | null;
  requestId?: string | null;
}): Promise<HighRiskActionResult> {
  const approvalRequest = await createApprovalRequest({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestType: "SUBMISSION_WORKFLOW_TRANSITION",
    payload: {
      buildingId: input.buildingId,
      workflowId: input.workflowId,
      nextState: input.nextState,
      notes: input.notes ?? null,
    },
    requestedByType: input.requestedByType,
    requestedById: input.requestedById ?? null,
    requestId: input.requestId ?? null,
  });

  return {
    outcome: "PENDING_APPROVAL",
    approvalRequestId: approvalRequest.id,
    message: "Submission transition request submitted for admin approval.",
  };
}

async function executeApprovedRequest(input: {
  approvalRequest: ApprovalRequest;
  reviewerType: ActorType;
  reviewerId?: string | null;
  requestId?: string | null;
}) {
  switch (input.approvalRequest.requestType) {
    case "PM_USAGE_PUSH": {
      const payload = pmUsagePushPayloadSchema.parse(input.approvalRequest.payload);
      return enqueuePortfolioManagerUsagePush({
        organizationId: input.approvalRequest.organizationId,
        buildingId: payload.buildingId,
        reportingYear: payload.reportingYear ?? undefined,
        actorType: input.reviewerType,
        actorId: input.reviewerId ?? null,
        requestId: input.requestId ?? null,
      });
    }
    case "REMOTE_BUILDING_DELETE": {
      const payload = remoteBuildingDeletePayloadSchema.parse(input.approvalRequest.payload);
      const remoteDeleteResult = await deleteRemotePropertyForBuilding({
        organizationId: input.approvalRequest.organizationId,
        propertyId: payload.propertyId,
      });
      await createAuditLog({
        actorType: input.reviewerType,
        actorId: input.reviewerId ?? null,
        organizationId: input.approvalRequest.organizationId,
        buildingId: null,
        action:
          remoteDeleteResult.remoteAction === "UNSHARE_PROPERTY"
            ? "BUILDING_REMOTE_PROPERTY_UNSHARED"
            : "BUILDING_REMOTE_PROPERTY_DELETED",
        inputSnapshot: {
          buildingId: payload.buildingId,
          propertyId: payload.propertyId,
          approvalRequestId: input.approvalRequest.id,
        },
        outputSnapshot: remoteDeleteResult,
        requestId: input.requestId ?? null,
      });
      await createAuditLog({
        actorType: input.reviewerType,
        actorId: input.reviewerId ?? null,
        organizationId: input.approvalRequest.organizationId,
        buildingId: null,
        action: "BUILDING_LOCAL_DELETED",
        inputSnapshot: {
          buildingId: payload.buildingId,
          deleteMode: "DELETE_REMOTE_PROPERTY",
          approvalRequestId: input.approvalRequest.id,
          propertyId: payload.propertyId,
        },
        outputSnapshot: {
          success: true,
        },
        requestId: input.requestId ?? null,
      });
      await deleteBuildingLifecycle({
        organizationId: input.approvalRequest.organizationId,
        buildingId: payload.buildingId,
      });
      return { success: true };
    }
    case "SUBMISSION_WORKFLOW_TRANSITION": {
      const payload = submissionWorkflowTransitionPayloadSchema.parse(
        input.approvalRequest.payload,
      );
      return transitionSubmissionWorkflow({
        organizationId: input.approvalRequest.organizationId,
        buildingId: payload.buildingId,
        workflowId: payload.workflowId,
        nextState: payload.nextState,
        notes: payload.notes ?? null,
        createdByType: input.reviewerType,
        createdById: input.reviewerId ?? null,
        requestId: input.requestId ?? null,
      });
    }
  }
}

export async function listApprovalRequestsForOrganization(input: {
  organizationId: string;
  limit?: number;
  statuses?: ApprovalRequestStatus[];
}) {
  return prisma.approvalRequest.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.statuses && input.statuses.length > 0
        ? { status: { in: input.statuses } }
        : {}),
    },
    orderBy: [{ requestedAt: "desc" }],
    take: input.limit ?? 20,
  });
}

export async function reviewApprovalRequest(input: {
  organizationId: string;
  approvalRequestId: string;
  decision: "APPROVE" | "REJECT";
  reviewerType: ActorType;
  reviewerId?: string | null;
  notes?: string | null;
  requestId?: string | null;
}) {
  const approvalRequest = await prisma.approvalRequest.findFirst({
    where: {
      id: input.approvalRequestId,
      organizationId: input.organizationId,
    },
  });

  if (!approvalRequest) {
    throw new ValidationError("Approval request not found.");
  }

  if (approvalRequest.status !== "PENDING") {
    throw new WorkflowStateError("This approval request has already been reviewed.");
  }

  if (input.decision === "REJECT") {
    const rejected = await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        status: "REJECTED",
        reviewedByType: input.reviewerType,
        reviewedById: input.reviewerId ?? null,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
      },
    });

    await createAuditLog({
      actorType: input.reviewerType,
      actorId: input.reviewerId ?? null,
      organizationId: input.organizationId,
      buildingId: rejected.buildingId ?? null,
      action: "APPROVAL_REQUEST_REJECTED",
      inputSnapshot: {
        approvalRequestId: rejected.id,
        requestType: rejected.requestType,
        notes: input.notes ?? null,
      },
      outputSnapshot: {
        status: rejected.status,
      },
      requestId: input.requestId ?? null,
    });

    return rejected;
  }

  const claimed = await prisma.approvalRequest.updateMany({
    where: {
      id: approvalRequest.id,
      status: "PENDING",
    },
    data: {
      status: "APPROVED",
      reviewedByType: input.reviewerType,
      reviewedById: input.reviewerId ?? null,
      reviewedAt: new Date(),
      reviewNotes: input.notes ?? null,
    },
  });

  if (claimed.count === 0) {
    throw new WorkflowStateError("This approval request has already been reviewed.");
  }

  try {
    const executionResult = await executeApprovedRequest({
      approvalRequest,
      reviewerType: input.reviewerType,
      reviewerId: input.reviewerId ?? null,
      requestId: input.requestId ?? null,
    });

    const approved = await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        executedAt: new Date(),
        executionErrorCode: null,
        executionErrorMessage: null,
      },
    });

    await createAuditLog({
      actorType: input.reviewerType,
      actorId: input.reviewerId ?? null,
      organizationId: input.organizationId,
      buildingId: approved.buildingId ?? null,
      action: "APPROVAL_REQUEST_APPROVED",
      inputSnapshot: {
        approvalRequestId: approved.id,
        requestType: approved.requestType,
        notes: input.notes ?? null,
      },
      outputSnapshot: {
        status: approved.status,
        executedAt: approved.executedAt?.toISOString() ?? null,
      },
      requestId: input.requestId ?? null,
    });

    return {
      approvalRequest: approved,
      executionResult,
    };
  } catch (error) {
    const appError = toAppError(error);
    await prisma.approvalRequest.update({
      where: { id: approvalRequest.id },
      data: {
        status: "FAILED",
        executionErrorCode: appError.code,
        executionErrorMessage: appError.message,
      },
    });

    await createAuditLog({
      actorType: input.reviewerType,
      actorId: input.reviewerId ?? null,
      organizationId: input.organizationId,
      buildingId: approvalRequest.buildingId ?? null,
      action: "APPROVAL_REQUEST_FAILED",
      inputSnapshot: {
        approvalRequestId: approvalRequest.id,
        requestType: approvalRequest.requestType,
      },
      outputSnapshot: {
        retryable: appError.retryable,
      },
      errorCode: appError.code,
      requestId: input.requestId ?? null,
    });

    throw error;
  }
}
