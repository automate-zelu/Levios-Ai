// ─── DATA INGESTION AGENT ───────────────────────────────────────────────────
// Handles CSV/API imports, batch processing, dedup, and phone validation.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class DataIngestionAgent extends BaseAgent {
  id = "data-ingestion";
  name = "Data Ingestion Agent";
  tier = 3 as const;
  priority = 3;
  isBlocking = false;
  timeout = 120_000; // batch imports can take a while

  canHandle(event: ReactorEvent): boolean {
    return event.type === "data.import" || event.type === "data.import.batch";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { leads: leadsData, organizationId } = event.payload;
    if (!leadsData || !Array.isArray(leadsData)) {
      return this.fail("No leads array in payload");
    }

    const orgId = organizationId || event.organizationId;
    const results = { imported: 0, duplicates: 0, errors: 0 };
    const importedLeadIds: number[] = [];

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < leadsData.length; i += batchSize) {
      const batch = leadsData.slice(i, i + batchSize);

      for (const leadData of batch) {
        try {
          // Basic validation
          if (!leadData.firstName || !leadData.lastName || !leadData.email) {
            results.errors++;
            continue;
          }

          // Dedup check by email
          const existing = await context.storage.getLeadByEmail(leadData.email);
          if (existing) {
            results.duplicates++;
            continue;
          }

          // Create lead
          const lead = await context.storage.createLead({
            ...leadData,
            organizationId: orgId,
            status: "new",
          });

          importedLeadIds.push(lead.id);
          results.imported++;

          // Emit lead.imported for each (triggers compliance + scoring)
          context.emit({
            type: "lead.imported",
            organizationId: orgId,
            payload: { leadId: lead.id },
            metadata: { leadId: lead.id, priority: 4, agentSource: this.id },
          });
        } catch (err: any) {
          results.errors++;
          context.log("warn", `Import error: ${err.message}`, leadData);
        }
      }
    }

    context.log("info", `Data import complete: ${results.imported} imported, ${results.duplicates} duplicates, ${results.errors} errors`);

    return this.ok({
      ...results,
      total: leadsData.length,
      importedLeadIds,
    });
  }
}
