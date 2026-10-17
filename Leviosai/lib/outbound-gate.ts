/**
 * Blocks live outbound call / SMS / email when the workspace is inactive
 * (no paid subscription) or the org is service-paused (non-payment).
 */

import { db } from "./db.js";
import { workspaces } from "./schema.js";
import { eq } from "drizzle-orm";
import { isOrgServicePaused } from "./commercial-pricing-service.js";
import { SERVICE_PAUSED_BANNER } from "./billing-pause.js";

export type OutboundBlockReason = "workspace_inactive" | "service_paused";

export type OutboundGateState = {
  allowed: boolean;
  reason: OutboundBlockReason | null;
  message: string | null;
  workspaceActive: boolean;
  servicePaused: boolean;
  subscribePath: "/billing";
};

export const OUTBOUND_INACTIVE_MESSAGE =
  "Outbound calling, SMS, and email are locked until billing is active. Open Billing to subscribe or reactivate.";

export const OUTBOUND_PAUSED_MESSAGE = SERVICE_PAUSED_BANNER;

export async function getOutboundGateState(
  organizationId: number | null | undefined
): Promise<OutboundGateState> {
  const base: OutboundGateState = {
    allowed: false,
    reason: "workspace_inactive",
    message: OUTBOUND_INACTIVE_MESSAGE,
    workspaceActive: false,
    servicePaused: false,
    subscribePath: "/billing",
  };

  if (!organizationId) return base;

  const [ws] = await db
    .select({
      id: workspaces.id,
      isActive: workspaces.isActive,
    })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId))
    .limit(1);

  const workspaceActive = !!ws?.isActive;
  let servicePaused = false;
  try {
    servicePaused = await isOrgServicePaused(organizationId);
  } catch {
    servicePaused = false;
  }

  if (servicePaused) {
    return {
      allowed: false,
      reason: "service_paused",
      message: OUTBOUND_PAUSED_MESSAGE,
      workspaceActive,
      servicePaused: true,
      subscribePath: "/billing",
    };
  }

  if (!workspaceActive) {
    return {
      allowed: false,
      reason: "workspace_inactive",
      message: OUTBOUND_INACTIVE_MESSAGE,
      workspaceActive: false,
      servicePaused: false,
      subscribePath: "/billing",
    };
  }

  return {
    allowed: true,
    reason: null,
    message: null,
    workspaceActive: true,
    servicePaused: false,
    subscribePath: "/billing",
  };
}

/** Express-friendly denial payload (402 for unpaid/inactive, 403 for pause). */
export function outboundGateHttp(gate: OutboundGateState): {
  status: number;
  body: Record<string, unknown>;
} {
  const status = gate.reason === "service_paused" ? 403 : 402;
  return {
    status,
    body: {
      error: gate.message || OUTBOUND_INACTIVE_MESSAGE,
      code: gate.reason || "workspace_inactive",
      subscribe: gate.subscribePath,
      outboundBlocked: true,
      workspaceActive: gate.workspaceActive,
      servicePaused: gate.servicePaused,
    },
  };
}
