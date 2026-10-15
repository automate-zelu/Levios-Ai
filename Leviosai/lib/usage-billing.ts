/**
 * Hybrid billing metering matrix (P1.3).
 *
 * Retainer covers included call minutes / SMS / email AI within plan limits.
 * Billable extras today: booked appointments (commercial appointment fee).
 * Call minutes / SMS / email are metered for usage UI + invoice preview notes;
 * they do not add invoice cents unless marked billable later.
 */

export type UsageMeterUnit = "appointment" | "minute" | "message" | "token";

export type UsageMeterId =
  | "appointment_booked"
  | "call_minutes"
  | "sms_ai"
  | "email_ai"
  | "ai_tokens";

export interface UsageMeterDefinition {
  id: UsageMeterId;
  label: string;
  unit: UsageMeterUnit;
  /** When true, quantity is informational only — covered by monthly retainer. */
  includedInRetainer: boolean;
  /** When true, may produce a commercial charge line (appointment fees today). */
  billable: boolean;
}

/** Product metering matrix — agree extras with Anthony before turning billable=true. */
export const USAGE_METERING_MATRIX: UsageMeterDefinition[] = [
  {
    id: "appointment_booked",
    label: "Appointments booked",
    unit: "appointment",
    includedInRetainer: false,
    billable: true,
  },
  {
    id: "call_minutes",
    label: "AI call minutes",
    unit: "minute",
    includedInRetainer: true,
    billable: false,
  },
  {
    id: "sms_ai",
    label: "AI SMS messages",
    unit: "message",
    includedInRetainer: true,
    billable: false,
  },
  {
    id: "email_ai",
    label: "AI email messages",
    unit: "message",
    includedInRetainer: true,
    billable: false,
  },
  {
    id: "ai_tokens",
    label: "AI tokens",
    unit: "token",
    includedInRetainer: true,
    billable: false,
  },
];

export function getUsageMeter(id: UsageMeterId): UsageMeterDefinition | undefined {
  return USAGE_METERING_MATRIX.find((m) => m.id === id);
}

export function listBillableMeters(): UsageMeterDefinition[] {
  return USAGE_METERING_MATRIX.filter((m) => m.billable);
}

export function listIncludedMeters(): UsageMeterDefinition[] {
  return USAGE_METERING_MATRIX.filter((m) => m.includedInRetainer);
}

/** Build preview usage rows from workspace counters (minutes) + appointment count. */
export function usageLinesForInvoicePreview(input: {
  appointmentCount: number;
  callMinutesUsed?: number;
  smsCount?: number;
  emailCount?: number;
}): Array<{ label: string; quantity: number; unitCents: number; includedInRetainer: boolean }> {
  const lines: Array<{
    label: string;
    quantity: number;
    unitCents: number;
    includedInRetainer: boolean;
  }> = [];

  const minutes = Math.max(0, Math.floor(Number(input.callMinutesUsed) || 0));
  if (minutes > 0) {
    lines.push({
      label: "AI call minutes (included in retainer)",
      quantity: minutes,
      unitCents: 0,
      includedInRetainer: true,
    });
  }
  const sms = Math.max(0, Math.floor(Number(input.smsCount) || 0));
  if (sms > 0) {
    lines.push({
      label: "AI SMS (included in retainer)",
      quantity: sms,
      unitCents: 0,
      includedInRetainer: true,
    });
  }
  const email = Math.max(0, Math.floor(Number(input.emailCount) || 0));
  if (email > 0) {
    lines.push({
      label: "AI email (included in retainer)",
      quantity: email,
      unitCents: 0,
      includedInRetainer: true,
    });
  }
  void input.appointmentCount; // appointments billed via commercial appointment fee
  return lines;
}
