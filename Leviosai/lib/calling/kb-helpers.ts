// ─── KB HELPERS (pure) ───────────────────────────────────────────────────────
// Chunking + rebuild decisions for Module 9 (pgvector KB). Unit-tested without OpenAI/DB.

export const KB_CHUNK_SIZE = 500;
export const KB_CHUNK_OVERLAP = 50;
export const KB_EMBEDDING_MODEL = "text-embedding-3-small";
export const KB_TABLE_NAME = "kb_documents";
export const KB_COLLECTION_TABLE = "kb_collections";

/** Split knowledge-base text into overlapping chunks (mirrors RecursiveCharacterTextSplitter defaults). */
export function chunkKnowledgeBaseText(
  text: string,
  chunkSize = KB_CHUNK_SIZE,
  chunkOverlap = KB_CHUNK_OVERLAP
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    // Prefer breaking on paragraph / sentence boundaries
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" ")
      );
      if (breakAt > chunkSize * 0.4) {
        end = start + breakAt + (window[breakAt] === "." ? 1 : 0);
      }
    }
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(0, end - chunkOverlap);
  }
  return chunks;
}

export function hasKnowledgeBaseContent(text: string | null | undefined): boolean {
  return !!(text && text.trim().length > 0);
}

/** Wrap extracted file text so RAG chunks keep a source label. */
export function formatKbSourceBlock(filename: string, extractedText: string): string {
  const name = (filename || "document").trim() || "document";
  const body = (extractedText || "").replace(/\r\n/g, "\n").trim();
  if (!body) return "";
  return `--- Source: ${name} ---\n${body}`;
}

export function appendKnowledgeBaseDocuments(
  existing: string | null | undefined,
  blocks: string[]
): string {
  const parts = [(existing || "").trim(), ...blocks.map((b) => b.trim()).filter(Boolean)].filter(
    Boolean
  );
  return parts.join("\n\n");
}

export type KbSourceDoc = { filename: string; body: string };

/**
 * Split free-form notes + labeled upload blocks (`--- Source: file ---`).
 * Uploads always use formatKbSourceBlock so they can be listed/removed as files.
 */
export function splitKnowledgeBase(kb: string | null | undefined): {
  preamble: string;
  sources: KbSourceDoc[];
} {
  const text = (kb || "").replace(/\r\n/g, "\n");
  const re = /--- Source: (.+?) ---\n/g;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return { preamble: text.trim(), sources: [] };

  const firstIdx = matches[0].index ?? 0;
  const preamble = text.slice(0, firstIdx).trim();
  const sources: KbSourceDoc[] = [];
  for (let i = 0; i < matches.length; i++) {
    const filename = (matches[i][1] || "").trim() || "document";
    const bodyStart = (matches[i].index ?? 0) + matches[i][0].length;
    const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    sources.push({ filename, body });
  }
  return { preamble, sources };
}

export function listKnowledgeBaseSources(kb: string | null | undefined): string[] {
  return splitKnowledgeBase(kb).sources.map((s) => s.filename);
}

/** Remove all upload blocks with this filename (case-insensitive). Keeps free-form notes. */
export function removeKnowledgeBaseSource(
  kb: string | null | undefined,
  filename: string
): string {
  const want = (filename || "").trim().toLowerCase();
  if (!want) return (kb || "").trim();
  const { preamble, sources } = splitKnowledgeBase(kb);
  const kept = sources.filter((s) => s.filename.toLowerCase() !== want);
  if (kept.length === sources.length) return (kb || "").trim();
  const blocks = kept.map((s) => formatKbSourceBlock(s.filename, s.body));
  return appendKnowledgeBaseDocuments(preamble, blocks);
}

/**
 * Decide whether to re-embed on config save.
 * Rebuild when KB text changed, or when never embedded / no vectors yet.
 */
export function shouldRebuildKnowledgeBase(opts: {
  previousKb: string | null | undefined;
  nextKb: string | null | undefined;
  kbEmbeddedAt?: Date | string | null;
  vectorCount?: number | null;
}): boolean {
  const prev = (opts.previousKb ?? "").trim();
  const next = (opts.nextKb ?? "").trim();

  // Cleared KB — still "rebuild" (delete vectors)
  if (prev && !next) return true;
  if (!prev && !next) return false;
  if (prev !== next) return true;
  if (!opts.kbEmbeddedAt) return true;
  if (opts.vectorCount != null && opts.vectorCount <= 0 && next) return true;
  return false;
}
