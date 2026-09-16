// Extract plain text from KB uploads (PDF, Word, text).

import { createRequire } from "node:module";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { formatKbSourceBlock } from "./kb-helpers.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text?: string }>;

const MAX_CHARS_PER_FILE = 200_000;

export const KB_UPLOAD_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md", ".csv"] as const;

export function kbUploadAccept(): string {
  return ".pdf,.doc,.docx,.txt,.md,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv";
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function clip(text: string): string {
  if (text.length <= MAX_CHARS_PER_FILE) return text;
  return `${text.slice(0, MAX_CHARS_PER_FILE)}\n\n[Truncated — file exceeded ${MAX_CHARS_PER_FILE} characters]`;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return String(data?.text || "");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractDoc(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return doc.getBody() || "";
}

export async function extractKnowledgeBaseFile(
  filename: string,
  buffer: Buffer
): Promise<{ filename: string; text: string; block: string }> {
  const ext = extOf(filename);
  if (!KB_UPLOAD_EXTENSIONS.includes(ext as (typeof KB_UPLOAD_EXTENSIONS)[number])) {
    throw new Error(`Unsupported file type (${ext || "unknown"}). Use PDF, Word, TXT, MD, or CSV.`);
  }

  let raw = "";
  if (ext === ".pdf") raw = await extractPdf(buffer);
  else if (ext === ".docx") raw = await extractDocx(buffer);
  else if (ext === ".doc") raw = await extractDoc(buffer);
  else raw = buffer.toString("utf8");

  const text = clip(raw.replace(/\u0000/g, "").trim());
  if (!text) throw new Error(`No extractable text in ${filename}`);

  return { filename, text, block: formatKbSourceBlock(filename, text) };
}
