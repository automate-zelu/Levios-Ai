/** Pure booking cancel / reschedule / delete rules and notification copy. */

export type BookingAction = "cancel" | "reschedule" | "delete";

export interface BookingNoticeInput {
  action: BookingAction;
  leadFirstName?: string | null;
  title: string;
  previousWhen: string;
  nextWhen?: string | null;
  companyName?: string | null;
}

export function formatBookingWhen(date: Date, timeZone = "America/New_York"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function canPerformBookingAction(
  status: string | null | undefined,
  action: BookingAction
): { ok: boolean; reason?: string } {
  const s = String(status || "scheduled").toLowerCase();
  if (action === "delete") return { ok: true };
  if (s === "completed" || s === "no-show" || s === "noshow") {
    return { ok: false, reason: "Completed bookings cannot be cancelled or rescheduled" };
  }
  if (action === "cancel" && s === "cancelled") {
    return { ok: false, reason: "Already cancelled" };
  }
  return { ok: true };
}

export function planBookingMutation(action: BookingAction): {
  nextStatus: string | null;
  deleteRow: boolean;
  calendar: "none" | "delete" | "patch";
} {
  if (action === "delete") {
    return { nextStatus: null, deleteRow: true, calendar: "delete" };
  }
  if (action === "cancel") {
    return { nextStatus: "cancelled", deleteRow: false, calendar: "delete" };
  }
  return { nextStatus: "scheduled", deleteRow: false, calendar: "patch" };
}

export function composeBookingNotice(input: BookingNoticeInput): {
  sms: string;
  emailSubject: string;
  emailBody: string;
} {
  const first = (input.leadFirstName || "").trim() || "there";
  const company = (input.companyName || "").trim() || "our team";
  const title = input.title || "appointment";
  const previous = input.previousWhen;
  const next = input.nextWhen || "";

  if (input.action === "reschedule") {
    return {
      sms: `Hi ${first} — your ${title} has been moved from ${previous} to ${next}. Reply if you need a different time. — ${company}`,
      emailSubject: `Rescheduled: ${title}`,
      emailBody:
        `Hi ${first},\n\n` +
        `Your ${title} has been rescheduled.\n\n` +
        `Previous: ${previous}\n` +
        `New time: ${next}\n\n` +
        `Reply to this email or text us if that no longer works.\n\n` +
        `— ${company}`,
    };
  }

  if (input.action === "cancel") {
    return {
      sms: `Hi ${first} — your ${title} on ${previous} has been cancelled. Reply if you'd like to book a new time. — ${company}`,
      emailSubject: `Cancelled: ${title}`,
      emailBody:
        `Hi ${first},\n\n` +
        `Your ${title} scheduled for ${previous} has been cancelled.\n\n` +
        `If you'd like to pick a new time, just reply to this email or text us.\n\n` +
        `— ${company}`,
    };
  }

  return {
    sms: `Hi ${first} — your ${title} on ${previous} has been removed from our calendar. Reply if you'd like to book again. — ${company}`,
    emailSubject: `Removed: ${title}`,
    emailBody:
      `Hi ${first},\n\n` +
      `Your ${title} scheduled for ${previous} has been removed.\n\n` +
      `Reply if you'd like to schedule a new visit.\n\n` +
      `— ${company}`,
  };
}
