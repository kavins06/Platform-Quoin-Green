export const LATEST_SNAPSHOT_ORDER = [
  { snapshotDate: "desc" as const },
  { id: "desc" as const },
];

type LatestComplianceSnapshotInput = {
  buildingId: string;
  organizationId?: string;
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
};

type ComplianceSnapshotLookupClient = {
  complianceSnapshot: any;
};

export async function getLatestComplianceSnapshot(
  db: ComplianceSnapshotLookupClient,
  input: LatestComplianceSnapshotInput,
) {
  return db.complianceSnapshot.findFirst({
    where: {
      buildingId: input.buildingId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.where ?? {}),
    },
    orderBy: LATEST_SNAPSHOT_ORDER,
    ...(input.select ? { select: input.select } : {}),
    ...(input.include ? { include: input.include } : {}),
  });
}
