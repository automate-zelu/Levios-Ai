import { eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import { workspaces } from "./schema.js";
import { ensureTestCreditColumn } from "./schema-ensure.js";
import { getTierLimits } from "./tiers.js";
import {
  billableTestSeconds,
  minutesToSeconds,
  planTestCreditConsume,
  snapshotTestCredits,
  type TestCreditSnapshot,
} from "./test-credits.js";

export async function readTestCreditSnapshot(workspaceId: string): Promise<TestCreditSnapshot | null> {
  await ensureTestCreditColumn();
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) return null;
  return snapshotTestCredits({
    tier: ws.tier,
    testUsed: (ws as any).monthlyTestMinutesUsed ?? 0,
    paidUsed: ws.monthlyMinutesUsed,
    paidLimit: ws.monthlyMinuteLimit,
  });
}

export async function consumeTestCallMinutes(
  workspaceId: string,
  durationSeconds: number,
  allowPaid = true
): Promise<TestCreditSnapshot & { billedSeconds: number; billedMinutes: number; consumeMessage: string }> {
  await ensureTestCreditColumn();
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) {
    throw new Error("Workspace not found");
  }
  const seconds = billableTestSeconds(durationSeconds);
  const limits = getTierLimits(ws.tier);
  const plan = planTestCreditConsume({
    seconds,
    testUsed: (ws as any).monthlyTestMinutesUsed ?? 0,
    testLimit: minutesToSeconds(limits.monthlyTestMinuteLimit),
    paidUsed: ws.monthlyMinutesUsed,
    paidLimit: ws.monthlyMinuteLimit,
    allowPaid,
  });
  if (!plan.allowed) {
    const snap = snapshotTestCredits({
      tier: ws.tier,
      testUsed: (ws as any).monthlyTestMinutesUsed ?? 0,
      paidUsed: ws.monthlyMinutesUsed,
      paidLimit: ws.monthlyMinuteLimit,
    });
    return { ...snap, billedSeconds: 0, billedMinutes: 0, consumeMessage: plan.message };
  }

  await db
    .update(workspaces)
    .set({
      monthlyTestMinutesUsed: sql`COALESCE(${workspaces.monthlyTestMinutesUsed}, 0) + ${plan.testDelta}`,
      monthlyMinutesUsed: sql`${workspaces.monthlyMinutesUsed} + ${plan.paidDelta}`,
      updatedAt: new Date(),
    } as any)
    .where(eq(workspaces.id, workspaceId));

  const next = await readTestCreditSnapshot(workspaceId);
  const billedSeconds = plan.testDelta + plan.paidDeltaSeconds;
  return {
    ...(next as TestCreditSnapshot),
    billedSeconds,
    billedMinutes: billedSeconds / 60,
    consumeMessage: plan.message,
    usingPaid: plan.usingPaid,
    pool: plan.pool,
    message: plan.message,
  };
}
