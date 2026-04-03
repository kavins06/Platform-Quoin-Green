import type {
  ActorType,
  BenchmarkPacket,
  FilingPacket,
  Prisma,
  SubmissionWorkflow,
  SubmissionWorkflowEvent,
  SubmissionWorkflowState,
  SubmissionWorkflowType,
} from "@/generated/prisma/client";
import { createAuditLog } from "@/server/lib/audit-log";
import { prisma } from "@/server/lib/db";
import { NotFoundError, ValidationError, WorkflowStateError } from "@/server/lib/errors";

type WorkflowSurfaceState = SubmissionWorkflowState | "NOT_STARTED";

type WorkflowPacketRecord = {
  id: string;
  version: number;
  status: string;
  generatedAt: Date;
  finalizedAt: Date | null;
};

type WorkflowRecordWithRelations = SubmissionWorkflow & {
  benchmarkPacket: Pick<
    BenchmarkPacket,
    "id" | "version" | "status" | "generatedAt" | "finalizedAt"
  > | null;
  filingPacket: Pick<
    FilingPacket,
    "id" | "version" | "status" | "generatedAt" | "finalizedAt"
  > | null;
  events: Array<
    Pick<
      SubmissionWorkflowEvent,
      "id" | "fromState" | "toState" | "notes" | "createdAt" | "createdByType" | "createdById"
    >
  >;
};

export interface SubmissionWorkflowAllowedTransition {
  nextState: Exclude<SubmissionWorkflowState, "DRAFT" | "SUPERSEDED">;
  label: string;
}

export interface SubmissionWorkflowHistoryEntry {
  id: string;
  fromState: SubmissionWorkflowState | null;
  toState: SubmissionWorkflowState;
  notes: string | null;
  createdAt: string;
  createdByType: ActorType;
  createdById: string | null;
}

export interface SubmissionWorkflowSummary {
  id: string;
  workflowType: SubmissionWorkflowType;
  state: WorkflowSurfaceState;
  linkedArtifactId: string | null;
  linkedArtifactVersion: number | null;
  linkedArtifactStatus: string | null;
  latestTransitionAt: string | null;
  readyForReviewAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  needsCorrectionAt: string | null;
  supersededAt: string | null;
  supersededById: string | null;
  latestNotes: string | null;
  allowedTransitions: SubmissionWorkflowAllowedTransition[];
  nextAction: {
    title: string;
    reason: string;
  };
}

export interface SubmissionWorkflowDetail extends SubmissionWorkflowSummary {
  history: SubmissionWorkflowHistoryEntry[];
}

type WorkflowSummaryMap = {
  benchmarkByPacketId: Map<string, SubmissionWorkflowSummary>;
};

const TRANSITION_LABELS: Record<
  Exclude<SubmissionWorkflowState, "DRAFT" | "SUPERSEDED">,
  string
> = {
  READY_FOR_REVIEW: "Move to review",
  APPROVED_FOR_SUBMISSION: "Approve for submission",
  SUBMITTED: "Mark submitted",
  COMPLETED: "Mark accepted",
  NEEDS_CORRECTION: "Request correction",
};

const MANUAL_TRANSITIONS: Record<
  SubmissionWorkflowState,
  Array<Exclude<SubmissionWorkflowState, "DRAFT" | "SUPERSEDED">>
> = {
  DRAFT: [],
  READY_FOR_REVIEW: ["APPROVED_FOR_SUBMISSION", "NEEDS_CORRECTION"],
  APPROVED_FOR_SUBMISSION: ["SUBMITTED", "NEEDS_CORRECTION"],
  SUBMITTED: ["COMPLETED", "NEEDS_CORRECTION"],
  COMPLETED: [],
  NEEDS_CORRECTION: ["READY_FOR_REVIEW"],
  SUPERSEDED: [],
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function workflowNextAction(state: WorkflowSurfaceState) {
  switch (state) {
    case "DRAFT":
      return {
        title: "Finalize the artifact",
        reason: "The governed artifact exists, but it has not been finalized for review yet.",
      };
    case "READY_FOR_REVIEW":
      return {
        title: "Approve for submission",
        reason: "The finalized artifact is ready for consultant review and approval.",
      };
    case "APPROVED_FOR_SUBMISSION":
      return {
        title: "Record submission",
        reason: "The artifact is approved and ready to move into submission operations.",
      };
    case "SUBMITTED":
      return {
        title: "Monitor submission",
        reason: "Submission has been recorded. Track acceptance or requested corrections.",
      };
    case "COMPLETED":
      return {
        title: "Submission workflow complete",
        reason: "This governed submission workflow is complete.",
      };
    case "NEEDS_CORRECTION":
      return {
        title: "Correct and regenerate",
        reason: "The current submission candidate needs correction before it can proceed.",
      };
    case "SUPERSEDED":
      return {
        title: "Superseded by newer artifact",
        reason: "A newer governed artifact has replaced this submission candidate.",
      };
    default:
      return {
        title: "No submission workflow started",
        reason: "Generate and finalize a governed artifact to start submission operations.",
      };
  }
}

function getAllowedTransitions(state: SubmissionWorkflowState) {
  return MANUAL_TRANSITIONS[state].map((nextState) => ({
    nextState,
    label: TRANSITION_LABELS[nextState],
  }));
}

function buildWorkflowSummary(
  workflow: WorkflowRecordWithRelations | null,
): SubmissionWorkflowSummary | null {
  if (!workflow) {
    return null;
  }

  const artifact = workflow.benchmarkPacket ?? workflow.filingPacket;
  const latestEvent = workflow.events[0] ?? null;

  return {
    id: workflow.id,
    workflowType: workflow.workflowType,
    state: workflow.state,
    linkedArtifactId: artifact?.id ?? null,
    linkedArtifactVersion: artifact?.version ?? null,
    linkedArtifactStatus: artifact?.status ?? null,
    latestTransitionAt: toIso(workflow.latestTransitionAt),
    readyForReviewAt: toIso(workflow.readyForReviewAt),
    approvedAt: toIso(workflow.approvedAt),
    submittedAt: toIso(workflow.submittedAt),
    completedAt: toIso(workflow.completedAt),
    needsCorrectionAt: toIso(workflow.needsCorrectionAt),
    supersededAt: toIso(workflow.supersededAt),
    supersededById: workflow.supersededById,
    latestNotes: latestEvent?.notes ?? null,
    allowedTransitions:
      workflow.state === "SUPERSEDED" ? [] : getAllowedTransitions(workflow.state),
    nextAction: workflowNextAction(workflow.state),
  };
}

function buildWorkflowDetail(workflow: WorkflowRecordWithRelations | null): SubmissionWorkflowDetail | null {
  const summary = buildWorkflowSummary(workflow);
  if (!summary || !workflow) {
    return null;
  }

  return {
    ...summary,
    history: workflow.events.map((event) => ({
      id: event.id,
      fromState: event.fromState,
      toState: event.toState,
      notes: event.notes ?? null,
      createdAt: event.createdAt.toISOString(),
      createdByType: event.createdByType,
      createdById: event.createdById ?? null,
    })),
  };
}

function initialStateForPacketStatus(status: string): SubmissionWorkflowState {
  return status === "FINALIZED" ? "READY_FOR_REVIEW" : "DRAFT";
}

function shouldSupersedeForNewArtifact(state: SubmissionWorkflowState) {
  return state !== "COMPLETED" && state !== "SUPERSEDED";
}

function applyStateTimestamps(
  state: SubmissionWorkflowState,
  now: Date,
) {
  const timestamps: {
    latestTransitionAt: Date;
    readyForReviewAt?: Date;
    approvedAt?: Date;
    submittedAt?: Date;
    completedAt?: Date;
    needsCorrectionAt?: Date;
    supersededAt?: Date;
  } = {
    latestTransitionAt: now,
  };

  if (state === "READY_FOR_REVIEW") {
    timestamps.readyForReviewAt = now;
  }
  if (state === "APPROVED_FOR_SUBMISSION") {
    timestamps.approvedAt = now;
  }
  if (state === "SUBMITTED") {
    timestamps.submittedAt = now;
  }
  if (state === "COMPLETED") {
    timestamps.completedAt = now;
  }
  if (state === "NEEDS_CORRECTION") {
    timestamps.needsCorrectionAt = now;
  }
  if (state === "SUPERSEDED") {
    timestamps.supersededAt = now;
  }

  return timestamps;
}

async function createWorkflowEventTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    workflowId: string;
    fromState: SubmissionWorkflowState | null;
    toState: SubmissionWorkflowState;
    notes?: string | null;
    createdByType: ActorType;
    createdById?: string | null;
  },
) {
  return tx.submissionWorkflowEvent.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      workflowId: input.workflowId,
      fromState: input.fromState,
      toState: input.toState,
      notes: input.notes ?? null,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    },
  });
}

async function transitionWorkflowTx(
  tx: Prisma.TransactionClient,
  input: {
    workflow: SubmissionWorkflow;
    nextState: SubmissionWorkflowState;
    notes?: string | null;
    createdByType: ActorType;
    createdById?: string | null;
  },
) {
  const now = new Date();
  const updated = await tx.submissionWorkflow.update({
    where: { id: input.workflow.id },
    data: {
      state: input.nextState,
      ...applyStateTimestamps(input.nextState, now),
    },
  });

  await createWorkflowEventTx(tx, {
    organizationId: updated.organizationId,
    buildingId: updated.buildingId,
    workflowId: updated.id,
    fromState: input.workflow.state,
    toState: input.nextState,
    notes: input.notes ?? null,
    createdByType: input.createdByType,
    createdById: input.createdById ?? null,
  });

  return updated;
}

async function createWorkflowTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    workflowType: SubmissionWorkflowType;
    benchmarkPacketId?: string | null;
    filingPacketId?: string | null;
    initialState: SubmissionWorkflowState;
    createdByType: ActorType;
    createdById?: string | null;
    notes?: string | null;
  },
) {
  const now = new Date();
  const workflow = await tx.submissionWorkflow.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      workflowType: input.workflowType,
      state: input.initialState,
      benchmarkPacketId: input.benchmarkPacketId ?? null,
      filingPacketId: input.filingPacketId ?? null,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
      ...applyStateTimestamps(input.initialState, now),
    },
  });

  await createWorkflowEventTx(tx, {
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    workflowId: workflow.id,
    fromState: null,
    toState: input.initialState,
    notes: input.notes ?? null,
    createdByType: input.createdByType,
    createdById: input.createdById ?? null,
  });

  return workflow;
}

async function supersedeWorkflowTx(
  tx: Prisma.TransactionClient,
  input: {
    workflow: SubmissionWorkflow;
    supersededById: string;
    notes: string;
    createdByType: ActorType;
    createdById?: string | null;
  },
) {
  if (!shouldSupersedeForNewArtifact(input.workflow.state)) {
    return input.workflow;
  }

  const transitioned = await transitionWorkflowTx(tx, {
    workflow: input.workflow,
    nextState: "SUPERSEDED",
    notes: input.notes,
    createdByType: input.createdByType,
    createdById: input.createdById ?? null,
  });

  const updated = await tx.submissionWorkflow.update({
    where: { id: transitioned.id },
    data: {
      supersededById: input.supersededById,
    },
  });

  await createAuditLog(
    {
      actorType: input.createdByType,
      actorId: input.createdById ?? null,
      organizationId: input.workflow.organizationId,
      buildingId: input.workflow.buildingId,
      action: "SUBMISSION_WORKFLOW_SUPERSEDED",
      inputSnapshot: {
        workflowId: input.workflow.id,
        workflowType: input.workflow.workflowType,
        fromState: input.workflow.state,
        toState: "SUPERSEDED",
        supersededById: input.supersededById,
        notes: input.notes,
      },
      outputSnapshot: {
        latestTransitionAt: updated.latestTransitionAt.toISOString(),
      },
    },
    tx,
  );

  return updated;
}

async function reconcileWorkflowForArtifactTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    workflowType: SubmissionWorkflowType;
    benchmarkPacketId?: string | null;
    filingPacketId?: string | null;
    artifact: WorkflowPacketRecord;
    createdByType: ActorType;
    createdById?: string | null;
    requestId?: string | null;
  },
) {
  const packetWhere =
    input.workflowType === "BENCHMARK_VERIFICATION"
      ? { benchmarkPacketId: input.artifact.id }
      : { filingPacketId: input.artifact.id };

  const existing = await tx.submissionWorkflow.findFirst({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      workflowType: input.workflowType,
      ...packetWhere,
    },
  });

  const initialState = initialStateForPacketStatus(input.artifact.status);

  if (existing) {
    if (existing.state === initialState) {
      return existing;
    }

    if (existing.state === "DRAFT" && initialState === "READY_FOR_REVIEW") {
      const transitioned = await transitionWorkflowTx(tx, {
        workflow: existing,
        nextState: "READY_FOR_REVIEW",
        notes: "Artifact finalized and promoted to submission review.",
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      });

      await createAuditLog(
        {
          actorType: input.createdByType,
          actorId: input.createdById ?? null,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          action: "SUBMISSION_WORKFLOW_TRANSITIONED",
          inputSnapshot: {
            workflowId: transitioned.id,
            workflowType: transitioned.workflowType,
            fromState: existing.state,
            toState: transitioned.state,
          },
          outputSnapshot: {
            linkedArtifactId: input.artifact.id,
            linkedArtifactVersion: input.artifact.version,
            latestTransitionAt: transitioned.latestTransitionAt.toISOString(),
          },
          requestId: input.requestId ?? null,
        },
        tx,
      );

      return transitioned;
    }

    return existing;
  }

  const activeWorkflows = await tx.submissionWorkflow.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      workflowType: input.workflowType,
      supersededAt: null,
    },
    orderBy: [{ latestTransitionAt: "desc" }],
  });

  const created = await createWorkflowTx(tx, {
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    workflowType: input.workflowType,
    benchmarkPacketId: input.benchmarkPacketId ?? null,
    filingPacketId: input.filingPacketId ?? null,
    initialState,
    createdByType: input.createdByType,
    createdById: input.createdById ?? null,
    notes:
      initialState === "READY_FOR_REVIEW"
        ? "Workflow started from a finalized governed artifact."
        : "Workflow started from a generated governed artifact draft.",
  });

  for (const workflow of activeWorkflows) {
    if (!shouldSupersedeForNewArtifact(workflow.state)) {
      continue;
    }

    await supersedeWorkflowTx(tx, {
      workflow,
      supersededById: created.id,
      notes: "Superseded by a newer governed artifact version.",
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });
  }

  await createAuditLog(
    {
      actorType: input.createdByType,
      actorId: input.createdById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "SUBMISSION_WORKFLOW_CREATED",
      inputSnapshot: {
        workflowId: created.id,
        workflowType: created.workflowType,
        state: created.state,
      },
      outputSnapshot: {
        linkedArtifactId: input.artifact.id,
        linkedArtifactVersion: input.artifact.version,
        linkedArtifactStatus: input.artifact.status,
      },
      requestId: input.requestId ?? null,
    },
    tx,
  );

  return created;
}

export async function reconcileBenchmarkSubmissionWorkflowTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    packet: Pick<
      BenchmarkPacket,
      "id" | "version" | "status" | "generatedAt" | "finalizedAt"
    >;
    createdByType: ActorType;
    createdById?: string | null;
    requestId?: string | null;
  },
) {
  return reconcileWorkflowForArtifactTx(tx, {
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    workflowType: "BENCHMARK_VERIFICATION",
    benchmarkPacketId: input.packet.id,
    artifact: input.packet,
    createdByType: input.createdByType,
    createdById: input.createdById ?? null,
    requestId: input.requestId ?? null,
  });
}

export async function transitionSubmissionWorkflow(input: {
  organizationId: string;
  buildingId: string;
  workflowId: string;
  nextState: Exclude<SubmissionWorkflowState, "DRAFT" | "SUPERSEDED">;
  notes?: string | null;
  createdByType: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const workflow = await tx.submissionWorkflow.findFirst({
      where: {
        id: input.workflowId,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      include: {
        benchmarkPacket: {
          select: {
            id: true,
            version: true,
            status: true,
            generatedAt: true,
            finalizedAt: true,
          },
        },
        filingPacket: {
          select: {
            id: true,
            version: true,
            status: true,
            generatedAt: true,
            finalizedAt: true,
          },
        },
        events: {
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: {
            id: true,
            fromState: true,
            toState: true,
            notes: true,
            createdAt: true,
            createdByType: true,
            createdById: true,
          },
        },
      },
    });

    if (!workflow) {
      throw new NotFoundError("Submission workflow not found");
    }

    if (workflow.state === "SUPERSEDED") {
      throw new WorkflowStateError("Superseded workflows cannot be transitioned.");
    }

    const allowedTransitions = MANUAL_TRANSITIONS[workflow.state];
    if (!allowedTransitions.includes(input.nextState)) {
      throw new WorkflowStateError(
        `Submission workflow cannot transition from ${workflow.state} to ${input.nextState}.`,
      );
    }

    const artifact = workflow.benchmarkPacket ?? workflow.filingPacket;
    if (!artifact) {
      throw new ValidationError("Submission workflow is missing its linked artifact.");
    }

    if (
      (input.nextState === "APPROVED_FOR_SUBMISSION" || input.nextState === "SUBMITTED") &&
      artifact.status !== "FINALIZED"
    ) {
      throw new WorkflowStateError(
        "Submission workflow requires a finalized artifact before approval or submission.",
      );
    }

    const transitioned = await transitionWorkflowTx(tx, {
      workflow,
      nextState: input.nextState,
      notes: input.notes ?? null,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    await createAuditLog(
      {
        actorType: input.createdByType,
        actorId: input.createdById ?? null,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        action: "SUBMISSION_WORKFLOW_TRANSITIONED",
        inputSnapshot: {
          workflowId: transitioned.id,
          workflowType: transitioned.workflowType,
          fromState: workflow.state,
          toState: transitioned.state,
          notes: input.notes ?? null,
        },
        outputSnapshot: {
          linkedArtifactId: artifact.id,
          linkedArtifactVersion: artifact.version,
          linkedArtifactStatus: artifact.status,
          latestTransitionAt: transitioned.latestTransitionAt.toISOString(),
        },
        requestId: input.requestId ?? null,
      },
      tx,
    );

    const refreshed = await tx.submissionWorkflow.findUnique({
      where: { id: transitioned.id },
      include: {
        benchmarkPacket: {
          select: {
            id: true,
            version: true,
            status: true,
            generatedAt: true,
            finalizedAt: true,
          },
        },
        filingPacket: {
          select: {
            id: true,
            version: true,
            status: true,
            generatedAt: true,
            finalizedAt: true,
          },
        },
        events: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            fromState: true,
            toState: true,
            notes: true,
            createdAt: true,
            createdByType: true,
            createdById: true,
          },
        },
      },
    });

    return buildWorkflowDetail(refreshed as WorkflowRecordWithRelations | null);
  });
}

export async function listSubmissionWorkflowSummariesForArtifacts(params: {
  organizationId: string;
  benchmarkPacketIds?: string[];
}) {
  const benchmarkPacketIds = Array.from(new Set(params.benchmarkPacketIds ?? [])).filter(Boolean);

  if (benchmarkPacketIds.length === 0) {
    return {
      benchmarkByPacketId: new Map<string, SubmissionWorkflowSummary>(),
    } satisfies WorkflowSummaryMap;
  }

  const workflows = await prisma.submissionWorkflow.findMany({
    where: {
      organizationId: params.organizationId,
      benchmarkPacketId: { in: benchmarkPacketIds },
    },
    include: {
      benchmarkPacket: {
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          finalizedAt: true,
        },
      },
      filingPacket: {
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          finalizedAt: true,
        },
      },
      events: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          fromState: true,
          toState: true,
          notes: true,
          createdAt: true,
          createdByType: true,
          createdById: true,
        },
      },
    },
    orderBy: [{ latestTransitionAt: "desc" }],
  });

  const benchmarkByPacketId = new Map<string, SubmissionWorkflowSummary>();

  for (const workflow of workflows as WorkflowRecordWithRelations[]) {
    const summary = buildWorkflowSummary(workflow);
    if (!summary) {
      continue;
    }

    if (workflow.benchmarkPacketId && !benchmarkByPacketId.has(workflow.benchmarkPacketId)) {
      benchmarkByPacketId.set(workflow.benchmarkPacketId, summary);
    }
  }

  return {
    benchmarkByPacketId,
  } satisfies WorkflowSummaryMap;
}

export async function getSubmissionWorkflowDetailById(params: {
  organizationId: string;
  workflowId: string;
}) {
  const workflow = await prisma.submissionWorkflow.findFirst({
    where: {
      id: params.workflowId,
      organizationId: params.organizationId,
    },
    include: {
      benchmarkPacket: {
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          finalizedAt: true,
        },
      },
      filingPacket: {
        select: {
          id: true,
          version: true,
          status: true,
          generatedAt: true,
          finalizedAt: true,
        },
      },
      events: {
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          fromState: true,
          toState: true,
          notes: true,
          createdAt: true,
          createdByType: true,
          createdById: true,
        },
      },
    },
  });

  return buildWorkflowDetail(workflow as WorkflowRecordWithRelations | null);
}
