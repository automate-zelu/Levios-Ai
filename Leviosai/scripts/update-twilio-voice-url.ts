import "dotenv/config";
import twilio from "twilio";

async function main() {
  const sid = process.env.TWILIO_MASTER_SID!;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN!;
  const client = twilio(sid, token);
  const phone = "+18258910126";
  const nums = await client.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 5 });
  if (!nums[0]) throw new Error("number not found");
  const updated = await client.incomingPhoneNumbers(nums[0].sid).update({
    voiceUrl: "http://54.88.193.115/api/call/connect",
    voiceMethod: "POST",
    statusCallback: "http://54.88.193.115/api/webhooks/twilio/call-status",
    statusCallbackMethod: "POST",
  });
  console.log("Updated", updated.phoneNumber, "voiceUrl=", updated.voiceUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
