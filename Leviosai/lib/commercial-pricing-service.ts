/**
 * Persistence + booking hooks for commercial pricing
 * (global monthly retainer + per-org appointment fees).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  appointmentCharges,
  organizations,
  platformBillingSettings,
  users,
  workspaces,
} from "./schema.js";
import {
  APPOINTMENT_FEE_MAX_CENTS,
  APPOINTMENT_FEE_MIN_CENTS,
  DEFAULT_APPOINTMENT_FEE_CENTS,
  DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
  MONTHLY_FEE_MAX_CENTS,
  MONTHLY_FEE_MIN_CENTS,
  formatUsdFromCents,
  normalizeCents,
  planAppointmentCharge,
  resolveCommercialPricing,
  validateFeeCents,
  type OrgCommercialOverrides,
  type PlatformCommercialDefaults,
  type ResolvedCommercialPricing,
} from "./commercial-pricing.js";
import { formatCycleLabel } from "./subscription-cycle.js";
import { storage } from "./storage.js";
import {
  clearPausePatch,
  isBillingCadence,
  pausePatchOnFailure,
  shouldAutoPauseOnPaymentFailure,
  type BillingCadence,
} from "./billing-pause.js";

let schemaReady = false;

export async function ensureCommercialPricingSchema(): Promise<void> {
  if (schemaReady) return;
  try {
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS monthly_fee_enabled BOOLEAN
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS monthly_fee_override_cents INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS appointment_fee_enabled BOOLEAN
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cost_per_appointment_cents INTEGER
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_billing_settings (
        id SERIAL PRIMARY KEY,
        monthly_fee_cents INTEGER NOT NULL DEFAULT 29700,
        monthly_fee_enabled_by_default BOOLEAN NOT NULL DEFAULT TRUE,
        default_appointment_fee_cents INTEGER NOT NULL DEFAULT 40000,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS appointment_charges (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        appointment_id INTEGER,
        lead_id INTEGER,
        workspace_id UUID,
        fee_kind TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        description TEXT,
        stripe_invoice_item_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS appointment_charges_appt_unique
      ON appointment_charges (appointment_id)
      WHERE appointment_id IS NOT NULL AND fee_kind = 'appointment'
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS billing_cycle_anchor_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS subscription_canceled_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS last_billing_error TEXT
    `);
    await db.execute(sql`
      ALTER TABLE appointment_charges
      ADD COLUMN IF NOT EXISTS period_key TEXT
    `);
    await db.execute(sql`
      ALTER TABLE appointment_charges
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT
    `);
    await db.execute(sql`
      ALTER TABLE appointment_charges
      ADD COLUMN IF NOT EXISTS last_charge_error TEXT
    `);
    await db.execute(sql`
      ALTER TABLE appointment_charges
      ADD COLUMN IF NOT EXISTS last_charge_attempt_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE appointment_charges
      ADD COLUMN IF NOT EXISTS charged_at TIMESTAMP
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS appointment_charges_monthly_period_unique
      ON appointment_charges (organization_id, period_key)
      WHERE fee_kind = 'monthly' AND period_key IS NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS billing_cadence TEXT NOT NULL DEFAULT 'per_appointment'
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS payment_plan_approved BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS pause_exempt BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS service_paused BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS pause_reason TEXT
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        workspace_id UUID,
        meter_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        period_key TEXT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS usage_events_org_period_idx
      ON usage_events (organization_id, period_key)
    `);
    schemaReady = true;
  } catch (err: any) {
    console.error("ensureCommercialPricingSchema:", err?.message || err);
  }
}

function platformFromRow(row: typeof platformBillingSettings.$inferSelect | null | undefined): PlatformCommercialDefaults {
  return {
    monthlyFeeCents: normalizeCents(row?.monthlyFeeCents, DEFAULT_GLOBAL_MONTHLY_FEE_CENTS),
    monthlyFeeEnabledByDefault: row?.monthlyFeeEnabledByDefault ?? true,
    defaultAppointmentFeeCents: normalizeCents(
      row?.defaultAppointmentFeeCents,
      DEFAULT_APPOINTMENT_FEE_CENTS
    ),
  };
}

function orgFromRow(row: typeof organizations.$inferSelect | null | undefined): OrgCommercialOverrides {
  return {
    monthlyFeeEnabled: row?.monthlyFeeEnabled ?? null,
    monthlyFeeOverrideCents: row?.monthlyFeeOverrideCents ?? null,
    appointmentFeeEnabled: row?.appointmentFeeEnabled ?? null,
    costPerAppointmentCents: row?.costPerAppointmentCents ?? null,
  };
}

export async function getPlatformCommercialDefaults(): Promise<PlatformCommercialDefaults> {
  await ensureCommercialPricingSchema();
  const [row] = await db
    .select()
    .from(platformBillingSettings)
    .where(eq(platformBillingSettings.id, 1))
    .limit(1);
  if (row) return platformFromRow(row);

  try {
    await db.insert(platformBillingSettings).values({
      id: 1,
      monthlyFeeCents: DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
      monthlyFeeEnabledByDefault: true,
      defaultAppointmentFeeCents: DEFAULT_APPOINTMENT_FEE_CENTS,
    });
  } catch {
    /* race: another request inserted */
  }
  return {
    monthlyFeeCents: DEFAULT_GLOBAL_MONTHLY_FEE_CENTS,
    monthlyFeeEnabledByDefault: true,
    defaultAppointmentFeeCents: DEFAULT_APPOINTMENT_FEE_CENTS,
  };
}

export async function updatePlatformCommercialDefaults(
  patch: Partial<PlatformCommercialDefaults>
): Promise<PlatformCommercialDefaults> {
  await ensureCommercialPricingSchema();
  await getPlatformCommercialDefaults();

  const updates: Partial<typeof platformBillingSettings.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.monthlyFeeCents != null) {
    updates.monthlyFeeCents = validateFeeCents(patch.monthlyFeeCents, {
      min: MONTHLY_FEE_MIN_CENTS,
      max: MONTHLY_FEE_MAX_CENTS,
      label: "Monthly retainer",
    });
  }
  if (patch.monthlyFeeEnabledByDefault === false) {
    throw new Error("Monthly retainer cannot be disabled.");
  }
  if (patch.monthlyFeeEnabledByDefault != null) {
    updates.monthlyFeeEnabledByDefault = true;
  }
  if (patch.defaultAppointmentFeeCents != null) {
    updates.defaultAppointmentFeeCents = normalizeCents(
      patch.defaultAppointmentFeeCents,
      DEFAULT_APPOINTMENT_FEE_CENTS
    );
  }

  await db
    .update(platformBillingSettings)
    .set(updates)
    .where(eq(platformBillingSettings.id, 1));

  return getPlatformCommercialDefaults();
}

export async function getOrgCommercialPricing(
  organizationId: number
): Promise<ResolvedCommercialPricing & { organizationId: number }> {
  await ensureCommercialPricingSchema();
  const platform = await getPlatformCommercialDefaults();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return {
    organizationId,
    ...resolveCommercialPricing(platform, orgFromRow(org)),
  };
}

export async function updateOrgCommercialPricing(
  organizationId: number,
  patch: {
    monthlyFeeEnabled?: boolean | null;
    monthlyFeeOverrideCents?: number | null;
    appointmentFeeEnabled?: boolean | null;
    costPerAppointmentCents?: number | null;
    clearMonthlyOverride?: boolean;
    billingCadence?: BillingCadence | string | null;
    paymentPlanApproved?: boolean | null;
    pauseExempt?: boolean | null;
    /** Actor email/id for activity audit (P1.2). */
    actorUserId?: number | null;
    actorLabel?: string | null;
  }
): Promise<ResolvedCommercialPricing & { organizationId: number }> {
  await ensureCommercialPricingSchema();
  const before = await getOrgCommercialPricing(organizationId);
  const updates: Record<string, unknown> = {
    // Monthly retainer is always on. Amount changes apply to future periods only.
    monthlyFeeEnabled: true,
  };

  if (patch.monthlyFeeEnabled === false) {
    throw new Error("Monthly retainer cannot be disabled. Existing charges are not changed.");
  }
  if (patch.clearMonthlyOverride) {
    updates.monthlyFeeOverrideCents = null;
  } else if ("monthlyFeeOverrideCents" in patch) {
    updates.monthlyFeeOverrideCents =
      patch.monthlyFeeOverrideCents == null
        ? null
        : validateFeeCents(patch.monthlyFeeOverrideCents, {
            min: MONTHLY_FEE_MIN_CENTS,
            max: MONTHLY_FEE_MAX_CENTS,
            label: "Monthly retainer override",
          });
  }
  if ("appointmentFeeEnabled" in patch) {
    // Off = no NEW appointment charges. Existing appointment lines keep their amount/status.
    updates.appointmentFeeEnabled =
      patch.appointmentFeeEnabled == null ? null : !!patch.appointmentFeeEnabled;
  }
  if ("costPerAppointmentCents" in patch) {
    updates.costPerAppointmentCents =
      patch.costPerAppointmentCents == null
        ? null
        : validateFeeCents(patch.costPerAppointmentCents, {
            min: APPOINTMENT_FEE_MIN_CENTS,
            max: APPOINTMENT_FEE_MAX_CENTS,
            label: "Per-appointment fee",
          });
  }
  if ("billingCadence" in patch && patch.billingCadence != null) {
    if (!isBillingCadence(patch.billingCadence)) {
      throw new Error("billingCadence must be per_appointment, weekly, or monthly");
    }
    updates.billingCadence = patch.billingCadence;
  }
  if ("paymentPlanApproved" in patch) {
    updates.paymentPlanApproved = !!patch.paymentPlanApproved;
    // Approving a weekly/monthly plan implies pause exemption unless explicitly cleared.
    if (patch.paymentPlanApproved && !("pauseExempt" in patch)) {
      updates.pauseExempt = true;
    }
  }
  if ("pauseExempt" in patch) {
    updates.pauseExempt = !!patch.pauseExempt;
  }

  await db.update(organizations).set(updates).where(eq(organizations.id, organizationId));
  const after = await getOrgCommercialPricing(organizationId);

  const feeChanged =
    before.monthlyFeeCents !== after.monthlyFeeCents ||
    before.appointmentFeeCents !== after.appointmentFeeCents ||
    before.appointmentFeeEnabled !== after.appointmentFeeEnabled;
  if (feeChanged) {
    try {
      await storage.logActivity({
        organizationId,
        action: "commercial_pricing_updated",
        entityType: "organization",
        entityId: organizationId,
        details: JSON.stringify({
          by: patch.actorLabel || patch.actorUserId || "admin",
          before: {
            monthlyFeeCents: before.monthlyFeeCents,
            appointmentFeeCents: before.appointmentFeeCents,
            appointmentFeeEnabled: before.appointmentFeeEnabled,
          },
          after: {
            monthlyFeeCents: after.monthlyFeeCents,
            appointmentFeeCents: after.appointmentFeeCents,
            appointmentFeeEnabled: after.appointmentFeeEnabled,
          },
        }),
      });
    } catch (err: any) {
      console.warn("commercial pricing audit log failed:", err?.message || err);
    }
  }

  return after;
}

export async function getOrgBillingPauseState(organizationId: number) {
  await ensureCommercialPricingSchema();
  const [org] = await db
    .select({
      billingCadence: organizations.billingCadence,
      paymentPlanApproved: organizations.paymentPlanApproved,
      pauseExempt: organizations.pauseExempt,
      servicePaused: organizations.servicePaused,
      pausedAt: organizations.pausedAt,
      pauseReason: organizations.pauseReason,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return {
    billingCadence: (org?.billingCadence as BillingCadence) || "per_appointment",
    paymentPlanApproved: !!org?.paymentPlanApproved,
    pauseExempt: !!org?.pauseExempt,
    servicePaused: !!org?.servicePaused,
    pausedAt: org?.pausedAt || null,
    pauseReason: org?.pauseReason || null,
  };
}

/** Pause outbound AI after payment failure unless exempt. Also deactivates workspaces. */
export async function pauseOrgForNonPayment(
  organizationId: number,
  reason = "payment_failed"
): Promise<{ paused: boolean; skipped: boolean }> {
  await ensureCommercialPricingSchema();
  const state = await getOrgBillingPauseState(organizationId);
  if (!shouldAutoPauseOnPaymentFailure(state)) {
    return { paused: false, skipped: true };
  }
  await db
    .update(organizations)
    .set(pausePatchOnFailure(reason))
    .where(eq(organizations.id, organizationId));
  await db
    .update(workspaces)
    .set({ isActive: false })
    .where(eq(workspaces.organizationId, organizationId));
  try {
    await storage.logActivity({
      organizationId,
      action: "service_paused",
      entityType: "organization",
      entityId: organizationId,
      details: reason,
    });
  } catch {
    /* non-fatal */
  }
  return { paused: true, skipped: false };
}

export async function resumeOrgAfterPayment(organizationId: number): Promise<void> {
  await ensureCommercialPricingSchema();
  await db
    .update(organizations)
    .set(clearPausePatch())
    .where(eq(organizations.id, organizationId));
  try {
    await storage.logActivity({
      organizationId,
      action: "service_resumed",
      entityType: "organization",
      entityId: organizationId,
      details: "payment_succeeded",
    });
  } catch {
    /* non-fatal */
  }
}

export async function isOrgServicePaused(organizationId: number): Promise<boolean> {
  const state = await getOrgBillingPauseState(organizationId);
  return state.servicePaused;
}

export async function listPricingClients() {
  await ensureCommercialPricingSchema();
  const platform = await getPlatformCommercialDefaults();

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      organizationId: users.organizationId,
      createdAt: users.createdAt,
      orgName: organizations.name,
      orgIndustry: organizations.industry,
      orgPlan: organizations.plan,
      orgCreatedAt: organizations.createdAt,
      monthlyFeeEnabled: organizations.monthlyFeeEnabled,
      monthlyFeeOverrideCents: organizations.monthlyFeeOverrideCents,
      appointmentFeeEnabled: organizations.appointmentFeeEnabled,
      costPerAppointmentCents: organizations.costPerAppointmentCents,
    })
    .from(users)
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .orderBy(desc(users.createdAt));

  const wsRows = await db
    .select({
      organizationId: workspaces.organizationId,
      id: workspaces.id,
      name: workspaces.name,
      isActive: workspaces.isActive,
    })
    .from(workspaces);

  return userRows.map((row) => {
    const orgWorkspaces = wsRows.filter((w) => w.organizationId === row.organizationId);
    const pricing = row.organizationId
      ? resolveCommercialPricing(platform, {
          monthlyFeeEnabled: row.monthlyFeeEnabled,
          monthlyFeeOverrideCents: row.monthlyFeeOverrideCents,
          appointmentFeeEnabled: row.appointmentFeeEnabled,
          costPerAppointmentCents: row.costPerAppointmentCents,
        })
      : null;
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      createdAt: row.createdAt,
      organization: row.organizationId
        ? {
            id: row.organizationId,
            name: row.orgName,
            industry: row.orgIndustry,
            plan: row.orgPlan,
            createdAt: row.orgCreatedAt,
            workspaceCount: orgWorkspaces.length,
            workspaces: orgWorkspaces.map((w) => ({
              id: w.id,
              name: w.name,
              isActive: w.isActive,
            })),
          }
        : null,
      pricing,
    };
  });
}

export async function listRecentAppointmentCharges(
  organizationId: number,
  limit = 20
): Promise<(typeof appointmentCharges.$inferSelect)[]> {
  await ensureCommercialPricingSchema();
  return db
    .select()
    .from(appointmentCharges)
    .where(eq(appointmentCharges.organizationId, organizationId))
    .orderBy(desc(appointmentCharges.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));
}

export interface RecordBookingChargeInput {
  organizationId: number;
  appointmentId: number;
  leadId?: number | null;
  workspaceId?: string | null;
  source?: string;
}

/**
 * Bill the Levios client for a booked appointment when their per-job fee is on.
 * Idempotent on appointmentId — safe to call from voice + hangup paths.
 * Disabling the org appointment fee later does not alter rows already inserted.
 * Canceling monthly auto-renew does not skip this charge — the card is still billed.
 */
export async function recordBookingAppointmentCharge(
  input: RecordBookingChargeInput
): Promise<{ charged: boolean; amountCents: number; chargeId?: number; skippedReason?: string }> {
  await ensureCommercialPricingSchema();
  const pricing = await getOrgCommercialPricing(input.organizationId);
  const plan = planAppointmentCharge(pricing);
  if (!plan) {
    return {
      charged: false,
      amountCents: 0,
      skippedReason: pricing.appointmentFeeEnabled ? "zero_rate" : "fee_disabled",
    };
  }

  const existing = await db
    .select({ id: appointmentCharges.id, amountCents: appointmentCharges.amountCents })
    .from(appointmentCharges)
    .where(
      and(
        eq(appointmentCharges.appointmentId, input.appointmentId),
        eq(appointmentCharges.feeKind, "appointment")
      )
    )
    .limit(1);
  if (existing[0]) {
    void import("./subscription-billing.js")
      .then(({ collectChargeFromCard }) => collectChargeFromCard(existing[0].id))
      .catch((err: Error) =>
        console.error(`Appointment card charge retry failed for #${existing[0].id}:`, err.message)
      );
    return { charged: false, amountCents: existing[0].amountCents, chargeId: existing[0].id, skippedReason: "already_charged" };
  }

  let workspaceId = input.workspaceId || null;
  if (!workspaceId) {
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.organizationId, input.organizationId))
      .limit(1);
    workspaceId = ws?.id || null;
  }

  const description = `Appointment booking fee (${formatUsdFromCents(plan.amountCents)})${
    input.source ? ` — ${input.source}` : ""
  }`;

  try {
    const [row] = await db
      .insert(appointmentCharges)
      .values({
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
        leadId: input.leadId ?? null,
        workspaceId,
        feeKind: "appointment",
        amountCents: plan.amountCents,
        status: "pending",
        description,
      })
      .returning();

    void import("./subscription-billing.js")
      .then(({ collectChargeFromCard }) => collectChargeFromCard(row.id))
      .catch((err: Error) =>
        console.error(`Appointment card charge failed for #${row.id}:`, err.message)
      );

    return { charged: true, amountCents: plan.amountCents, chargeId: row.id };
  } catch (err: any) {
    // Unique index race
    if (String(err?.message || "").includes("appointment_charges_appt_unique")) {
      return { charged: false, amountCents: plan.amountCents, skippedReason: "already_charged" };
    }
    throw err;
  }
}

/** YYYY-MM in local time for bill periods. */
export function billingPeriodKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function billingPeriodBounds(period: string): { start: Date; end: Date; label: string } {
  const [ys, ms] = period.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error("Invalid period. Use YYYY-MM.");
  }
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  const label = start.toLocaleString(undefined, { month: "long", year: "numeric" });
  return { start, end, label };
}

function monthlyRetainerDescription(period: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return `Monthly retainer — ${formatCycleLabel(period)}`;
  }
  return `Monthly retainer — ${period}`;
}

/** Ensure the monthly retainer line exists for this org/period when monthly fee is on. */
export async function ensureMonthlyRetainerCharge(
  organizationId: number,
  period = billingPeriodKey()
): Promise<typeof appointmentCharges.$inferSelect | null> {
  await ensureCommercialPricingSchema();
  const pricing = await getOrgCommercialPricing(organizationId);
  if (!pricing.monthlyFeeEnabled || pricing.monthlyFeeCents <= 0) return null;

  const description = monthlyRetainerDescription(period);
  const existingByKey = await db
    .select()
    .from(appointmentCharges)
    .where(
      and(
        eq(appointmentCharges.organizationId, organizationId),
        eq(appointmentCharges.feeKind, "monthly"),
        eq(appointmentCharges.periodKey, period)
      )
    )
    .limit(1);
  if (existingByKey[0]) return existingByKey[0];

  const existingByDesc = await db
    .select()
    .from(appointmentCharges)
    .where(
      and(
        eq(appointmentCharges.organizationId, organizationId),
        eq(appointmentCharges.feeKind, "monthly"),
        eq(appointmentCharges.description, description)
      )
    )
    .limit(1);
  if (existingByDesc[0]) return existingByDesc[0];

  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId))
    .limit(1);

  try {
    const [row] = await db
      .insert(appointmentCharges)
      .values({
        organizationId,
        appointmentId: null,
        leadId: null,
        workspaceId: ws?.id || null,
        feeKind: "monthly",
        amountCents: pricing.monthlyFeeCents,
        status: "pending",
        description,
        periodKey: period,
      })
      .returning();
    return row;
  } catch (err: any) {
    if (String(err?.message || "").includes("appointment_charges_monthly_period_unique")) {
      const [again] = await db
        .select()
        .from(appointmentCharges)
        .where(
          and(
            eq(appointmentCharges.organizationId, organizationId),
            eq(appointmentCharges.feeKind, "monthly"),
            eq(appointmentCharges.periodKey, period)
          )
        )
        .limit(1);
      return again || null;
    }
    throw err;
  }
}

export async function listPlatformCharges(opts: {
  organizationId?: number;
  period?: string;
  year?: number | string;
  startDate?: string;
  endDate?: string;
  status?: string;
  feeKind?: string;
  q?: string;
  limit?: number;
} = {}) {
  await ensureCommercialPricingSchema();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const conditions = [];
  if (opts.organizationId) {
    conditions.push(eq(appointmentCharges.organizationId, opts.organizationId));
  }
  if (opts.status) {
    conditions.push(eq(appointmentCharges.status, opts.status));
  }
  if (opts.feeKind) {
    conditions.push(eq(appointmentCharges.feeKind, opts.feeKind));
  }

  const hasCustomRange = Boolean(opts.startDate || opts.endDate);
  if (hasCustomRange) {
    if (opts.startDate) {
      const start = new Date(`${opts.startDate}T00:00:00`);
      if (!Number.isNaN(start.getTime())) {
        conditions.push(sql`${appointmentCharges.createdAt} >= ${start}`);
      }
    }
    if (opts.endDate) {
      const end = new Date(`${opts.endDate}T23:59:59.999`);
      if (!Number.isNaN(end.getTime())) {
        conditions.push(sql`${appointmentCharges.createdAt} <= ${end}`);
      }
    }
  } else if (opts.period) {
    const { start, end } = billingPeriodBounds(opts.period);
    const retainerDesc = monthlyRetainerDescription(opts.period);
    conditions.push(sql`(
      (${appointmentCharges.createdAt} >= ${start} AND ${appointmentCharges.createdAt} < ${end})
      OR ${appointmentCharges.description} = ${retainerDesc}
      OR ${appointmentCharges.periodKey} = ${opts.period}
      OR ${appointmentCharges.periodKey} LIKE ${`${opts.period}-%`}
    )`);
  } else if (opts.year != null && String(opts.year).trim() !== "") {
    const y = Number(opts.year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      throw new Error("Invalid year");
    }
    const start = new Date(y, 0, 1, 0, 0, 0, 0);
    const end = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    const yearPrefix = `Monthly retainer — ${y}-`;
    conditions.push(sql`(
      (${appointmentCharges.createdAt} >= ${start} AND ${appointmentCharges.createdAt} < ${end})
      OR ${appointmentCharges.description} LIKE ${`${yearPrefix}%`}
    )`);
  }
  if (opts.q && String(opts.q).trim()) {
    const needle = `%${String(opts.q).trim().replace(/%/g, "")}%`;
    conditions.push(sql`(
      ${organizations.name} ILIKE ${needle}
      OR COALESCE(${appointmentCharges.description}, '') ILIKE ${needle}
      OR CAST(${appointmentCharges.id} AS TEXT) = ${String(opts.q).trim()}
    )`);
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select({
      id: appointmentCharges.id,
      organizationId: appointmentCharges.organizationId,
      organizationName: organizations.name,
      appointmentId: appointmentCharges.appointmentId,
      leadId: appointmentCharges.leadId,
      workspaceId: appointmentCharges.workspaceId,
      feeKind: appointmentCharges.feeKind,
      amountCents: appointmentCharges.amountCents,
      status: appointmentCharges.status,
      description: appointmentCharges.description,
      stripeInvoiceItemId: appointmentCharges.stripeInvoiceItemId,
      stripePaymentIntentId: appointmentCharges.stripePaymentIntentId,
      periodKey: appointmentCharges.periodKey,
      chargedAt: appointmentCharges.chargedAt,
      createdAt: appointmentCharges.createdAt,
    })
    .from(appointmentCharges)
    .leftJoin(organizations, eq(organizations.id, appointmentCharges.organizationId))
    .where(where)
    .orderBy(desc(appointmentCharges.createdAt))
    .limit(limit);

  return rows;
}

export function summarizeCharges(charges: Array<{ amountCents?: number | null; status?: string | null }>) {
  const totalCents = charges.reduce((s, c) => s + (c.amountCents || 0), 0);
  const paidCents = charges
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  const pendingCents = charges
    .filter((c) => c.status === "pending" || c.status === "invoiced")
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  const waivedCents = charges
    .filter((c) => c.status === "waived")
    .reduce((s, c) => s + (c.amountCents || 0), 0);
  return {
    count: charges.length,
    totalCents,
    paidCents,
    pendingCents,
    waivedCents,
  };
}

export async function getOrgMonthlyBill(organizationId: number, period = billingPeriodKey()) {
  await ensureCommercialPricingSchema();
  const { start, end, label } = billingPeriodBounds(period);
  const pricing = await getOrgCommercialPricing(organizationId);
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const lines = await db
    .select()
    .from(appointmentCharges)
    .where(
      and(
        eq(appointmentCharges.organizationId, organizationId),
        sql`(
          (${appointmentCharges.createdAt} >= ${start} AND ${appointmentCharges.createdAt} < ${end})
          OR ${appointmentCharges.description} = ${monthlyRetainerDescription(period)}
          OR ${appointmentCharges.periodKey} = ${period}
          OR ${appointmentCharges.periodKey} LIKE ${`${period}-%`}
        )`
      )
    )
    .orderBy(desc(appointmentCharges.createdAt));

  // Dedupe by id
  const byId = new Map(lines.map((l) => [l.id, l]));
  const unique = [...byId.values()];

  const monthlyLines = unique.filter((l) => l.feeKind === "monthly");
  const appointmentLines = unique.filter((l) => l.feeKind === "appointment");
  const totalCents = unique.reduce((s, l) => s + (l.amountCents || 0), 0);
  const paidCents = unique
    .filter((l) => l.status === "paid")
    .reduce((s, l) => s + (l.amountCents || 0), 0);
  const pendingCents = unique
    .filter((l) => l.status === "pending" || l.status === "invoiced")
    .reduce((s, l) => s + (l.amountCents || 0), 0);

  const appointmentCount = appointmentLines.length;
  const [ws] = await db
    .select({
      monthlyMinutesUsed: workspaces.monthlyMinutesUsed,
    })
    .from(workspaces)
    .where(eq(workspaces.organizationId, organizationId))
    .limit(1);

  const { buildHybridInvoicePreview } = await import("./commercial-pricing.js");
  const { usageLinesForInvoicePreview } = await import("./usage-billing.js");
  const invoicePreview = buildHybridInvoicePreview({
    pricing,
    appointmentCount,
    extraUsageLines: usageLinesForInvoicePreview({
      appointmentCount,
      callMinutesUsed: ws?.monthlyMinutesUsed ?? 0,
    }),
  });

  return {
    organizationId,
    organizationName: org?.name || `Org ${organizationId}`,
    period,
    periodLabel: label,
    rates: pricing,
    lines: unique,
    invoicePreview,
    breakdown: {
      monthlyCents: monthlyLines.reduce((s, l) => s + l.amountCents, 0),
      appointmentCents: appointmentLines.reduce((s, l) => s + l.amountCents, 0),
      appointmentCount,
      totalCents,
      paidCents,
      pendingCents,
    },
  };
}

export async function updateChargeStatus(
  chargeId: number,
  status: "pending" | "invoiced" | "paid" | "waived",
  extras: {
    stripePaymentIntentId?: string | null;
    lastChargeError?: string | null;
    chargedAt?: Date | null;
  } = {}
) {
  await ensureCommercialPricingSchema();
  const patch: Record<string, unknown> = { status };
  if (extras.stripePaymentIntentId !== undefined) {
    patch.stripePaymentIntentId = extras.stripePaymentIntentId;
  }
  if (extras.lastChargeError !== undefined) {
    patch.lastChargeError = extras.lastChargeError;
  }
  if (status === "paid") {
    patch.chargedAt = extras.chargedAt ?? new Date();
    patch.lastChargeError = extras.lastChargeError ?? null;
  } else if (extras.chargedAt !== undefined) {
    patch.chargedAt = extras.chargedAt;
  }
  const [row] = await db
    .update(appointmentCharges)
    .set(patch as Partial<typeof appointmentCharges.$inferInsert>)
    .where(eq(appointmentCharges.id, chargeId))
    .returning();
  return row || null;
}

export async function getChargeReceipt(chargeId: number) {
  await ensureCommercialPricingSchema();
  const [row] = await db
    .select({
      id: appointmentCharges.id,
      organizationId: appointmentCharges.organizationId,
      organizationName: organizations.name,
      appointmentId: appointmentCharges.appointmentId,
      leadId: appointmentCharges.leadId,
      feeKind: appointmentCharges.feeKind,
      amountCents: appointmentCharges.amountCents,
      status: appointmentCharges.status,
      description: appointmentCharges.description,
      createdAt: appointmentCharges.createdAt,
    })
    .from(appointmentCharges)
    .leftJoin(organizations, eq(organizations.id, appointmentCharges.organizationId))
    .where(eq(appointmentCharges.id, chargeId))
    .limit(1);
  return row || null;
}
