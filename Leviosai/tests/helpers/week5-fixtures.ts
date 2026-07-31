/**
 * Week 5 fixture helpers — create / tear down isolated orgs for integration tests.
 */
import { db } from "../../lib/db.js";
import {
  organizations,
  workspaces,
  sdrConfigs,
  sdrEnrollments,
  sdrLogs,
  sdrCallSessions,
  leads,
} from "../../lib/schema.js";
import { eq, inArray, like } from "drizzle-orm";

export type Week5WorkspaceFixture = {
  orgId: number;
  workspaceId: string;
  leadId: number;
  prompt: string;
  tag: string;
};

export async function createWeek5Workspace(opts: {
  tag: string;
  prompt: string;
  monthlyLeadLimit?: number;
  monthlyLeadsUsed?: number;
  isActive?: boolean;
  dormantDays?: number;
  waitCallHrs?: number;
  waitSmsHrs?: number;
  reEnrollDays?: number;
}): Promise<Week5WorkspaceFixture> {
  const stamp = `${opts.tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `W5 Org ${stamp}`,
      plan: "starter",
    })
    .returning();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      organizationId: org.id,
      name: `W5 WS ${stamp}`,
      tier: "starter",
      isActive: opts.isActive ?? true,
      monthlyLeadLimit: opts.monthlyLeadLimit ?? 500,
      monthlyLeadsUsed: opts.monthlyLeadsUsed ?? 0,
      monthlyMinuteLimit: 1000,
      monthlyMinutesUsed: 0,
      seatLimit: 2,
    })
    .returning();

  await db.insert(sdrConfigs).values({
    workspaceId: workspace.id,
    assistantName: `Aria-${opts.tag}`,
    systemPrompt: opts.prompt,
    smsTemplate: `Hi {{lead_name}}, following up from ${opts.tag}.`,
    emailSubject: `${opts.tag} follow-up for {{lead_name}}`,
    emailBody: `Hello {{lead_name}}, this is the ${opts.tag} email body.`,
    dormantDays: opts.dormantDays ?? 0,
    waitCallHrs: opts.waitCallHrs ?? 0,
    waitSmsHrs: opts.waitSmsHrs ?? 0,
    reEnrollDays: opts.reEnrollDays ?? 7,
    isActive: true,
  });

  const [lead] = await db
    .insert(leads)
    .values({
      organizationId: org.id,
      firstName: "Week5",
      lastName: opts.tag,
      email: `w5_${stamp}@leviosai.test`,
      phone: "+15555550100",
      status: "new",
      consentStatus: "granted",
      dncClean: true,
      timezone: "UTC",
      lastContactedAt: null,
    })
    .returning();

  return {
    orgId: org.id,
    workspaceId: workspace.id,
    leadId: lead.id,
    prompt: opts.prompt,
    tag: opts.tag,
  };
}

export async function cleanupWeek5Fixtures(fixtures: Week5WorkspaceFixture[]): Promise<void> {
  const workspaceIds = fixtures.map((f) => f.workspaceId);
  const orgIds = fixtures.map((f) => f.orgId);
  const leadIds = fixtures.map((f) => f.leadId);
  if (!workspaceIds.length) return;

  await db.delete(sdrLogs).where(inArray(sdrLogs.workspaceId, workspaceIds));
  await db.delete(sdrCallSessions).where(inArray(sdrCallSessions.workspaceId, workspaceIds));
  await db.delete(sdrEnrollments).where(inArray(sdrEnrollments.workspaceId, workspaceIds));
  await db.delete(sdrConfigs).where(inArray(sdrConfigs.workspaceId, workspaceIds));
  if (leadIds.length) {
    await db.delete(leads).where(inArray(leads.id, leadIds));
  }
  await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}

/** Best-effort cleanup of leftover W5 orgs from aborted runs. */
export async function cleanupStaleWeek5Orgs(): Promise<void> {
  const stale = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(like(organizations.name, "W5 Org %"));
  if (!stale.length) return;

  const orgIds = stale.map((o) => o.id);
  const wsRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(inArray(workspaces.organizationId, orgIds));
  const workspaceIds = wsRows.map((w) => w.id);

  if (workspaceIds.length) {
    await db.delete(sdrLogs).where(inArray(sdrLogs.workspaceId, workspaceIds));
    await db.delete(sdrCallSessions).where(inArray(sdrCallSessions.workspaceId, workspaceIds));
    await db.delete(sdrEnrollments).where(inArray(sdrEnrollments.workspaceId, workspaceIds));
    await db.delete(sdrConfigs).where(inArray(sdrConfigs.workspaceId, workspaceIds));
  }

  await db.delete(leads).where(inArray(leads.organizationId, orgIds));
  if (workspaceIds.length) {
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
  }
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}

export async function getEnrollmentStatus(enrollmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: sdrEnrollments.status })
    .from(sdrEnrollments)
    .where(eq(sdrEnrollments.id, enrollmentId))
    .limit(1);
  return row?.status ?? null;
}

export async function waitForEnrollmentStatus(
  enrollmentId: string,
  allowed: string[],
  timeoutMs = 8_000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getEnrollmentStatus(enrollmentId);
    if (status && allowed.includes(status)) return status;
    await new Promise((r) => setTimeout(r, 200));
  }
  const final = await getEnrollmentStatus(enrollmentId);
  throw new Error(
    `Timeout waiting for enrollment ${enrollmentId} in [${allowed.join(", ")}] (got ${final})`
  );
}
