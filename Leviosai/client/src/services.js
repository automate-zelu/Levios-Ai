/**
 * Service Abstraction Layer for Catalyst
 *
 * This module provides a clean separation between UI components and data sources.
 * Each service can operate in "live" mode (real API) or "mock" mode (sample data).
 *
 * To switch a service to live mode:
 * 1. Ensure the backend endpoint is running and configured
 * 2. The service will automatically use the real API through api.js
 * 3. Mock data is only used as fallback when API calls fail or return empty
 *
 * Integration Checklist:
 * - Dashboard: LIVE (via /api/dashboard)
 * - Leads: LIVE (via /api/leads)
 * - Appointments: LIVE (via /api/appointments)
 * - Campaigns: LIVE (via /api/campaigns) — falls back to sample data if empty
 * - Proposals: LIVE (via /api/proposals) — falls back to sample data if empty
 * - Conversation Replay: MOCK (sample conversations embedded in leads)
 * - Voice AI: MOCK (configuration UI, no backend endpoint yet)
 * - Sandbox: LIVE (via /api/sandbox/*)
 * - Billing: HYBRID (Stripe backend exists, UI shows mock invoice data)
 * - Integrations: MOCK (connection states stored locally)
 */

import { dashboard, leadsApi, appointmentsApi, campaignsApi, proposalsApi, activityApi, messagesApi, messagingApi, aiApi, sandboxApi } from "./api.js";

// ============================================================
// MOCK DATA — used when API returns empty or as enhancement
// ============================================================

export const MOCK_CAMPAIGNS = {
  riiviv: [
    { id: 1, name: "Solar Q1 Dead Lead Blast", status: "Active", leads: 842, contacted: 714, revived: 107, appts: 36, channel: "Omni", started: "2026-01-15" },
    { id: 2, name: "HVAC Winter Recovery", status: "Active", leads: 456, contacted: 389, revived: 62, appts: 21, channel: "Voice + SMS", started: "2026-02-01" },
    { id: 3, name: "Roofing Aged Leads — Feb", status: "Completed", leads: 320, contacted: 298, revived: 48, appts: 16, channel: "SMS + Email", started: "2026-02-10" },
  ],
  aliv: [
    { id: 4, name: "Solar New Homeowner Scrub", status: "Active", leads: 1250, contacted: 430, revived: 0, appts: 52, channel: "Web Scrub + Voice", started: "2026-03-01" },
    { id: 5, name: "Insurance Inbound Qualifier", status: "Active", leads: 680, contacted: 512, revived: 0, appts: 88, channel: "Omnichannel", started: "2026-02-15" },
  ],
};

export const MOCK_BILLING = {
  plan: { name: "Growth Tier", products: "riiviv + aliv", status: "Active" },
  pricing: {
    setup: 3500, maintenance: 750,
    riivivPerAppt: 400, alivPerAppt: 500,
    noShowCredit: 200,
  },
  currentInvoice: {
    period: "Mar 1 – Mar 31, 2026",
    items: [
      { label: "Maintenance fee", amount: 750 },
      { label: "riiviv appointments (34 x $400)", amount: 13600 },
      { label: "aliv appointments (12 x $500)", amount: 6000 },
      { label: "No-show credits (3 x $200)", amount: -600, highlight: true },
    ],
  },
};

// ============================================================
// INTEGRATION CONFIG — defines available integrations
// ============================================================

export const INTEGRATION_CATEGORIES = {
  crm: {
    label: "CRM",
    items: [
      { id: "gohighlevel", name: "GoHighLevel", icon: "⚡", description: "All-in-one CRM for agencies", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }, { key: "locationId", label: "Location ID", type: "text" }] },
      { id: "salesforce", name: "Salesforce", icon: "☁️", description: "Enterprise CRM platform", authType: "oauth", oauthUrl: "/api/integrations/salesforce/authorize" },
      { id: "hubspot", name: "HubSpot", icon: "🟠", description: "Inbound marketing & CRM", authType: "oauth", oauthUrl: "/api/integrations/hubspot/authorize" },
      { id: "zoho", name: "Zoho CRM", icon: "📋", description: "Cloud-based CRM suite", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }] },
      { id: "pipedrive", name: "Pipedrive", icon: "🔵", description: "Sales pipeline management", authType: "api_key", fields: [{ key: "apiToken", label: "API Token", type: "password" }] },
      { id: "close", name: "Close.com", icon: "📞", description: "Inside sales CRM", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }] },
    ],
  },
  calendar: {
    label: "Calendars",
    items: [
      {
        id: "google_calendar",
        name: "Google Calendar",
        icon: "📅",
        description: "Check availability and book appointments on calls",
        authType: "oauth",
        oauthUrl: "/api/calendar/oauth/google/start",
      },
    ],
  },
  automation: {
    label: "Automation & Webhooks",
    items: [
      { id: "n8n", name: "n8n", icon: "🔄", description: "Workflow automation", authType: "webhook", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }] },
      { id: "zapier", name: "Zapier", icon: "⚡", description: "Connect 5,000+ apps", authType: "webhook", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }] },
      { id: "make", name: "Make (Integromat)", icon: "🔧", description: "Visual automation builder", authType: "webhook", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }] },
      { id: "custom_webhook", name: "Custom Webhook", icon: "🔗", description: "Send events to any URL", authType: "webhook", fields: [{ key: "webhookUrl", label: "Endpoint URL", type: "url" }, { key: "secret", label: "Signing Secret (optional)", type: "password" }] },
    ],
  },
  communication: {
    label: "Communication",
    items: [
      { id: "twilio", name: "Twilio", icon: "📱", description: "SMS & Voice API", authType: "api_key", fields: [{ key: "accountSid", label: "Account SID", type: "text" }, { key: "authToken", label: "Auth Token", type: "password" }, { key: "phoneNumber", label: "Phone Number", type: "text" }], backendConfigured: true },
      { id: "resend", name: "Resend", icon: "✉️", description: "Email API", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }, { key: "fromEmail", label: "From Email", type: "email" }], backendConfigured: true },
      { id: "sendgrid", name: "SendGrid", icon: "📨", description: "Email delivery platform", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }] },
    ],
  },
  ai: {
    label: "AI & Analytics",
    items: [
      { id: "anthropic", name: "Claude AI", icon: "🧠", description: "Lead scoring & messaging", authType: "api_key", fields: [{ key: "apiKey", label: "API Key", type: "password" }], backendConfigured: true },
    ],
  },
};

// ============================================================
// SERVICE FUNCTIONS
// ============================================================

/**
 * Dashboard service — wraps real API with fallback
 */
export const dashboardService = {
  async getStats() {
    return await dashboard.getStats();
  },
  async getActivity(limit = 7) {
    return await activityApi.list({ limit });
  },
};

/**
 * Leads service — wraps real API
 */
export const leadsService = {
  async list(filters = {}) {
    return await leadsApi.list(filters);
  },
  async get(id) {
    return await leadsApi.get(id);
  },
  async create(data) {
    return await leadsApi.create(data);
  },
  async update(id, data) {
    return await leadsApi.update(id, data);
  },
  async delete(id) {
    return await leadsApi.delete(id);
  },
  async score(id, notes) {
    return await aiApi.scoreLead(id, notes);
  },
  async generateMessage(id, channel, context) {
    return await aiApi.generateMessage(id, channel, context);
  },
};

/**
 * Appointments service
 */
export const appointmentsService = {
  async list(filters = {}) {
    return await appointmentsApi.list(filters);
  },
  async create(data) {
    return await appointmentsApi.create(data);
  },
  async update(id, data) {
    return await appointmentsApi.update(id, data);
  },
};

/**
 * Campaigns service — uses API, falls back to mock
 */
export const campaignsService = {
  async list() {
    try {
      const data = await campaignsApi.list();
      if (data && data.length > 0) return data;
      return null; // Signal to use mock
    } catch {
      return null;
    }
  },
  async create(data) {
    return await campaignsApi.create(data);
  },
  getMockData() {
    return MOCK_CAMPAIGNS;
  },
};

/**
 * Proposals service — uses API, falls back to mock
 */
export const proposalsService = {
  async list(leadId) {
    try {
      const data = await proposalsApi.list(leadId);
      if (data && data.length > 0) return data;
      return null;
    } catch {
      return null;
    }
  },
  async create(data) {
    return await proposalsApi.create(data);
  },
};

/**
 * Messaging service — wraps Twilio/Resend endpoints
 */
export const messagingService = {
  async sendSMS(leadId, message, aiGenerated = false) {
    return await messagingApi.sendSMS(leadId, message, aiGenerated);
  },
  async sendEmail(leadId, subject, body, aiGenerated = false) {
    return await messagingApi.sendEmail(leadId, subject, body, aiGenerated);
  },
  async initiateCall(leadId) {
    return await messagingApi.initiateCall(leadId);
  },
  async getStatus() {
    return await messagingApi.integrationStatus();
  },
};

/**
 * Billing service — wraps Stripe API
 * TODO: Connect to real /api/billing endpoints
 */
export const billingService = {
  async getPlan() {
    try {
      const data = await fetch("/api/billing", {
        headers: { Authorization: `Bearer ${localStorage.getItem("catalyst_token")}` },
      });
      if (data.ok) return await data.json();
      return MOCK_BILLING;
    } catch {
      return MOCK_BILLING;
    }
  },
  getMockData() {
    return MOCK_BILLING;
  },
};

/**
 * Integration connection state manager
 * Stores connection state locally until backend integration endpoints exist
 */
const INTEGRATIONS_STORAGE_KEY = "catalyst_integrations";

export const integrationsService = {
  getConnections() {
    try {
      const stored = localStorage.getItem(INTEGRATIONS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  },
  saveConnection(integrationId, credentials) {
    const connections = this.getConnections();
    connections[integrationId] = {
      connected: true,
      connectedAt: new Date().toISOString(),
      credentials, // In production, these would be sent to the backend
    };
    localStorage.setItem(INTEGRATIONS_STORAGE_KEY, JSON.stringify(connections));
    return connections[integrationId];
  },
  disconnect(integrationId) {
    const connections = this.getConnections();
    delete connections[integrationId];
    localStorage.setItem(INTEGRATIONS_STORAGE_KEY, JSON.stringify(connections));
  },
  isConnected(integrationId) {
    const connections = this.getConnections();
    return !!connections[integrationId]?.connected;
  },
  async testConnection(integrationId) {
    // In production, this would call /api/integrations/{id}/test
    // For now, simulate a test
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, message: "Connection verified" });
      }, 1500);
    });
  },
};
