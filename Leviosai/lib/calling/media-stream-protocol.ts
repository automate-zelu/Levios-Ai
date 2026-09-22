/**
 * Media-stream connect XML + WS frame helpers for Twilio and Telnyx.
 * Telnyx TeXML Stream needs bidirectionalMode=rtp + PCMU to match OpenAI Realtime μ-law.
 */

export type MediaStreamProvider = "twilio" | "telnyx";

/** TwiML/TeXML returned when the callee answers — opens bidirectional media WS. */
export function buildConnectStreamXml(opts: {
  provider: MediaStreamProvider;
  streamUrl: string;
}): string {
  const url = escapeXmlAttr(opts.streamUrl);
  if (opts.provider === "telnyx") {
    // Telnyx TeXML Stream — bidirectional RTP PCMU @ 8 kHz (matches Twilio μ-law path).
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Connect>` +
      `<Stream url="${url}" track="inbound_track" ` +
      `bidirectionalMode="rtp" bidirectionalCodec="PCMU" bidirectionalSamplingRate="8000" />` +
      `</Connect>` +
      `</Response>`
    );
  }

  // Twilio Connect/Stream — inbound_track only (Twilio error 31941 if both_tracks).
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<Stream url="${url}" track="inbound_track" />` +
    `</Connect>` +
    `</Response>`
  );
}

export function extractStreamId(msg: any): string {
  return String(
    msg?.streamSid ||
      msg?.stream_id ||
      msg?.start?.streamSid ||
      msg?.start?.stream_id ||
      ""
  );
}

/** Infer provider from start frame shape (Telnyx uses stream_id / media_format). */
export function detectMediaStreamProvider(msg: any): MediaStreamProvider {
  if (msg?.stream_id || msg?.start?.media_format || msg?.start?.call_control_id) {
    return "telnyx";
  }
  return "twilio";
}

export function buildOutboundMediaFrame(
  provider: MediaStreamProvider,
  streamId: string,
  payloadB64: string
): string {
  if (provider === "telnyx") {
    // Telnyx Client Media Frame — stream_id optional; payload only required.
    return JSON.stringify({ event: "media", media: { payload: payloadB64 } });
  }
  return JSON.stringify({
    event: "media",
    streamSid: streamId,
    media: { payload: payloadB64 },
  });
}

export function buildClearFrame(provider: MediaStreamProvider, streamId: string): string {
  if (provider === "telnyx") {
    return JSON.stringify({ event: "clear" });
  }
  return JSON.stringify({ event: "clear", streamSid: streamId });
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
