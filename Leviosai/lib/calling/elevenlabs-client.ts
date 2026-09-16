// ─── ELEVENLABS STREAMING TTS CLIENT ─────────────────────────────────────────
// Converts AI text responses to audio using ElevenLabs streaming TTS.
// Returns audio as a Node.js Readable stream so it can be piped back to Twilio.
//
// Audio format: ulaw_8000 (query param) — exact format Twilio expects for <Stream>.
// Fallback: pcm_16000 → downsampled + μ-law encoded in-process if ulaw not available.
// Model: eleven_turbo_v2 — lowest latency ElevenLabs model (~300ms first byte).

import { Readable } from "stream";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel"

export function friendlyElevenLabsError(status: number, body: string): string {
  const lower = (body || "").toLowerCase();
  if (status === 401 || lower.includes("payment") || lower.includes("invoice")) {
    return "The live-call ElevenLabs voice could not play — that account has a failed or unpaid invoice. Pay it in ElevenLabs to hear the same voice used on real calls.";
  }
  return `ElevenLabs TTS error ${status}: ${body}`;
}

// ─── μ-LAW ENCODER ───────────────────────────────────────────────────────────
// Converts a 16-bit signed PCM sample to an 8-bit μ-law byte.

function linearToMulaw(sample: number): number {
  const CLIP = 32635;
  const BIAS = 132;

  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exp = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exp > 0; mask >>= 1) exp--;

  const mantissa = (sample >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mantissa)) & 0xff;
}

// Converts a chunk of PCM-16 LE at 16kHz to μ-law at 8kHz (2:1 decimation).
// Returns [converted μ-law buffer, leftover bytes that didn't form a complete frame].
function pcm16kToMulaw8k(data: Buffer, leftover: Buffer): [Buffer, Buffer] {
  const buf = Buffer.concat([leftover, data]);
  const frameBytes = 4; // 2 samples × 2 bytes — keep sample 0, drop sample 1
  const frames = Math.floor(buf.length / frameBytes);
  const out = Buffer.alloc(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = linearToMulaw(buf.readInt16LE(i * frameBytes));
  }
  return [out, buf.slice(frames * frameBytes)];
}

// ─── CLIENT ──────────────────────────────────────────────────────────────────

export class ElevenLabsClient {
  async synthesizeStream(text: string, voiceId?: string | null, modelId?: string | null): Promise<Readable> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

    const vid = voiceId || DEFAULT_VOICE_ID;
    const model = modelId || "eleven_turbo_v2";

    // output_format MUST be a query parameter — body field is silently ignored
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=ulaw_8000`;

    const response = await fetch(url, {
      method:  "POST",
      headers: {
        "xi-api-key":   apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability:        0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(friendlyElevenLabsError(response.status, body));
    }

    if (!response.body) throw new Error("ElevenLabs returned empty response body");

    // Convert Web ReadableStream → Node.js Readable
    const raw = Readable.fromWeb(response.body as any);

    // Check content-type to detect if ElevenLabs returned MP3 instead of μ-law
    const contentType = response.headers.get("content-type") ?? "";
    const isMp3 = contentType.includes("mpeg") || contentType.includes("mp3");

    if (isMp3) {
      // ElevenLabs returned MP3 despite ulaw_8000 request — this shouldn't happen
      // with a valid format param, but log it so we can diagnose.
      console.warn("⚠️  ElevenLabs returned MP3 instead of μ-law — content-type:", contentType);
    }

    console.log(`🔊 ElevenLabs stream content-type: ${contentType}`);
    return raw;
  }

  /** Browser test-call playback — MP3 buffer (not Twilio μ-law). */
  async synthesizeMp3(text: string, voiceId?: string | null, modelId?: string | null): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
    const vid = voiceId || DEFAULT_VOICE_ID;
    const model = modelId || "eleven_turbo_v2";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(friendlyElevenLabsError(response.status, body));
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // List available voices — used by GET /api/call/voices
  async listVoices(): Promise<Array<{ id: string; name: string; previewUrl: string }>> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return [];

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) return [];

    const data = await response.json() as { voices: any[] };
    return data.voices.map((v: any) => ({
      id:         v.voice_id,
      name:       v.name,
      previewUrl: v.preview_url,
    }));
  }

  async getVoice(voiceId: string): Promise<{ id: string; name: string; previewUrl: string } | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const id = (voiceId || "").trim();
    if (!apiKey || !id) return null;

    const response = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) return null;

    const v = (await response.json()) as any;
    if (!v?.voice_id) return null;
    return {
      id: v.voice_id,
      name: v.name || v.voice_id,
      previewUrl: v.preview_url || "",
    };
  }
}
