// ─── RECORDING STORAGE ───────────────────────────────────────────────────────
// Fetches Twilio call recordings and persists them so playback does not depend
// on Twilio's short-lived media URLs.
//
// Prefer cloud blob (Supabase S3) when STORAGE_PROVIDER=s3 is configured.
// Falls back to local RECORDINGS_DIR (default: ./recordings).
// Public path:  ${BASE_URL}/api/call/recordings/:sessionId

import fs from "fs/promises";
import path from "path";
import {
  downloadRecordingObject,
  getStorageProvider,
  recordingObjectKey,
  uploadRecordingObject,
} from "../blob-storage.js";

const DEFAULT_DIR = path.resolve(process.cwd(), "recordings");

export function getRecordingsDir(): string {
  return process.env.RECORDINGS_DIR
    ? path.resolve(process.env.RECORDINGS_DIR)
    : DEFAULT_DIR;
}

/** Local filesystem path for a session's recording (.mp3 from Twilio). */
export function recordingFilePath(sessionId: string, ext = "mp3"): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(getRecordingsDir(), `${safe}.${ext}`);
}

/** Public URL stored on sdr_call_sessions.recording_url after persist. */
export function recordingPublicUrl(sessionId: string): string {
  const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/call/recordings/${sessionId}`;
}

export interface PersistRecordingResult {
  /** URL to store in DB (our served path, or original Twilio URL on failure). */
  storedUrl: string;
  localPath: string | null;
  objectKey: string | null;
  bytes: number;
  source: "s3" | "local" | "twilio_fallback";
}

async function fetchTwilioRecordingBuffer(opts: {
  twilioRecordingUrl: string;
  accountSid: string;
  authToken: string;
}): Promise<{ buffer: Buffer; ext: "mp3" | "wav"; contentType: string } | null> {
  const { twilioRecordingUrl, accountSid, authToken } = opts;
  const fetchUrl =
    twilioRecordingUrl.endsWith(".mp3") || twilioRecordingUrl.endsWith(".wav")
      ? twilioRecordingUrl
      : `${twilioRecordingUrl}.mp3`;

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(fetchUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch (err: any) {
    console.error(`Recording fetch failed:`, err.message);
    return null;
  }

  if (!response.ok) {
    console.error(`Recording fetch HTTP ${response.status}`);
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const ab = await response.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    ext,
    contentType: contentType.includes("wav") ? "audio/wav" : "audio/mpeg",
  };
}

/**
 * Download a Twilio recording and persist to S3 (preferred) or local disk.
 * On failure, returns the original Twilio URL so the UI can still attempt playback.
 */
export async function persistTwilioRecording(opts: {
  sessionId: string;
  twilioRecordingUrl: string;
  accountSid: string;
  authToken: string;
}): Promise<PersistRecordingResult> {
  const { sessionId, twilioRecordingUrl, accountSid, authToken } = opts;

  const fetched = await fetchTwilioRecordingBuffer({
    twilioRecordingUrl,
    accountSid,
    authToken,
  });

  if (!fetched) {
    return {
      storedUrl: twilioRecordingUrl,
      localPath: null,
      objectKey: null,
      bytes: 0,
      source: "twilio_fallback",
    };
  }

  const { buffer, ext, contentType } = fetched;

  if (getStorageProvider() === "s3") {
    try {
      const key = recordingObjectKey(sessionId, ext);
      await uploadRecordingObject({ key, body: buffer, contentType });
      console.log(
        `📼 Recording uploaded to S3 for session ${sessionId}: ${key} (${buffer.length} bytes)`
      );
      return {
        storedUrl: recordingPublicUrl(sessionId),
        localPath: null,
        objectKey: key,
        bytes: buffer.length,
        source: "s3",
      };
    } catch (err: any) {
      console.error(`S3 upload failed for ${sessionId}, falling back to local:`, err.message);
      // fall through to local
    }
  }

  try {
    const dir = getRecordingsDir();
    await fs.mkdir(dir, { recursive: true });
    const localPath = recordingFilePath(sessionId, ext);
    await fs.writeFile(localPath, buffer);
    console.log(
      `📼 Recording saved locally for session ${sessionId}: ${localPath} (${buffer.length} bytes)`
    );
    return {
      storedUrl: recordingPublicUrl(sessionId),
      localPath,
      objectKey: null,
      bytes: buffer.length,
      source: "local",
    };
  } catch (err: any) {
    console.error(`Recording write failed for ${sessionId}:`, err.message);
    return {
      storedUrl: twilioRecordingUrl,
      localPath: null,
      objectKey: null,
      bytes: 0,
      source: "twilio_fallback",
    };
  }
}

/** Resolve the on-disk file for a session, if it exists. */
export async function findLocalRecording(
  sessionId: string
): Promise<{ path: string; contentType: string } | null> {
  for (const [ext, contentType] of [
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
  ] as const) {
    const p = recordingFilePath(sessionId, ext);
    try {
      await fs.access(p);
      return { path: p, contentType };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Resolve a recording stream from S3 or local disk for HTTP playback.
 */
export async function openRecordingStream(
  sessionId: string
): Promise<{ stream: Readable; contentType: string; source: "s3" | "local" } | null> {
  if (getStorageProvider() === "s3") {
    for (const [ext, contentType] of [
      ["mp3", "audio/mpeg"],
      ["wav", "audio/wav"],
    ] as const) {
      const key = recordingObjectKey(sessionId, ext);
      try {
        const obj = await downloadRecordingObject(key);
        if (obj) {
          return {
            stream: obj.body,
            contentType: obj.contentType || contentType,
            source: "s3",
          };
        }
      } catch (err: any) {
        console.warn(`S3 get recording ${key}:`, err.message);
      }
    }
  }

  const local = await findLocalRecording(sessionId);
  if (!local) return null;

  const { createReadStream } = await import("fs");
  return {
    stream: createReadStream(local.path),
    contentType: local.contentType,
    source: "local",
  };
}
