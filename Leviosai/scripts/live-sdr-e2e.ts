/**
 * Live SDR e2e against the single CRM contact (inspect or --run).
 *
 * Inspect (no call):
 *   SMOKE_BASE_URL=http://54.88.193.115 npx tsx scripts/live-sdr-e2e.ts
 *
 * Place a real call (requires LIVE_SDR_E2E=1):
 *   LIVE_SDR_E2E=1 LIVE_SDR_PATH=miss|answer LIVE_SDR_AFTER_SMS=wait|reply \
 *     SMOKE_BASE_URL=http://54.88.193.115 npx tsx scripts/live-sdr-e2e.ts --run
 */
import "dotenv/config";

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const NGROK = process.env.SMOKE_NGROK_URL || "https://luckless-perplexed-spiffy.ngrok-free.dev";
const EMAIL = process.env.SMOKE_EMAIL || "user@leviosai.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "LeviosaiUser2026!";
const EXPECT_LEAD_ID = Number(process.env.LIVE_SDR_LEAD_ID || 14);
const EXPECT_PHONE = process.env.LIVE_SDR_PHONE || "+19295689007";
const EXPECT_LEAD_EMAIL = process.env.LIVE_SDR_LEAD_EMAIL || "automate@zeluai.com";
const PATH = (process.env.LIVE_SDR_PATH || "miss").toLowerCase();
const AFTER_SMS = (process.env.LIVE_SDR_AFTER_SMS || "reply").toLowerCase();
const RUN = process.argv.includes("--run");

const POLL_MS = 4000;
const CALL_TIMEOUT_MS = 4 * 60 * 1000;
const SMS_TIMEOUT_MS = 5 * 60 * 1000;
const REPLY_TIMEOUT_MS = 10 * 60 * 1000;
const EMAIL_TIMEOUT_MS = 75 * 60 * 1000;

function ok(label: string, detail?: unknown) {
  console.log(`PASS  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
}
function warn(label: string, detail?: unknown) {
  console.warn(`WARN  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
}
function fail(label: string, detail?: unknown): never {
  console.error(`FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  process.exit(1);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function api(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await json(res);
  return { res, body };
}

function isTerminalCallStatus(status: string | undefined) {
  return [
    "call_no_answer",
    "call_failed",
    "call_busy",
    "call_answered",
    "call_connected",
    "booked",
    "exhausted",
    "sms_sent",
    "sms_replied",
    "email_sent",
    "email_replied",
  ].includes(status || "");
}

function isMissStatus(status: string | undefined) {
  return ["call_no_answer", "call_failed", "sms_sent", "sms_replied", "email_sent"].includes(
    status || ""
  );
}

async function main() {
  console.log("\n=== Live SDR e2e ===");
  console.log("BASE:", BASE);
  console.log("NGROK:", NGROK);
  console.log("mode:", RUN ? `--run path=${PATH} afterSms=${AFTER_SMS}` : "inspect");

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody: any = await json(loginRes);
  if (!loginRes.ok || !loginBody.token) fail("login", loginBody);
  ok("login", { user: loginBody.user?.email });
  const token = loginBody.token as string;

  const health: any = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const services = health.services || health;
  const bad = Object.entries(services || {}).filter(([, v]) => v !== "ok" && v !== true);
  if (health.error || bad.length) fail("app health", health);
  ok("app health", services);

  const ngrokHealth: any = await fetch(`${NGROK}/api/health`, {
    headers: { "ngrok-skip-browser-warning": "1" },
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));
  if (ngrokHealth.error) fail("ngrok health", ngrokHealth);
  ok("ngrok health", ngrokHealth.services || "ok");

  const { res: leadsRes, body: leadsBody } = await api("/api/leads", token);
  const leads = Array.isArray(leadsBody) ? leadsBody : leadsBody.data || leadsBody.leads || [];
  if (!leadsRes.ok) fail("list leads", leadsBody);
  if (leads.length !== 1) fail("exactly one CRM lead", { count: leads.length, leads });
  const lead = leads[0];
  if (lead.id !== EXPECT_LEAD_ID) fail("lead id", { expected: EXPECT_LEAD_ID, got: lead.id });
  if (lead.phone !== EXPECT_PHONE) fail("lead phone", { expected: EXPECT_PHONE, got: lead.phone });
  if ((lead.email || "").toLowerCase() !== EXPECT_LEAD_EMAIL.toLowerCase()) {
    fail("lead email", { expected: EXPECT_LEAD_EMAIL, got: lead.email });
  }
  ok("single contact", {
    id: lead.id,
    name: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
    phone: lead.phone,
    email: lead.email,
  });

  const { body: cfg } = await api("/api/sdr/config", token);
  if (!cfg?.isActive) fail("SDR agent active", { isActive: cfg?.isActive });
  ok("SDR agent", {
    isActive: cfg.isActive,
    waitCallHrs: cfg.waitCallHrs,
    waitSmsHrs: cfg.waitSmsHrs,
    voice: cfg.assistantVoiceId,
    smsTemplate: Boolean(cfg.smsTemplate),
    emailSubject: Boolean(cfg.emailSubject),
  });

  const twilio = (await api("/api/twilio/status", token)).body;
  if (!twilio?.connected && !twilio?.phoneNumber) fail("Twilio", twilio);
  ok("Twilio", { phone: twilio.phoneNumber || twilio.from || twilio.number });

  const gmail = (await api("/api/gmail/status", token)).body;
  if (!gmail?.connected && !gmail?.email) fail("Gmail", gmail);
  ok("Gmail", { email: gmail.email || gmail.accountEmail, connected: gmail.connected ?? true });

  const cal = (await api("/api/calendar/status", token)).body;
  if (!cal?.activeProvider && !cal?.connected) fail("Calendar", cal);
  ok("Calendar", { provider: cal.activeProvider || cal.provider });

  const { body: enrList } = await api(`/api/sdr/enrollments?leadId=${EXPECT_LEAD_ID}&limit=5`, token);
  const enrollments = enrList.data || [];
  const latest = enrollments[0];
  ok("latest enrollment", latest
    ? { id: latest.id, status: latest.status, enrolledAt: latest.enrolledAt }
    : "none");

  const smsThreads = (await api("/api/messages/threads?channel=sms", token)).body;
  const emailThreads = (await api("/api/messages/threads?channel=email", token)).body;
  ok("SMS threads", { count: (smsThreads.threads || []).length });
  ok("email threads", { count: (emailThreads.threads || []).length });

  if (!RUN) {
    console.log("\nDONE  inspect only. Add --run + LIVE_SDR_E2E=1 to enroll and call.\n");
    return;
  }

  if (process.env.LIVE_SDR_E2E !== "1") {
    fail("refusing --run without LIVE_SDR_E2E=1 (safety gate)");
  }
  if (PATH !== "miss" && PATH !== "answer") fail("LIVE_SDR_PATH must be miss|answer", PATH);
  if (AFTER_SMS !== "wait" && AFTER_SMS !== "reply") fail("LIVE_SDR_AFTER_SMS must be wait|reply", AFTER_SMS);

  const existingId = process.env.LIVE_SDR_ENROLLMENT_ID;
  const activeish = ["enrolled", "pending", "call_initiated", "call_connected", "call_answered", "sms_sent", "email_sent"];
  if (!existingId && latest && activeish.includes(latest.status)) {
    fail("active enrollment already exists — will not place another call", latest);
  }
  if (latest?.status === "booked") {
    fail("Enrollment not allowed: booked — exhaust that cycle first", latest);
  }

  if (PATH === "miss") {
    console.log("\n>>> Do NOT answer +19295689007 (from +16474907852). Let it ring out.\n");
  } else {
    console.log("\n>>> PICK UP +19295689007 when it rings from +16474907852.\n");
  }

  let enrollmentId: string;
  if (existingId) {
    enrollmentId = existingId;
    ok("watching existing enrollment", { id: enrollmentId });
  } else {
    const enroll = await api(`/api/sdr/enroll/${EXPECT_LEAD_ID}`, token, {
      method: "POST",
      body: "{}",
    });
    if (!enroll.res.ok) fail("enroll", { status: enroll.res.status, body: enroll.body });
    enrollmentId = enroll.body.enrollment?.id || enroll.body.id;
    if (!enrollmentId) fail("enroll missing id", enroll.body);
    ok("enrolled", { id: enrollmentId, jobId: enroll.body.jobId, mode: enroll.body.mode });
  }

  const started = Date.now();
  let status = "pending";
  let detail: any = {};

  while (Date.now() - started < CALL_TIMEOUT_MS) {
    const snap = await api(`/api/sdr/enrollments/${enrollmentId}`, token);
    detail = snap.body;
    status = snap.body.enrollment?.status || status;
    const sessions = snap.body.callSessions || [];
    const lastSession = sessions[sessions.length - 1];
    console.log(
      `… call poll  status=${status}  session=${lastSession?.status || "-"}  twilio=${lastSession?.twilioCallSid || "-"}`
    );
    if (PATH === "miss" && isMissStatus(status)) {
      ok("call missed / fall-through", { status });
      break;
    }
    if (PATH === "answer" && ["call_connected", "call_answered", "booked", "exhausted"].includes(status)) {
      ok("call answered path", { status });
      break;
    }
    if (status === "sms_sent" || status === "sms_replied") break;
    await sleep(POLL_MS);
  }

  if (PATH === "miss" && !isMissStatus(status) && status !== "sms_sent") {
    fail("TIMEOUT waiting for missed-call outcome", { status, enrollment: detail.enrollment });
  }
  if (PATH === "answer" && !["call_connected", "call_answered", "booked", "exhausted", "sms_sent"].includes(status)) {
    fail("TIMEOUT waiting for answer outcome", { status, enrollment: detail.enrollment });
  }

  if (PATH === "answer") {
    const sessions = detail.callSessions || [];
    ok("call sessions", sessions.map((s: any) => ({ id: s.id, status: s.status, sid: s.twilioCallSid })));
    if (status === "booked") {
      ok("booked — sequence should stop (no SMS/email this cycle)");
      console.log("\nDONE  answer + booked\n");
      return;
    }
    console.log("\nDONE  answer path (watch Live Calls for transcript accuracy)\n");
    return;
  }

  const smsStart = Date.now();
  let outboundSms: any = null;
  while (Date.now() - smsStart < SMS_TIMEOUT_MS) {
    const snap = await api(`/api/sdr/enrollments/${enrollmentId}`, token);
    detail = snap.body;
    status = snap.body.enrollment?.status || status;
    const msgs = (snap.body.messages || []).filter((m: any) => m.channel === "sms");
    outboundSms = [...msgs].reverse().find((m: any) => m.direction === "outbound");
    console.log(
      `… SMS poll   status=${status}  smsCount=${msgs.length}  smsSentAt=${snap.body.enrollment?.smsSentAt || "-"}`
    );
    if (status === "sms_sent" || outboundSms) {
      ok("SMS sent", {
        status,
        preview: String(outboundSms?.content || "").slice(0, 120),
        at: snap.body.enrollment?.smsSentAt,
      });
      break;
    }
    await sleep(POLL_MS);
  }
  if (status !== "sms_sent" && !outboundSms) {
    fail("TIMEOUT waiting for SMS", { status, enrollment: detail.enrollment });
  }

  if (AFTER_SMS === "wait") {
    console.log("\n>>> Do NOT reply to the SMS. Waiting up to ~1h for email (waitSmsHrs).\n");
    const emailStart = Date.now();
    while (Date.now() - emailStart < EMAIL_TIMEOUT_MS) {
      const snap = await api(`/api/sdr/enrollments/${enrollmentId}`, token);
      detail = snap.body;
      status = snap.body.enrollment?.status || status;
      const emails = (snap.body.messages || []).filter((m: any) => m.channel === "email");
      const inboundSms = (snap.body.messages || []).filter(
        (m: any) => m.channel === "sms" && m.direction === "inbound"
      );
      if (inboundSms.length) {
        warn("inbound SMS arrived during wait path — email may be skipped", inboundSms.slice(-1)[0]);
        ok("SMS reply observed (wait path interrupted)", { status });
        console.log("\nDONE  wait path interrupted by reply\n");
        return;
      }
      console.log(`… email poll status=${status}  emailCount=${emails.length}`);
      if (status === "email_sent" || emails.some((m: any) => m.direction === "outbound")) {
        ok("email sent", { status, count: emails.length });
        console.log("\nDONE  miss → SMS → email (no SMS reply)\n");
        return;
      }
      await sleep(15000);
    }
    fail("TIMEOUT waiting for email after SMS", { status, enrollment: detail.enrollment });
  }

  console.log("\n>>> Reply to the SMS on +19295689007 now. I am watching the inbox.\n");
  const replyStart = Date.now();
  const inboundBefore = (detail.messages || []).filter(
    (m: any) => m.channel === "sms" && m.direction === "inbound"
  ).length;

  while (Date.now() - replyStart < REPLY_TIMEOUT_MS) {
    const snap = await api(`/api/sdr/enrollments/${enrollmentId}`, token);
    detail = snap.body;
    status = snap.body.enrollment?.status || status;
    const inbound = (snap.body.messages || []).filter(
      (m: any) => m.channel === "sms" && m.direction === "inbound"
    );
    const outboundAfter = (snap.body.messages || []).filter(
      (m: any) => m.channel === "sms" && m.direction === "outbound"
    );
    console.log(
      `… reply poll status=${status}  inboundSms=${inbound.length}  outboundSms=${outboundAfter.length}`
    );
    if (inbound.length > inboundBefore) {
      const lastIn = inbound[inbound.length - 1];
      ok("inbound SMS", { preview: String(lastIn.content || "").slice(0, 160), status });
      const follow = outboundAfter.filter((m: any) => {
        const t = new Date(m.createdAt).getTime();
        return t >= new Date(lastIn.createdAt).getTime();
      });
      if (follow.length) {
        ok("agent SMS follow-up", { preview: String(follow[0].content || "").slice(0, 160) });
      } else {
        warn("no agent SMS follow-up yet (sequence may stop on DNC / booked / human-only)");
      }
      console.log("\nDONE  miss → SMS → inbound reply\n");
      return;
    }
    await sleep(POLL_MS);
  }
  fail("TIMEOUT waiting for your SMS reply", { status });
}

main().catch((err) => {
  console.error("FAIL  uncaught", err);
  process.exit(1);
});
