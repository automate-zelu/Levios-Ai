import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { WebSocketServer } from "ws";
import "dotenv/config";
import { initSentry, Sentry } from "./lib/sentry.js";

// Initialize Sentry before anything else
initSentry();
import { checkDatabaseConnection, closeDatabaseConnection } from "./lib/db.js";
import apiRoutes from "./routes/api.js";
import authRoutes from "./routes/auth.js";
import messagingRoutes from "./routes/messaging.js";
import aiRoutes from "./routes/ai.js";
import billingRoutes from "./routes/billing.js";
import webhookRoutes from "./routes/webhooks.js";
import reactorRoutes from "./routes/reactor.js";
import sandboxRoutes from "./routes/sandbox.js";
import settingsRoutes from "./routes/settings.js";
import sdrRoutes from "./routes/sdr.js";
import adminRoutes from "./routes/admin.js";
import twilioByotRoutes from "./routes/twilio-byot.js";
import callRoutes, { handleCallStream } from "./routes/call.js";
import teamRoutes from "./routes/team.js";
import calendarRoutes from "./routes/calendar.js";
import gmailRoutes from "./routes/gmail.js";
import { rebuildAllKnowledgeBases } from "./lib/calling/langchain-kb.js";
import { Reactor } from "./reactor/reactor.js";
import { createAllAgents } from "./reactor/agents/index.js";
import { authLimiter, apiLimiter, aiLimiter, messagingLimiter } from "./lib/rate-limit.js";
import { initSdrQueue } from "./lib/sdr-queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Behind nginx on EC2 — trust X-Forwarded-* for rate-limit + correct URLs
app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "3000");
const isProd = process.env.NODE_ENV === "production";

// Stripe webhook needs raw body — must be registered before express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/ai", aiLimiter);
app.use("/api/leads/:id/sms", messagingLimiter);
app.use("/api/leads/:id/email", messagingLimiter);
app.use("/api/leads/:id/call", messagingLimiter);
app.use("/api", apiLimiter);

// API Routes
app.use(authRoutes);
app.use(billingRoutes);
app.use(webhookRoutes);
app.use(apiRoutes);
app.use(messagingRoutes);
app.use(aiRoutes);
app.use(reactorRoutes);
app.use(sandboxRoutes);
app.use(settingsRoutes);
app.use(sdrRoutes);
app.use(adminRoutes);
app.use(twilioByotRoutes);
app.use(callRoutes);
app.use(teamRoutes);
app.use(calendarRoutes);
app.use(gmailRoutes);

// Sentry error handler (must be after routes, before Vite/static)
Sentry.setupExpressErrorHandler(app);

async function setupVite() {
  if (isProd) {
    // Production: serve built client files
    const distPath = path.resolve(__dirname, "client/dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Development: use Vite dev server as middleware
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: path.resolve(__dirname, "client"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
}

// Start
async function start() {
  console.log("\n🚀 Leviosai CRM Server Starting...\n");

  // Check database (non-blocking — frontend still loads without DB)
  const dbOk = await checkDatabaseConnection();
  if (!dbOk) {
    console.warn("⚠️  Database unavailable — API routes will fail but frontend will load. Check your DATABASE_URL.");
  }

  // Hydrate durable KB vector stores (pgvector) for all workspaces with a knowledge base.
  // Loads existing embeddings when present; re-embeds only when the collection is empty.
  // Non-blocking — server continues starting while this runs.
  if (dbOk) {
    rebuildAllKnowledgeBases().catch((err: Error) =>
      console.error("KB rebuild failed:", err.message)
    );
  }

  // Start Reactor (agent orchestrator)
  console.log("\n⚡ Initializing Reactor...");
  const reactor = Reactor.getInstance();
  reactor.registerAgents(createAllAgents());
  reactor.start();

  // Initialize SDR BullMQ job queue
  console.log("⚡ Initializing SDR Queue...");
  initSdrQueue();

  // Schedule SDR dormant lead scan every 30 minutes
  // Emits sdr.dormant.scan event into the Reactor
  const SDR_SCAN_INTERVAL_MS = (() => {
    const schedule = process.env.SDR_SCAN_SCHEDULE || "*/30 * * * *";
    // Parse interval from cron expression — default 30 minutes
    const match = schedule.match(/\*\/(\d+)/);
    return match ? parseInt(match[1]) * 60 * 1000 : 30 * 60 * 1000;
  })();

  setInterval(() => {
    const triggeredAt = new Date().toISOString();
    reactor.emit({
      type: "sdr.dormant.scan",
      organizationId: 0, // system-level event — DormantLeadAgent scans all workspaces internally
      payload: { triggeredAt },
      metadata: { priority: 4 },
    });
    reactor.emit({
      type: "sdr.recovery.scan",
      organizationId: 0, // system-level event — StuckEnrollmentAgent scans all workspaces internally
      payload: { triggeredAt },
      metadata: { priority: 4 },
    });
  }, SDR_SCAN_INTERVAL_MS);

  console.log(`✅ SDR dormant scan + recovery scheduled every ${SDR_SCAN_INTERVAL_MS / 60000} minutes`);

  // Setup frontend
  await setupVite();

  // Create HTTP server so we can attach the WebSocket server alongside Express
  const httpServer = http.createServer(app);

  // WebSocket server for Twilio media streams — path: /api/call/stream/:sessionId
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    const match = url.match(/^\/api\/call\/stream\/([^/?]+)/);
    if (match) {
      const sessionId = match[1];
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleCallStream(ws, sessionId);
      });
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`\n✅ Server running on http://localhost:${PORT}`);
    console.log(`📞 Call stream:   WS  ws://localhost:${PORT}/api/call/stream/:sessionId`);
    console.log(`📊 Dashboard:     GET http://localhost:${PORT}/api/dashboard`);
    console.log(`👥 Leads:         GET http://localhost:${PORT}/api/leads`);
    console.log(`📅 Appointments:  GET http://localhost:${PORT}/api/appointments`);
    console.log(`💚 Health:        GET http://localhost:${PORT}/api/health\n`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await closeDatabaseConnection();
  process.exit(0);
});

export { app };

start();
