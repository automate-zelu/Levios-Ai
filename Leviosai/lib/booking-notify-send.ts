import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { workspaces } from "./schema.js";
import { storage } from "./storage.js";
import { sendOutboundSms, workspacePhoneConnected } from "./telephony.js";
import { sendEmailViaGmail } from "./gmail/send.js";
import { styledPlainEmail } from "./email-templates.js";

export interface BookingNotifyInput {
  organizationId: number;
  leadId: number;
  phone?: string | null;
  email?: string | null;
  sms: string;
  emailSubject: string;
  emailBody: string;
}

export async function notifyLeadBookingChange(input: BookingNotifyInput): Promise<{
  sms: boolean;
  email: boolean;
  errors: { sms?: string; email?: string };
}> {
  const errors: { sms?: string; email?: string } = {};
  let smsOk = false;
  let emailOk = false;

  if (input.phone) {
    try {
      const [ws] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.organizationId, input.organizationId));
      if (!workspacePhoneConnected(ws || {})) {
        errors.sms = "Phone/SMS not connected";
      } else {
        await sendOutboundSms(ws!, {
          body: input.sms,
          to: input.phone,
        });
        smsOk = true;
      }
      await storage.createLeadMessage({
        leadId: input.leadId,
        channel: "sms",
        content: input.sms,
        status: smsOk ? "sent" : "failed",
        direction: "outbound",
        aiGenerated: true,
      });
    } catch (err: any) {
      errors.sms = err?.message || "SMS failed";
      try {
        await storage.createLeadMessage({
          leadId: input.leadId,
          channel: "sms",
          content: input.sms,
          status: "failed",
          direction: "outbound",
          aiGenerated: true,
        });
      } catch {
        /* ignore */
      }
    }
  } else {
    errors.sms = "Lead has no phone";
  }

  if (input.email) {
    try {
      const styled = styledPlainEmail(input.emailSubject, input.emailBody);
      const result = await sendEmailViaGmail(
        input.organizationId,
        input.email,
        styled.subject,
        styled.text,
        styled.html
      );
      emailOk = !!result.success;
      if (!emailOk) errors.email = result.error || "Email failed";
      await storage.createLeadMessage({
        leadId: input.leadId,
        channel: "email",
        content: `Subject: ${input.emailSubject}\n\n${input.emailBody}`,
        status: emailOk ? "sent" : "failed",
        direction: "outbound",
        aiGenerated: true,
      });
    } catch (err: any) {
      errors.email = err?.message || "Email failed";
    }
  } else {
    errors.email = "Lead has no email";
  }

  return { sms: smsOk, email: emailOk, errors };
}
