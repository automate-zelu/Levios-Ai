/**
 * Send every product email template to a real inbox (Resend).
 *
 *   npx tsx scripts/send-email-template-tests.ts btwimawawis@gmail.com
 */
import "dotenv/config";
import {
  PRODUCT_EMAIL_KINDS,
  buildProductEmail,
} from "../lib/email-templates.js";
import { sendProductEmail } from "../lib/product-email.js";
import { isResendConfigured } from "../lib/resend.js";

const TEST_FROM = ["onboarding", ["resend", "dev"].join(".")].join("@");

const to = (process.argv[2] || "").trim();
const fromArg = (process.argv[3] || "").trim();
if (!to || !to.includes("@")) {
  console.error("Usage: npx tsx scripts/send-email-template-tests.ts you@example.com");
  process.exit(1);
}
process.env.RESEND_FROM_EMAIL = fromArg || TEST_FROM;

if (!isResendConfigured()) {
  console.error("RESEND_API_KEY is not set.");
  process.exit(1);
}

async function main() {
  console.log(`Sending ${PRODUCT_EMAIL_KINDS.length} Leviosai templates to ${to}`);
  console.log(`From: ${process.env.RESEND_FROM_EMAIL}\n`);
  let ok = 0;
  let fail = 0;
  for (const kind of PRODUCT_EMAIL_KINDS) {
    const mail = buildProductEmail(kind, {
      firstName: "Awais",
      organizationName: "Northpeak HVAC",
      email: to,
      inviterName: "Levios Test",
      temporaryPassword: "Invite-test9!",
    });
    mail.subject = `[TEST ${kind}] ${mail.subject}`;
    const result = await sendProductEmail(to, mail);
    if (result.success) {
      ok += 1;
      console.log(`  ok  ${kind}  ${result.id || ""}`);
    } else {
      fail += 1;
      console.log(`  FAIL ${kind}  ${result.error}`);
    }
  }
  console.log(`\nDone. ${ok} sent, ${fail} failed.`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
