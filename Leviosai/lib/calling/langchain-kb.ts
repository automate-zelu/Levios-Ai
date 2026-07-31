// ─── LANGCHAIN KNOWLEDGE BASE (Module 9 — pgvector) ──────────────────────────
// Embeds each workspace's knowledge base into Postgres via pgvector.
// Survives restarts and supports multi-instance deploys.
//
// Hot path: in-memory cache of PGVectorStore instances per workspace.
// Cold start: initialize from existing pgvector rows (no re-embed) when present;
//             otherwise embed from sdr_configs.knowledge_base text.
//
// Called by PUT /api/sdr/config whenever the client saves their KB.
// Retrieved during live calls for RAG (similarity search).

import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { db, pool } from "../db.js";
import { sdrConfigs } from "../schema.js";
import { eq, isNotNull } from "drizzle-orm";
import {
  KB_CHUNK_SIZE,
  KB_CHUNK_OVERLAP,
  KB_EMBEDDING_MODEL,
  KB_TABLE_NAME,
  KB_COLLECTION_TABLE,
  hasKnowledgeBaseContent,
} from "./kb-helpers.js";

type WorkspaceStore = PGVectorStore;

const workspaceVectorStores = new Map<string, WorkspaceStore>();
let extensionReady: Promise<void> | null = null;

function getEmbeddings() {
  return new OpenAIEmbeddings({
    model: KB_EMBEDDING_MODEL,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

function storeConfig(workspaceId: string) {
  return {
    pool,
    tableName: KB_TABLE_NAME,
    collectionTableName: KB_COLLECTION_TABLE,
    collectionName: workspaceId,
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "text",
      metadataColumnName: "metadata",
    },
    distanceStrategy: "cosine" as const,
  };
}

/** Ensure pgvector extension exists (safe to call repeatedly). */
export async function ensurePgvectorExtension(): Promise<void> {
  if (!extensionReady) {
    extensionReady = (async () => {
      try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      } catch (err: any) {
        // Some managed Postgres setups require superuser for CREATE EXTENSION —
        // continue; PGVectorStore.initialize may still succeed if already enabled.
        console.warn(`⚠️  pgvector extension ensure: ${err.message}`);
      }
    })();
  }
  await extensionReady;
}

async function openStore(workspaceId: string): Promise<WorkspaceStore> {
  await ensurePgvectorExtension();
  const store = await PGVectorStore.initialize(getEmbeddings(), storeConfig(workspaceId));
  workspaceVectorStores.set(workspaceId, store);
  return store;
}

async function countVectors(workspaceId: string): Promise<number> {
  try {
    // LangChain collections table links collection uuid → name
    const result = await pool.query(
      `SELECT COUNT(d.*) AS n
       FROM ${KB_TABLE_NAME} d
       JOIN ${KB_COLLECTION_TABLE} c ON d.collection_id = c.uuid
       WHERE c.name = $1`,
      [workspaceId]
    );
    return Number(result.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

async function clearWorkspaceVectors(store: WorkspaceStore, workspaceId: string): Promise<void> {
  try {
    await store.delete({ filter: { workspaceId } });
  } catch {
    /* filter delete may no-op if metadata shape differs */
  }
  // Hard delete via SQL for reliability across LangChain versions
  try {
    await pool.query(
      `DELETE FROM ${KB_TABLE_NAME} d
       USING ${KB_COLLECTION_TABLE} c
       WHERE d.collection_id = c.uuid AND c.name = $1`,
      [workspaceId]
    );
  } catch (err: any) {
    console.warn(`KB clear for ${workspaceId}: ${err.message}`);
  }
}

// ─── BUILD / REBUILD ─────────────────────────────────────────────────────────

/**
 * Embed KB text into pgvector for a workspace and refresh the in-memory handle.
 * Empty text clears vectors for that workspace.
 */
export async function buildWorkspaceVectorStore(
  workspaceId: string,
  knowledgeBaseText: string
): Promise<{ chunks: number }> {
  await ensurePgvectorExtension();

  if (!hasKnowledgeBaseContent(knowledgeBaseText)) {
    const existing = workspaceVectorStores.get(workspaceId);
    if (existing) {
      await clearWorkspaceVectors(existing, workspaceId);
      workspaceVectorStores.delete(workspaceId);
      try { await existing.end?.(); } catch { /* ignore */ }
    } else {
      try {
        const tmp = await openStore(workspaceId);
        await clearWorkspaceVectors(tmp, workspaceId);
        workspaceVectorStores.delete(workspaceId);
        try { await tmp.end?.(); } catch { /* ignore */ }
      } catch {
        /* tables may not exist yet — nothing to clear */
      }
    }
    await db
      .update(sdrConfigs)
      .set({ kbEmbeddedAt: null, updatedAt: new Date() })
      .where(eq(sdrConfigs.workspaceId, workspaceId));
    return { chunks: 0 };
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: KB_CHUNK_SIZE,
    chunkOverlap: KB_CHUNK_OVERLAP,
  });
  const docs = await splitter.createDocuments([knowledgeBaseText], [
    { workspaceId },
  ]);

  // Attach workspaceId metadata for filter deletes
  const withMeta: Document[] = docs.map(
    (d) =>
      new Document({
        pageContent: d.pageContent,
        metadata: { ...d.metadata, workspaceId },
      })
  );

  let store = workspaceVectorStores.get(workspaceId);
  if (!store) {
    store = await openStore(workspaceId);
  }

  await clearWorkspaceVectors(store, workspaceId);
  if (withMeta.length > 0) {
    await store.addDocuments(withMeta);
  }

  await db
    .update(sdrConfigs)
    .set({ kbEmbeddedAt: new Date(), updatedAt: new Date() })
    .where(eq(sdrConfigs.workspaceId, workspaceId));

  console.log(`✅ KB embedded for workspace ${workspaceId}: ${withMeta.length} chunk(s) → pgvector`);
  return { chunks: withMeta.length };
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────

/**
 * Return a vector store for similarity search.
 * Prefers cached PGVectorStore; initializes from Postgres without re-embedding.
 */
export async function loadWorkspaceVectorStore(
  workspaceId: string
): Promise<WorkspaceStore | null> {
  const cached = workspaceVectorStores.get(workspaceId);
  if (cached) return cached;

  const n = await countVectors(workspaceId);
  if (n <= 0) return null;

  try {
    return await openStore(workspaceId);
  } catch (err: any) {
    console.warn(`KB load failed for ${workspaceId}: ${err.message}`);
    return null;
  }
}

/** Sync helper for callers that cannot await — uses cache only. Prefer async load. */
export function getCachedWorkspaceVectorStore(workspaceId: string): WorkspaceStore | null {
  return workspaceVectorStores.get(workspaceId) ?? null;
}

/**
 * Similarity search against durable KB. Returns empty array if no store.
 */
export async function searchWorkspaceKnowledgeBase(
  workspaceId: string,
  query: string,
  k = 3
): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
  const store = await loadWorkspaceVectorStore(workspaceId);
  if (!store || !query?.trim()) return [];
  try {
    const results = await store.similaritySearch(query, k);
    return results.map((r) => ({
      pageContent: r.pageContent,
      metadata: (r.metadata || {}) as Record<string, unknown>,
    }));
  } catch (err: any) {
    console.warn(`KB search failed for ${workspaceId}: ${err.message}`);
    return [];
  }
}

// ─── STARTUP ─────────────────────────────────────────────────────────────────
// Hydrate stores from pgvector when vectors exist; otherwise embed from DB text.

export async function rebuildAllKnowledgeBases(): Promise<{
  loaded: number;
  embedded: number;
  skipped: number;
}> {
  await ensurePgvectorExtension();

  const configs = await db
    .select({
      workspaceId: sdrConfigs.workspaceId,
      knowledgeBase: sdrConfigs.knowledgeBase,
      kbEmbeddedAt: sdrConfigs.kbEmbeddedAt,
    })
    .from(sdrConfigs)
    .where(isNotNull(sdrConfigs.knowledgeBase));

  let loaded = 0;
  let embedded = 0;
  let skipped = 0;

  for (const config of configs) {
    if (!hasKnowledgeBaseContent(config.knowledgeBase)) {
      skipped++;
      continue;
    }
    try {
      const existing = await countVectors(config.workspaceId);
      if (existing > 0) {
        await openStore(config.workspaceId);
        loaded++;
      } else {
        await buildWorkspaceVectorStore(config.workspaceId, config.knowledgeBase!);
        embedded++;
      }
    } catch (err: any) {
      skipped++;
      console.error(`KB rebuild failed for workspace ${config.workspaceId}:`, err.message);
    }
  }

  console.log(
    `✅ Knowledge base ready: ${loaded} loaded from pgvector, ${embedded} re-embedded, ${skipped} skipped`
  );
  return { loaded, embedded, skipped };
}

/** Test / ops helper */
export async function getWorkspaceVectorCount(workspaceId: string): Promise<number> {
  return countVectors(workspaceId);
}
