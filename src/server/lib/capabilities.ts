import { AuthorizationError } from "@/server/lib/errors";
import type { AppRole } from "@/server/lib/organization-membership";

export const CAPABILITIES = [
  "ORG_VIEW",
  "ORG_SWITCH",
  "ORG_CREATE",
  "ORG_MEMBERS_MANAGE",
  "ORG_DELETE",
  "BUILDING_VIEW",
  "BUILDING_WRITE",
  "BUILDING_DELETE",
  "BUILDING_DELETE_REMOTE_REQUEST",
  "BUILDING_DELETE_REMOTE_EXECUTE",
  "DATA_UPLOAD",
  "PM_CONNECT",
  "PM_PULL",
  "PM_PUSH_REQUEST",
  "PM_PUSH_EXECUTE",
  "SUBMISSION_TRANSITION_REQUEST",
  "SUBMISSION_TRANSITION_EXECUTE",
  "GOVERNANCE_VIEW",
  "RUNTIME_VIEW",
  "APPROVAL_REVIEW",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ADMIN_CAPABILITIES = [...CAPABILITIES] as Capability[];

const MANAGER_CAPABILITIES: Capability[] = [
  "ORG_VIEW",
  "ORG_SWITCH",
  "ORG_CREATE",
  "BUILDING_VIEW",
  "BUILDING_WRITE",
  "BUILDING_DELETE",
  "BUILDING_DELETE_REMOTE_REQUEST",
  "DATA_UPLOAD",
  "PM_CONNECT",
  "PM_PULL",
  "PM_PUSH_REQUEST",
  "SUBMISSION_TRANSITION_REQUEST",
  "GOVERNANCE_VIEW",
  "RUNTIME_VIEW",
];

const ENGINEER_CAPABILITIES: Capability[] = [
  "ORG_VIEW",
  "ORG_SWITCH",
  "BUILDING_VIEW",
  "BUILDING_WRITE",
  "DATA_UPLOAD",
  "PM_PULL",
];

const VIEWER_CAPABILITIES: Capability[] = [
  "ORG_VIEW",
  "ORG_SWITCH",
  "BUILDING_VIEW",
];

const ROLE_CAPABILITY_MAP: Record<AppRole, Capability[]> = {
  ADMIN: ADMIN_CAPABILITIES,
  MANAGER: MANAGER_CAPABILITIES,
  ENGINEER: ENGINEER_CAPABILITIES,
  VIEWER: VIEWER_CAPABILITIES,
};

export function listCapabilitiesForRole(role: AppRole): Capability[] {
  return ROLE_CAPABILITY_MAP[role];
}

export function hasCapability(role: AppRole, capability: Capability) {
  return ROLE_CAPABILITY_MAP[role].includes(capability);
}

export function requireCapability(input: {
  role: AppRole;
  capability: Capability;
  message?: string;
}) {
  if (hasCapability(input.role, input.capability)) {
    return;
  }

  throw new AuthorizationError(
    input.message ?? "You do not have permission to perform this action.",
    {
      httpStatus: 403,
      details: {
        requiredCapability: input.capability,
        role: input.role,
      },
    },
  );
}
