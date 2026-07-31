/**
 * Module 9 — Knowledge base / pgvector helpers
 * Run: npx tsx --test tests/m9-kb.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chunkKnowledgeBaseText,
  hasKnowledgeBaseContent,
  shouldRebuildKnowledgeBase,
  KB_CHUNK_SIZE,
  KB_CHUNK_OVERLAP,
  KB_EMBEDDING_MODEL,
  KB_TABLE_NAME,
} from "../lib/calling/kb-helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M9 KB chunking", () => {
  it("returns empty for blank text", () => {
    assert.deepEqual(chunkKnowledgeBaseText(""), []);
    assert.deepEqual(chunkKnowledgeBaseText("   "), []);
    assert.equal(hasKnowledgeBaseContent(null), false);
    assert.equal(hasKnowledgeBaseContent(" FAQ "), true);
  });

  it("keeps short text as a single chunk", () => {
    const chunks = chunkKnowledgeBaseText("We install solar panels.");
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /solar/);
  });

  it("splits long text with overlap", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} about pricing and services.`).join(" ");
    assert.ok(text.length > KB_CHUNK_SIZE);
    const chunks = chunkKnowledgeBaseText(text, KB_CHUNK_SIZE, KB_CHUNK_OVERLAP);
    assert.ok(chunks.length >= 2);
    for (const c of chunks) {
      assert.ok(c.length <= KB_CHUNK_SIZE + 50); // allow boundary slack
    }
  });
});

describe("M9 rebuild decision", () => {
  it("rebuilds when KB text changes", () => {
    assert.equal(
      shouldRebuildKnowledgeBase({ previousKb: "old", nextKb: "new", kbEmbeddedAt: new Date() }),
      true
    );
  });

  it("skips when KB unchanged and already embedded", () => {
    assert.equal(
      shouldRebuildKnowledgeBase({
        previousKb: "same",
        nextKb: "same",
        kbEmbeddedAt: new Date(),
        vectorCount: 3,
      }),
      false
    );
  });

  it("rebuilds when never embedded or vectors missing", () => {
    assert.equal(
      shouldRebuildKnowledgeBase({ previousKb: "x", nextKb: "x", kbEmbeddedAt: null }),
      true
    );
    assert.equal(
      shouldRebuildKnowledgeBase({
        previousKb: "x",
        nextKb: "x",
        kbEmbeddedAt: new Date(),
        vectorCount: 0,
      }),
      true
    );
  });

  it("clears when KB removed", () => {
    assert.equal(
      shouldRebuildKnowledgeBase({ previousKb: "had content", nextKb: "", kbEmbeddedAt: new Date() }),
      true
    );
  });
});

describe("M9 pgvector wiring", () => {
  it("uses text-embedding-3-small and kb_documents table", () => {
    assert.equal(KB_EMBEDDING_MODEL, "text-embedding-3-small");
    assert.equal(KB_TABLE_NAME, "kb_documents");
  });

  it("ships langchain-kb with PGVectorStore", () => {
    const src = readFileSync(path.join(root, "lib/calling/langchain-kb.ts"), "utf8");
    assert.match(src, /PGVectorStore/);
    assert.match(src, /pgvector/);
    assert.match(src, /searchWorkspaceKnowledgeBase/);
    assert.match(src, /ensurePgvectorExtension/);
  });

  it("config save triggers KB rebuild", () => {
    const src = readFileSync(path.join(root, "routes/sdr.ts"), "utf8");
    assert.match(src, /buildWorkspaceVectorStore/);
    assert.match(src, /shouldRebuildKnowledgeBase/);
  });

  it("agent retrieves via searchWorkspaceKnowledgeBase", () => {
    const src = readFileSync(path.join(root, "lib/calling/langchain-agent.ts"), "utf8");
    assert.match(src, /searchWorkspaceKnowledgeBase/);
    assert.equal(src.includes("MemoryVectorStore"), false);
  });

  it("helper module exists", () => {
    assert.equal(existsSync(path.join(root, "lib/calling/kb-helpers.ts")), true);
  });
});
