/**
 * Telephony BYOT — Twilio vs Telnyx provider resolution + helpers.
 * Run: npx tsx --test tests/telephony-byot.test.ts
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  resolveVoiceProvider,
  workspacePhoneConnected,
  workspaceFromNumber,
} from "../lib/telephony.js";

describe("telephony resolveVoiceProvider", () => {
  const twilioReady = {
    id: "ws1",
    voiceProvider: "twilio",
    twilioSubAccountSid: "enc_sid",
    twilioSubAuthToken: "enc_token",
    twilioPhoneNumber: "+15551111111",
  };

  const telnyxReady = {
    id: "ws2",
    voiceProvider: "telnyx",
    telnyxApiKey: "enc_key",
    telnyxPhoneNumber: "+15552222222",
    telnyxConnectionId: "conn_abc",
  };

  it("returns null when nothing is connected", () => {
    assert.equal(resolveVoiceProvider({ id: "empty" }), null);
    assert.equal(workspacePhoneConnected({ id: "empty" }), false);
    assert.equal(workspaceFromNumber({ id: "empty" }), null);
  });

  it("prefers voiceProvider when that stack is ready", () => {
    assert.equal(resolveVoiceProvider(twilioReady), "twilio");
    assert.equal(resolveVoiceProvider(telnyxReady), "telnyx");
  });

  it("falls back to the only ready provider when preference is wrong", () => {
    assert.equal(
      resolveVoiceProvider({
        ...telnyxReady,
        voiceProvider: "twilio",
        twilioSubAccountSid: null,
        twilioSubAuthToken: null,
        twilioPhoneNumber: null,
      }),
      "telnyx"
    );
    assert.equal(
      resolveVoiceProvider({
        ...twilioReady,
        voiceProvider: "telnyx",
        telnyxApiKey: null,
        telnyxPhoneNumber: null,
        telnyxConnectionId: null,
      }),
      "twilio"
    );
  });

  it("honors explicit preference when both providers are ready", () => {
    const both = {
      id: "both",
      voiceProvider: "telnyx",
      twilioSubAccountSid: "enc_sid",
      twilioSubAuthToken: "enc_token",
      twilioPhoneNumber: "+15551111111",
      telnyxApiKey: "enc_key",
      telnyxPhoneNumber: "+15552222222",
      telnyxConnectionId: "conn_abc",
    };
    assert.equal(resolveVoiceProvider(both), "telnyx");
    assert.equal(resolveVoiceProvider({ ...both, voiceProvider: "twilio" }), "twilio");
    assert.equal(workspaceFromNumber(both), "+15552222222");
    assert.equal(workspaceFromNumber({ ...both, voiceProvider: "twilio" }), "+15551111111");
  });

  it("requires Telnyx connection id for readiness", () => {
    assert.equal(
      resolveVoiceProvider({
        id: "partial",
        voiceProvider: "telnyx",
        telnyxApiKey: "enc_key",
        telnyxPhoneNumber: "+15552222222",
        telnyxConnectionId: null,
      }),
      null
    );
  });
});

describe("telephony placeOutboundCall / sendOutboundSms routing", () => {
  it("placeOutboundCall rejects when no provider is ready", async () => {
    const { placeOutboundCall } = await import("../lib/telephony.js");
    await assert.rejects(
      () =>
        placeOutboundCall(
          { id: "empty" },
          {
            to: "+15550001111",
            connectUrl: "https://example.com/connect",
            statusCallback: "https://example.com/status",
          }
        ),
      /No voice provider/
    );
  });

  it("sendOutboundSms rejects when no provider is ready", async () => {
    const { sendOutboundSms } = await import("../lib/telephony.js");
    await assert.rejects(
      () => sendOutboundSms({ id: "empty" }, { to: "+15550001111", body: "hi" }),
      /No messaging provider/
    );
  });

  it("placeOutboundCall uses Telnyx TeXML endpoint when telnyx is active", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { call_sid: "v3:telnyx_call_1" } }),
      } as Response;
    }) as typeof fetch;

    try {
      const { placeOutboundCall } = await import("../lib/telephony.js");
      // decrypt will fail on fake ciphertext — stub by placing call only if we mock decrypt.
      // Instead verify URL construction via a workspace that would hit Telnyx path after decrypt.
      // We unit-test with an encrypted-looking value and mock crypto decrypt via fetch-only path:
      // placeOutboundCall decrypts telnyxApiKey — use a known encrypt if available.
      const { encrypt } = await import("../lib/crypto.js");
      const apiKey = encrypt("KEYTEST_TELNYX_FAKE");
      const result = await placeOutboundCall(
        {
          id: "ws-telnyx",
          voiceProvider: "telnyx",
          telnyxApiKey: apiKey,
          telnyxPhoneNumber: "+15552222222",
          telnyxConnectionId: "conn_xyz",
        },
        {
          to: "+15550001111",
          connectUrl: "https://leviosa.zeluai.ca/api/call/connect/sess1",
          statusCallback: "https://leviosa.zeluai.ca/api/call/status/sess1",
          recordingStatusCallback: "https://leviosa.zeluai.ca/api/call/recording/sess1",
        }
      );
      assert.equal(result.provider, "telnyx");
      assert.equal(result.sid, "v3:telnyx_call_1");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v2\/texml\/calls\/conn_xyz$/);
      const body = JSON.parse(String(calls[0].init.body));
      assert.equal(body.To, "+15550001111");
      assert.equal(body.From, "+15552222222");
      assert.equal(body.Url, "https://leviosa.zeluai.ca/api/call/connect/sess1");
      assert.equal(body.Record, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
