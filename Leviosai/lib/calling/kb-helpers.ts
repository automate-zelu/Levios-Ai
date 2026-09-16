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
