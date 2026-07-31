// ─── Cloud blob storage (S3-compatible — Supabase Storage) ───────────────────
// Uses the AWS S3 API against Supabase's S3 endpoint (IMPLEMENTATION_PLAN §22).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

export type StorageProvider = "s3" | "local";

export function getStorageProvider(): StorageProvider {
  const p = (process.env.STORAGE_PROVIDER || "").toLowerCase();
  if (p === "s3" && isS3Configured()) return "s3";
  return "local";
}

export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT) &&
    process.env.STORAGE_BUCKET
  );
}

export function getStorageBucket(): string {
  return process.env.STORAGE_BUCKET || "recordings";
}

export function recordingObjectKey(sessionId: string, ext = "mp3"): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `call-recordings/${safe}.${ext}`;
}

let client: S3Client | null = null;
let bucketReady = false;

export function getS3Client(): S3Client {
  if (client) return client;
  if (!isS3Configured()) {
    throw new Error("S3 storage is not configured");
  }
  const endpoint = (process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT || "").replace(/\/$/, "");
  client = new S3Client({
    forcePathStyle: true,
    region: process.env.AWS_REGION || "ap-northeast-1",
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

/** Ensure the configured bucket exists (idempotent). */
export async function ensureStorageBucket(): Promise<void> {
  if (bucketReady) return;
  const s3 = getS3Client();
  const Bucket = getStorageBucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket }));
      console.log(`✅ Created storage bucket: ${Bucket}`);
    } catch (err: any) {
      // Bucket may already exist or creation may require dashboard — continue; Put will surface errors
      console.warn(`Storage bucket ensure warning (${Bucket}):`, err.message);
    }
  }
  bucketReady = true;
}

export async function uploadRecordingObject(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; bucket: string }> {
  await ensureStorageBucket();
  const Bucket = getStorageBucket();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    })
  );
  return { key: opts.key, bucket: Bucket };
}

export async function downloadRecordingObject(
  key: string
): Promise<{ body: Readable; contentType: string } | null> {
  if (!isS3Configured()) return null;
  try {
    const out = await getS3Client().send(
      new GetObjectCommand({
        Bucket: getStorageBucket(),
        Key: key,
      })
    );
    if (!out.Body) return null;
    const body = out.Body as Readable;
    const contentType = out.ContentType || "audio/mpeg";
    return { body, contentType };
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/** Reset cached client (tests). */
export function resetBlobStorageClient(): void {
  client = null;
  bucketReady = false;
}
