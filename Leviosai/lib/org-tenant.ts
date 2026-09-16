/**
 * Tenant model:
 *   User  N ── 1  Organization
 *
 * Organization is the shared account (billing, leads, SDR).
 * Users never own Twilio/usage/the agent — the org does.
 *
 * The `workspaces` table is an internal 1:1 SDR row for that org
 * (phone number, usage counters, agent config FK). It is not a second
 * company and is never chosen independently of organizationId.
 */

import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { organizations, workspaces } from "./schema.js";
import { getTierLimits } from "./tiers.js";
import { ensureTestCreditColumn } from "./schema-ensure.js";

export type OrgSdr = {
  organizationId: number;
  organizationName: string;
  workspaceId: string;
  tier: string;
  isActive: boolean;
};

export async function getOrgSdr(organizationId: number): Promise<OrgSdr | null> {
  const [row] = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      workspaceId: workspaces.id,
      tier: workspaces.tier,
      isActive: workspaces.isActive,
    })
    .from(organizations)
    .innerJoin(workspaces, eq(workspaces.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row || null;
}

/** Load the org's SDR row, creating the 1:1 record if an older org is missing it. */
export async function ensureOrgSdr(organizationId: number): Promise<OrgSdr> {
  await ensureTestCreditColumn();
  const existing = await getOrgSdr(organizationId);
  if (existing) return existing;

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new Error("Organization not found");

  const starter = getTierLimits("starter");
  try {
    const [ws] = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: org.name,
        tier: "starter",
        monthlyLeadLimit: starter.monthlyLeadLimit,
        monthlyMinuteLimit: starter.monthlyMinuteLimit,
        seatLimit: starter.seatLimit,
      })
      .returning({
        id: workspaces.id,
        tier: workspaces.tier,
        isActive: workspaces.isActive,
      });
    return {
      organizationId: org.id,
      organizationName: org.name,
      workspaceId: ws.id,
      tier: ws.tier,
      isActive: ws.isActive,
    };
  } catch {
    const raced = await getOrgSdr(organizationId);
    if (raced) return raced;
    throw new Error("Failed to attach SDR to organization");
  }
}
