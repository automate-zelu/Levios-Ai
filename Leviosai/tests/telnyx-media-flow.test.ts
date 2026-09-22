/**
 * Telnyx BYOT — media protocol + mocked call flow (no live Telnyx network required).
 * Run: npx tsx --test tests/telephony-byot.test.ts tests/telnyx-media-flow.test.ts
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  buildClearFrame,
  buildConnectStreamXml,
  buildOutboundMediaFrame,
  detectMediaStreamProvider,
  extractStreamId,
} from "../lib/calling/media-stream-protocol.js";
import {
  placeOutboundCall,
  resolveVoiceProvider,
  workspacePhoneConnected,
} from "../lib/telephony.js";
import { encrypt } from "../lib/crypto.js";

describe("media-stream-protocol Telnyx vs Twilio", () => {
  it("builds Telnyx Connect Stream XML with bidirectional PCMU", () => {
    const xml = buildConnectStreamXml({
      provider: "telnyx",
      streamUrl: "wss://leviosa.zeluai.ca/api/call/stream/sess-1",
    });
    assert.match(xml, /<Connect>/);
    assert.match(xml, /bidirectionalMode="rtp"/);
    assert.match(xml, /bidirectionalCodec="PCMU"/);
    assert.match(xml, /bidirectionalSamplingRate="8000"/);
    assert.match(xml, /track="inbound_track"/);
    assert.match(xml, /wss:\/\/leviosa\.zeluai\.ca\/api\/call\/stream\/sess-1/);
  });

  it("builds Twilio Connect Stream XML without Telnyx attrs", () => {
    const xml = buildConnectStreamXml({
      provider: "twilio",
      streamUrl: "wss://example.com/api/call/stream/abc",
    });
    assert.match(xml, /<Stream url="wss:\/\/example.com\/api\/call\/stream\/abc" track="inbound_track"/);
    assert.doesNotMatch(xml, /bidirectionalMode/);
  });

  it("extracts stream id from Twilio and Telnyx start frames", () => {
    assert.equal(
      extractStreamId({ event: "start", start: { streamSid: "MZ_twilio" } }),
      "MZ_twilio"
    );
    assert.equal(
      extractStreamId({
        event: "start",
        stream_id: "32DE0DEA-53CB",
        start: { call_control_id: "v3:abc", media_format: { encoding: "PCMU", sample_rate: 8000 } },
      }),
      "32DE0DEA-53CB"
    );
  });

  it("detects Telnyx from start frame shape", () => {
    assert.equal(
      detectMediaStreamProvider({
        event: "start",
        stream_id: "abc",
        start: { media_format: { encoding: "PCMU" } },
      }),
      "telnyx"
    );
    assert.equal(
      detectMediaStreamProvider({ event: "start", start: { streamSid: "MZ1" } }),
      "twilio"
    );
  });

  it("builds outbound media/clear frames per provider", () => {
    const twMedia = JSON.parse(buildOutboundMediaFrame("twilio", "MZ1", "AAAA"));
    assert.equal(twMedia.streamSid, "MZ1");
    assert.equal(twMedia.media.payload, "AAAA");

    const txMedia = JSON.parse(buildOutboundMediaFrame("telnyx", "sid", "BBBB"));
    assert.equal(txMedia.event, "media");
    assert.equal(txMedia.media.payload, "BBBB");
    assert.equal(txMedia.streamSid, undefined);

    assert.deepEqual(JSON.parse(buildClearFrame("telnyx", "x")), { event: "clear" });
    assert.deepEqual(JSON.parse(buildClearFrame("twilio", "MZ1")), {
      event: "clear",
      streamSid: "MZ1",
    });
  });
});

describe("mocked Telnyx outbound call flow (sandbox)", () => {
  it("rejects incomplete Telnyx workspace before dialing", async () => {
    assert.equal(
      resolveVoiceProvider({
        id: "w",
        voiceProvider: "telnyx",
        telnyxApiKey: "enc",
        telnyxPhoneNumber: "+12095550100",
        // missing connection id
      }),
      null
    );
    assert.equal(
      workspacePhoneConnected({
        id: "w",
        voiceProvider: "telnyx",
        telnyxApiKey: "enc",
        telnyxPhoneNumber: "+12095550100",
      }),
      false
    );
  });

  it("placeOutboundCall posts TeXML dial and returns call sid (mocked fetch)", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          call_sid: "v3:mock_call_sid_ok",
          from: "+12096380589",
          to: "+19295689007",
          status: "queued",
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const apiKey = encrypt("KEY_MOCK_SANDBOX");
      const result = await placeOutboundCall(
        {
          id: "ws-mock",
          voiceProvider: "telnyx",
          telnyxApiKey: apiKey,
          telnyxPhoneNumber: "+12096380589",
          telnyxConnectionId: "3054807533123274130",
        },
        {
          to: "+19295689007",
          connectUrl: "https://leviosa.zeluai.ca/api/call/connect/sess-mock",
          statusCallback: "https://leviosa.zeluai.ca/api/call/status/sess-mock",
          recordingStatusCallback: "https://leviosa.zeluai.ca/api/call/recording/sess-mock",
        }
      );

      assert.equal(result.provider, "telnyx");
      assert.equal(result.sid, "v3:mock_call_sid_ok");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v2\/texml\/calls\/3054807533123274130$/);
      assert.equal(calls[0].body.To, "+19295689007");
      assert.equal(calls[0].body.From, "+12096380589");
      assert.equal(calls[0].body.Url, "https://leviosa.zeluai.ca/api/call/connect/sess-mock");
      assert.equal(calls[0].body.Record, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("placeOutboundCall surfaces Telnyx D60 account errors even on HTTP 200", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: { call_control_id: "v3:x" },
        errors: [
          {
            code: "10010",
            detail:
              "Can not make calls to non-verified numbers at this account level D60.",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    try {
      const apiKey = encrypt("KEY_MOCK_SANDBOX");
      await assert.rejects(
        () =>
          placeOutboundCall(
            {
              id: "ws-mock",
              voiceProvider: "telnyx",
              telnyxApiKey: apiKey,
              telnyxPhoneNumber: "+12096380589",
              telnyxConnectionId: "conn1",
            },
            {
              to: "+923420006938",
              connectUrl: "https://example.com/connect",
              statusCallback: "https://example.com/status",
            }
          ),
        /non-verified|D60|account level/i
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("simulates answer → connect XML → stream start → outbound AI audio frame", () => {
    // 1) Provider dials and fetches connect URL → we return Telnyx Stream XML
    const connectXml = buildConnectStreamXml({
      provider: "telnyx",
      streamUrl: "wss://leviosa.zeluai.ca/api/call/stream/sess-flow",
    });
    assert.match(connectXml, /bidirectionalMode="rtp"/);

    // 2) Telnyx opens WS and sends start (Call Control / TeXML media shape)
    const startMsg = {
      event: "start",
      stream_id: "32DE0DEA-FLOW",
      start: {
        call_control_id: "v3:flow",
        media_format: { encoding: "PCMU", sample_rate: 8000, channels: 1 },
      },
    };
    const provider = detectMediaStreamProvider(startMsg);
    const streamId = extractStreamId(startMsg);
    assert.equal(provider, "telnyx");
    assert.equal(streamId, "32DE0DEA-FLOW");

    // 3) Inbound lead audio chunk
    const inbound = {
      event: "media",
      stream_id: streamId,
      media: { track: "inbound", payload: "qqqq", chunk: "1", timestamp: "0" },
    };
    assert.ok(inbound.media.payload);

    // 4) Agent replies with μ-law frame (OpenAI Realtime / TTS path)
    const out = JSON.parse(buildOutboundMediaFrame(provider, streamId, "AI_AUDIO_B64"));
    assert.equal(out.event, "media");
    assert.equal(out.media.payload, "AI_AUDIO_B64");

    // 5) Barge-in clear
    assert.deepEqual(JSON.parse(buildClearFrame(provider, streamId)), { event: "clear" });
  });
});
