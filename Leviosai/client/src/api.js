// API client for Catalyst frontend
const API_BASE = "";

function getToken() {
  return localStorage.getItem("catalyst_token");
}

export function setToken(token) {
  localStorage.setItem("catalyst_token", token);
}

export function clearToken() {
  localStorage.removeItem("catalyst_token");
}

export function isAuthenticated() {
  return !!getToken();
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

// Auth
export const auth = {
  login: (email, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (data) => request("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  me: () => request("/api/auth/me"),
  completeOnboarding: () => request("/api/auth/onboarding/complete", { method: "POST", body: "{}" }),
};

// Dashboard
export const dashboard = {
  getStats: () => request("/api/dashboard"),
};

// Leads
export const leadsApi = {
  list: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.temperature) params.set("temperature", filters.temperature);
    if (filters.search) params.set("search", filters.search);
    const qs = params.toString();
    return request(`/api/leads${qs ? `?${qs}` : ""}`);
  },
  get: (id) => request(`/api/leads/${id}`),
  create: (data) => request("/api/leads", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => request(`/api/leads/${id}`, { method: "DELETE" }),
  getMessages: (leadId) => request(`/api/leads/${leadId}/messages`),
  sendMessage: (leadId, data) => request(`/api/leads/${leadId}/messages`, { method: "POST", body: JSON.stringify(data) }),
  getPipelineStats: () => request("/api/leads/pipeline/stats"),
};

// Appointments
export const appointmentsApi = {
  list: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.leadId) params.set("leadId", String(filters.leadId));
    const qs = params.toString();
    return request(`/api/appointments${qs ? `?${qs}` : ""}`);
  },
  create: (data) => request("/api/appointments", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => request(`/api/appointments/${id}`, { method: "DELETE" }),
};

// Campaigns
export const campaignsApi = {
  list: () => request("/api/campaigns"),
  create: (data) => request("/api/campaigns", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};

// Proposals
export const proposalsApi = {
  list: (leadId) => request(`/api/proposals${leadId ? `?leadId=${leadId}` : ""}`),
  create: (data) => request("/api/proposals", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/proposals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => request(`/api/proposals/${id}`, { method: "DELETE" }),
};

// Messages
export const messagesApi = {
  recent: (limit = 20) => request(`/api/messages/recent?limit=${limit}`),
  threads: (channel, limit = 50) =>
    request(`/api/messages/threads?channel=${encodeURIComponent(channel)}&limit=${limit}`),
};

// Activity
export const activityApi = {
  list: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.entityId) params.set("entityId", String(filters.entityId));
    if (filters.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request(`/api/activity${qs ? `?${qs}` : ""}`);
  },
};

// Organizations
export const organizationsApi = {
  list: () => request("/api/organizations"),
  create: (data) => request("/api/organizations", { method: "POST", body: JSON.stringify(data) }),
};

// Messaging (Twilio + SendGrid)
export const messagingApi = {
  sendSMS: (leadId, message, aiGenerated = false) =>
    request(`/api/leads/${leadId}/sms`, { method: "POST", body: JSON.stringify({ message, aiGenerated }) }),
  sendEmail: (leadId, subject, body, aiGenerated = false) =>
    request(`/api/leads/${leadId}/email`, { method: "POST", body: JSON.stringify({ subject, body, aiGenerated }) }),
  initiateCall: (leadId) =>
    request(`/api/leads/${leadId}/call`, { method: "POST", body: JSON.stringify({}) }),
  integrationStatus: () => request("/api/integrations/status"),
};

// AI (Claude)
export const aiApi = {
  scoreLead: (leadId, notes) =>
    request(`/api/leads/${leadId}/score`, { method: "POST", body: JSON.stringify({ notes }) }),
  generateMessage: (leadId, channel, context) =>
    request(`/api/leads/${leadId}/generate-message`, { method: "POST", body: JSON.stringify({ channel, context }) }),
  handleObjection: (objection, leadContext) =>
    request("/api/ai/objection", { method: "POST", body: JSON.stringify({ objection, leadContext }) }),
  scoreAll: () =>
    request("/api/leads/score-all", { method: "POST", body: JSON.stringify({}) }),
  status: () => request("/api/ai/status"),
};

// Sandbox (demo conversations)
export const sandboxApi = {
  scenarios: () => request("/api/sandbox/scenarios"),
  createSession: (scenarioId, lead) =>
    request("/api/sandbox/sessions", { method: "POST", body: JSON.stringify({ scenarioId, lead }) }),
  getSession: (id) => request(`/api/sandbox/sessions/${id}`),
  listSessions: () => request("/api/sandbox/sessions"),
  sendOutbound: (id) =>
    request(`/api/sandbox/sessions/${id}/outbound`, { method: "POST", body: JSON.stringify({}) }),
  sendReply: (id, text) =>
    request(`/api/sandbox/sessions/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  runDemo: (scenarioId) =>
    request(`/api/sandbox/demo/${scenarioId}`, { method: "POST", body: JSON.stringify({}) }),
  getConversation: (id) => request(`/api/sandbox/sessions/${id}/conversation`),
};

// Settings (org-scoped feature toggles & preferences)
export const settingsApi = {
  get: () => request("/api/settings"),
  put: (settings) => request("/api/settings", { method: "PUT", body: JSON.stringify({ settings }) }),
  patch: (partial) => request("/api/settings", { method: "PATCH", body: JSON.stringify(partial) }),
};

// Calendar OAuth (Google / Outlook — Module 10)
export const calendarApi = {
  status: () => request("/api/calendar/status"),
  startOAuth: (provider) =>
    request(`/api/calendar/oauth/${provider}/start`, { method: "POST", body: JSON.stringify({}) }),
  setActive: (provider) =>
    request("/api/calendar/active", { method: "POST", body: JSON.stringify({ provider }) }),
  disconnect: (provider) => request(`/api/calendar/connect/${provider}`, { method: "DELETE" }),
  listCalendars: (provider) =>
    request(`/api/calendar/calendars${provider ? `?provider=${provider}` : ""}`),
  selectCalendar: (provider, calendarId) =>
    request("/api/calendar/calendars", {
      method: "PATCH",
      body: JSON.stringify({ provider, calendarId }),
    }),
  checkAvailability: (body = {}) =>
    request("/api/calendar/availability", { method: "POST", body: JSON.stringify(body) }),
};

// Gmail BYOT — send SDR follow-ups from the customer's Gmail (n8n-style OAuth)
export const gmailApi = {
  status: () => request("/api/gmail/status"),
  startOAuth: () => request("/api/gmail/oauth/start", { method: "POST", body: "{}" }),
  disconnect: () => request("/api/gmail/connect", { method: "DELETE" }),
  testEmail: (to) =>
    request("/api/gmail/test-email", { method: "POST", body: JSON.stringify({ to }) }),
};

// Health
export const health = {
  check: () => request("/api/health"),
};

// SDR Agent
export const sdrApi = {
  getConfig: () => request("/api/sdr/config"),
  saveConfig: (data) => request("/api/sdr/config", { method: "PUT", body: JSON.stringify(data) }),
  saveVoice: (assistantVoiceId) => request("/api/sdr/config/voice", { method: "PATCH", body: JSON.stringify({ assistantVoiceId }) }),
  setStatus: (isActive) => request("/api/sdr/config/status", { method: "PATCH", body: JSON.stringify({ isActive }) }),
  getEnrollments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/sdr/enrollments${qs ? `?${qs}` : ""}`);
  },
  getEnrollment: (id) => request(`/api/sdr/enrollments/${id}`),
  getLeadLogs: (leadId) => request(`/api/sdr/leads/${leadId}/logs`),
  getAnalytics: () => request("/api/sdr/analytics"),
  enrollLead: (leadId) => request(`/api/sdr/enroll/${leadId}`, { method: "POST", body: JSON.stringify({}) }),
};

// AI Calling
export const callApi = {
  getSessions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/call/sessions${qs ? `?${qs}` : ""}`);
  },
  getSession: (id) => request(`/api/call/sessions/${id}`),
  getVoices: () => request("/api/call/voices"),
  getAnalytics: () => request("/api/call/analytics"),
};

// Billing
export const billingApi = {
  getStatus: () => request("/api/billing"),
  getPlans: () => request("/api/billing/plans"),
  checkout: (plan, successUrl, cancelUrl) =>
    request("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, successUrl, cancelUrl }),
    }),
  portal: (returnUrl) =>
    request("/api/billing/portal", {
      method: "POST",
      body: JSON.stringify({ returnUrl }),
    }),
  cancelRenewal: () =>
    request("/api/billing/cancel-renewal", { method: "POST", body: "{}" }),
  resumeRenewal: () =>
    request("/api/billing/resume-renewal", { method: "POST", body: "{}" }),
};

// Team / seats
export const teamApi = {
  getSeats: () => request("/api/workspace/seats"),
  getMembers: () => request("/api/workspace/members"),
  invite: (payload) =>
    request("/api/workspace/invite", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// Operator admin panel
export const adminApi = {
  getWorkspaces: () => request("/api/admin/workspaces"),
  getWorkspace: (id) => request(`/api/admin/workspaces/${id}`),
  getWorkspaceEnrollments: (id, params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return request(`/api/admin/workspaces/${id}/enrollments${q ? `?${q}` : ""}`);
  },
  setWorkspaceStatus: (id, isActive) =>
    request(`/api/admin/workspaces/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    }),
  setWorkspaceTier: (id, tier) =>
    request(`/api/admin/workspaces/${id}/tier`, {
      method: "PATCH",
      body: JSON.stringify({ tier }),
    }),
  resetUsage: (id) => request(`/api/admin/workspaces/${id}/reset-usage`, { method: "POST" }),
  getStuck: () => request("/api/admin/enrollments/stuck"),
  recoverEnrollment: (id) =>
    request(`/api/admin/enrollments/${id}/recover`, { method: "POST" }),
  getAnalytics: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    const q = qs.toString();
    return request(`/api/admin/analytics${q ? `?${q}` : ""}`);
  },
  getUsageAlerts: () => request("/api/admin/usage-alerts"),
  getOrganizations: () => request("/api/admin/organizations"),
  getUsers: () => request("/api/admin/users"),
  setUserRole: (id, role) =>
    request(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  getCalls: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.workspaceId) qs.set("workspaceId", params.workspaceId);
    return request(`/api/admin/calls?${qs}`);
  },
  getCall: (id) => request(`/api/admin/calls/${id}`),
  getTwilioStatus: (id) => request(`/api/admin/workspaces/${id}/twilio-status`),
  provisionTwilio: (id) =>
    request(`/api/admin/workspaces/${id}/provision-twilio`, { method: "POST", body: "{}" }),
  searchNumbers: (id, areaCode = "", limit = 10) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (areaCode) qs.set("areaCode", areaCode);
    return request(`/api/admin/workspaces/${id}/available-numbers?${qs}`);
  },
  assignNumber: (id, phoneNumber) =>
    request(`/api/admin/workspaces/${id}/assign-number`, {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    }),
  releaseTwilio: (id, permanent = false) =>
    request(`/api/admin/workspaces/${id}/provision-twilio?permanent=${permanent ? "true" : "false"}`, {
      method: "DELETE",
    }),
};
