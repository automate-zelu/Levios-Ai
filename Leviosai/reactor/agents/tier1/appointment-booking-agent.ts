// ─── APPOINTMENT BOOKING AGENT ───────────────────────────────────────────────
// Books confirmed appointments into CRM and syncs to the org's active calendar
// (Google Calendar or Outlook — Module 10).

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";
import { bookAppointmentWithCalendar } from "../../../lib/calendar/service.js";
import { parseScheduledAt } from "../../../lib/calendar/booking-helpers.js";

export class AppointmentBookingAgent extends BaseAgent {
  id = "appointment-booking";
  name = "Appointment Booking Agent";
  tier = 1 as const;
  priority = 4;
  isBlocking = false;
  timeout = 15_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "appointment.request";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.fail("No leadId");

    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");

    const { title, scheduledAt: rawScheduled } = event.payload;
    const scheduledAt = parseScheduledAt(rawScheduled);
    if (!title || !scheduledAt) return this.fail("title and scheduledAt required");

    const organizationId = event.organizationId || lead.organizationId;
    if (!organizationId) return this.fail("No organizationId");

    const result = await bookAppointmentWithCalendar({
      organizationId,
      leadId,
      title,
      scheduledAt,
      attendeeEmail: lead.email,
      attendeeName: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
      description: event.payload.description,
      durationMinutes: event.payload.durationMinutes,
    });

    context.emit({
      type: "appointment.confirmed",
      organizationId,
      payload: {
        leadId,
        appointmentId: result.appointmentId,
        scheduledAt,
        calendarEventId: result.calendarEventId,
        calendarProvider: result.calendarProvider,
        synced: result.synced,
      },
      metadata: { leadId, priority: 2, agentSource: this.id },
    });

    return this.ok(
      {
        appointmentId: result.appointmentId,
        scheduledAt,
        calendarEventId: result.calendarEventId,
        synced: result.synced,
        syncError: result.syncError,
      },
      { leadStateTransition: "appointment_set" }
    );
  }
}
