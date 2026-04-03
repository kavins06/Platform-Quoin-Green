import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { BUILDING_TEARDOWN_DELEGATES } from "@/server/lifecycle/building-teardown";

type OrganizationScope = {
  organizationId: string;
};

type OrganizationTeardownDelegateName =
  | (typeof BUILDING_TEARDOWN_DELEGATES)[number]
  | "portfolioManagerProvisioningState"
  | "portfolioManagerSetupState"
  | "portfolioManagerPropertyUseInput"
  | "portfolioManagerMeterLinkState"
  | "portfolioManagerUsageState"
  | "portfolioManagerRemoteMeter"
  | "portfolioManagerRemoteProperty"
  | "portfolioManagerImportState"
  | "portfolioManagerManagement"
  | "organizationMembership";

const ORGANIZATION_TEARDOWN_DELEGATES = [
  ...BUILDING_TEARDOWN_DELEGATES,
  "portfolioManagerProvisioningState",
  "portfolioManagerSetupState",
  "portfolioManagerPropertyUseInput",
  "portfolioManagerMeterLinkState",
  "portfolioManagerUsageState",
  "portfolioManagerRemoteMeter",
  "portfolioManagerRemoteProperty",
  "portfolioManagerImportState",
  "portfolioManagerManagement",
  "organizationMembership",
] as const satisfies readonly OrganizationTeardownDelegateName[];

type DeleteManyDelegate = {
  deleteMany: (args: { where: OrganizationScope }) => Promise<unknown>;
};

function getDeleteManyDelegate(
  tx: Prisma.TransactionClient,
  delegateName: OrganizationTeardownDelegateName,
) {
  return tx[delegateName] as unknown as DeleteManyDelegate;
}

async function deleteOrganizationChildrenTx(
  tx: Prisma.TransactionClient,
  scope: OrganizationScope,
) {
  await tx.portfolioManagerRemoteProperty.updateMany({
    where: {
      organizationId: scope.organizationId,
      linkedBuildingId: {
        not: null,
      },
    },
    data: {
      linkedBuildingId: null,
    },
  });

  for (const delegateName of ORGANIZATION_TEARDOWN_DELEGATES) {
    await getDeleteManyDelegate(tx, delegateName).deleteMany({
      where: scope,
    });
  }
}

export async function deleteOrganizationLifecycle(input: OrganizationScope) {
  await prisma.$transaction(async (tx) => {
    await deleteOrganizationChildrenTx(tx, input);

    await tx.building.deleteMany({
      where: {
        organizationId: input.organizationId,
      },
    });

    await tx.organization.delete({
      where: {
        id: input.organizationId,
      },
    });
  });
}
