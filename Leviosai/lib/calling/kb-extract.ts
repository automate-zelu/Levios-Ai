// Extract plain text from KB uploads (PDF, Word, text).

import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { PDFParse } from "pdf-parse";
import { formatKbSourceBlock } from "./kb-helpers.js";

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
  // pdf-parse v2+: class API (v1 was a default function — that broke with "pdfParse is not a function")
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return String(data?.text || "");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
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
