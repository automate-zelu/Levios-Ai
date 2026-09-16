# Live SDR / AI Voice — single-contact test cases

**Contact under test (only CRM lead):** Mohammed Awais · `+19295689007` · `automate@zeluai.com` (lead id `14`)  
**Workspace:** Levios Demo · login `user@leviosai.com`  
**Hosts:** app `http://54.88.193.115` · ngrok `https://luckless-perplexed-spiffy.ngrok-free.dev`  
**Twilio from:** `+16474907852`  
**Agent:** Aria · ElevenLabs voice `IKne3meq5aSn9XLyUdCD`  
**Timers:** `waitCallHrs = 0` (SMS soon after miss) · `waitSmsHrs = 1` (email ~1h if no SMS reply)

Do **not** create extra leads. Every case below uses this one contact.

---

## Preflight (inspected 2026-08-15)

| Check | Result |
|---|---|
| `/api/health` all services `ok` | PASS |
| Ngrok health `ok` | PASS |
| Exactly 1 lead | PASS |
| SDR Agent `isActive` | PASS |
| Twilio connected | PASS |
| Gmail connected (`automate@zeluai.com`) | PASS |
| Google Calendar connected | PASS |
| Prompt is outbound Aria / NorthPeak | PASS |
| SMS + email templates present | PASS |
| Voice ID set | PASS |
| Latest enrollment `4d9b2891-…` status **`booked`** | **BLOCKER** — new enroll returns 409 until this cycle is marked exhausted |
| Lead `lastContactedAt` 2026-08-01 | OK for manual enroll (dormancy not required) |
| SMS thread exists (7 messages, last outbound) | Historical |
| Email thread exists (1 outbound) | Historical |

---

## How to mark results

`PASS` / `FAIL` / `BLOCKED` / `WAIT` (needs your phone or inbox).  
Evidence: enrollment UUID, Twilio Call/Message SID, Live Calls transcript, SMS Inbox row, Gmail message.

---

## TC-01 Health & integrations

1. GET `/api/health` → all `ok`.  
2. GET `/api/twilio/status` → connected + from-number.  
3. GET `/api/gmail/status` → connected.  
4. GET `/api/calendar/status` → Google active.  
5. GET `/api/call/voices` → includes saved voice id (or import still saved on `/voice-ai`).  

**Expected:** no `unconfigured` on Twilio/Deepgram/OpenAI/ElevenLabs.

---

## TC-02 SDR Agent content

1. Open `/sdr` as `user@leviosai.com`.  
2. Confirm prompt is **outbound SDR** (not inbound receptionist).  
3. Confirm KB has NorthPeak (or uploaded docs).  
4. Confirm SMS template uses `{{first_name}}`.  
5. Confirm email subject/body present.  
6. Confirm Activate is on.

**Expected:** save succeeds; agent uses this prompt on the next call.

---

## TC-03 Voice AI

1. Open `/voice-ai`.  
2. Confirm selected voice is `IKne3meq5aSn9XLyUdCD` (or preview + Save).  
3. Optional: import another Voice ID, Save, then restore Aria’s id.

**Expected:** next outbound call uses the saved ElevenLabs id.

---

## TC-04 Channels (SDR Setup)

1. `/sdr-setup`: Phone Live (`+16474907852`), Mail Live, Cal Live.  
2. Booking window saved; calendar tools in prompt (or enable them).  

**Expected:** Live pills; booking tools available if you ask for an estimate time on the call.

---

## TC-05 Enroll gate (booked cycle)

1. POST `/api/sdr/enroll/14` **without** clearing booked.  

**Expected:** `409` `Enrollment not allowed: booked`.  
**To run live call/SMS/email:** mark enrollment `4d9b2891-…` exhausted (ops/DB), then enroll again. Do not do this without confirmation — it closes the “already booked” cycle.

---

## TC-06 Voice path — you ANSWER

**You:** pick up `+19295689007` when it rings from `+16474907852`.  
**I:** enroll after TC-05 is cleared; watch Live Calls + enrollment status.

| Step | Expected |
|---|---|
| Enroll | New enrollment, job `INITIATE_CALL` |
| Ring | Phone rings within ~30s |
| Greeting | Short outbound opener (Aria / NorthPeak, “I’m calling you”) |
| Turn-taking | Does not reply to fragments; waits ~1.4s |
| Context | Remembers what you already said |
| Booking | If you agree a time, calendar tool + CRM booked |
| Sequence | `booked` → **no** SMS/email for this cycle |
| Evidence | Live Calls transcript; call session `answered`; recording if enabled |

**You do:** talk naturally; optionally ask for a slot; hang up when done.

---

## TC-07 Missed-call → SMS

**You:** do **not** answer. Let it ring out.  
**Timers:** `waitCallHrs = 0` → SMS should send shortly after no-answer.

| Step | Expected |
|---|---|
| Outcome | `call_no_answer` (or similar) |
| SMS | Outbound to `+19295689007` from `+16474907852` |
| Copy | “Hi Mohammed…” from template |
| UI | `/sdr-sms` shows thread; enrollment `sms_sent` |

**You do:** wait for the text. Do not reply yet unless we are on TC-08.

---

## TC-08 SMS reply (you text back)

**You:** reply to the SDR SMS (e.g. `Yes, call me tomorrow` or `Not interested`).  
**I:** watch `/api/messages/threads?channel=sms` and enrollment logs.

| Step | Expected |
|---|---|
| Inbound | Appears in SMS Inbox as waiting / inbound |
| Agent | Follow-up SMS (or sequence stops if DNC / not interested) |
| If interested | May offer times / book |
| If stop | Honor opt-out; no further SMS/email |

---

## TC-09 No SMS reply → email

**You:** do **not** reply to SMS for ~1 hour (`waitSmsHrs = 1`).  
**I:** poll enrollment until `email_sent`.

| Step | Expected |
|---|---|
| Wait | No inbound SMS |
| Email | To `automate@zeluai.com` from connected Gmail |
| Copy | Subject/body with Mohammed / Levios Demo |
| UI | `/sdr-email` thread; enrollment `email_sent` |

**Note:** Gmail sender and lead inbox are the **same address** — check Sent + Inbox (or All Mail).

---

## TC-10 Inbox UX

1. `/sdr-sms`: search, Waiting filter, Open lead, optional Send SMS.  
2. `/sdr-email`: thread shows the follow-up.  
3. `/leads/14`: sequence logs match call → SMS → email.  
4. `/live-calls` during TC-06: live transcript.

---

## TC-11 Negative / accuracy

| Case | Expected |
|---|---|
| Inbound-sounding “thanks for calling” | FAIL if heard on outbound |
| Replies to “could you” fragment | FAIL |
| Invented prices | FAIL |
| SMS after successful book (TC-06) | FAIL |
| Enroll while booked (TC-05) | 409, no second call |

---

## Suggested run order (one contact)

1. Preflight TC-01–04 (no phone).  
2. Confirm **exhaust booked cycle**.  
3. Pick **one** path:  
   - **A** TC-06 answer (voice + optional book)  
   - **B** TC-07 miss → SMS, then **you reply** (TC-08)  
   - **C** TC-07 miss → SMS, **no reply**, wait ~1h for TC-09 email  
4. TC-10 UI evidence.  
5. TC-11 listen/read for accuracy.

Cannot run A, B, and C on the same cycle. After booked/exhausted, we can start a new cycle if you approve another enroll.

---

## Operator script (after your OK)

```bash
# Inspect only (safe)
SMOKE_BASE_URL=http://54.88.193.115 npx tsx scripts/live-sdr-e2e.ts

# Real call — you ANSWER
LIVE_SDR_E2E=1 LIVE_SDR_PATH=answer SMOKE_BASE_URL=http://54.88.193.115 \
  npx tsx scripts/live-sdr-e2e.ts --run

# Real call — you MISS, then wait for SMS (do not reply → email ~1h)
LIVE_SDR_E2E=1 LIVE_SDR_PATH=miss LIVE_SDR_AFTER_SMS=wait SMOKE_BASE_URL=http://54.88.193.115 \
  npx tsx scripts/live-sdr-e2e.ts --run

# Miss, then YOU reply to SMS
LIVE_SDR_E2E=1 LIVE_SDR_PATH=miss LIVE_SDR_AFTER_SMS=reply SMOKE_BASE_URL=http://54.88.193.115 \
  npx tsx scripts/live-sdr-e2e.ts --run
```
