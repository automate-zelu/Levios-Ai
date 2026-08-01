import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import _ from "lodash";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { auth, setToken, clearToken, isAuthenticated, dashboard, leadsApi, appointmentsApi, campaignsApi, proposalsApi, activityApi, messagesApi, messagingApi, aiApi, sandboxApi, settingsApi, sdrApi, callApi, calendarApi } from "./api.js";
import { INTEGRATION_CATEGORIES, integrationsService, MOCK_BILLING } from "./services.js";
import SDRConfigPage from "./pages/SDRConfigPage.jsx";
import CallingPanelPage from "./pages/CallingPanelPage.jsx";
import SDRSetupPage from "./pages/SDRSetupPage.jsx";
import MessageInboxPage from "./pages/MessageInboxPage.jsx";
import BillingPageLive from "./pages/BillingPage.jsx";
import SDROnboarding from "./pages/SDROnboarding.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import LeadDetailPage from "./pages/LeadDetailPage.jsx";
import { shouldShowOnboarding, clearOnboardingStorage, ONBOARDING_FLAG_KEY } from "./lib/onboarding.js";
import { providerFromIntegrationId } from "./lib/calendar-providers.js";

// ============================================================
// CATALYST — Agentic AI Sales & Lead Revival Platform
// Products: riivīv (dead lead revival) | alīv (new lead engine)
// v2.0 — With 5 Approved Strategic Features
// ============================================================

const COLORS = {
  bg: "#0a0a0a", surface: "#141414", surfaceAlt: "#1a1a1a",
  border: "#2a2a2a", borderLight: "#333",
  text: "#e8e8e8", textMuted: "#888", textDim: "#555",
  orange: "#e67e22", orangeLight: "#f39c12", orangeDark: "#d35400",
  orangeGlow: "rgba(230,126,34,0.15)",
  green: "#27ae60", greenLight: "#2ecc71", red: "#e74c3c",
  blue: "#3498db", purple: "#9b59b6", yellow: "#f1c40f",
  teal: "#1abc9c",
};

const TIERS = {
  riiviv: { setup: [2500, 3500, 5000], tierNames: ["Starter", "Growth", "Enterprise"], perAppt: 400, maintenance: [500, 750, 1000] },
  aliv: { setup: [2500, 3500, 5000], tierNames: ["Starter", "Growth", "Enterprise"], perAppt: 500, maintenance: [500, 750, 1000] },
};

const CRM_INTEGRATIONS = [
  { name: "Salesforce", icon: "☁️", connected: false }, { name: "HubSpot", icon: "🟠", connected: false },
  { name: "Zoho CRM", icon: "📋", connected: false }, { name: "GoHighLevel", icon: "⚡", connected: false },
  { name: "Pipedrive", icon: "🔵", connected: false }, { name: "Close.com", icon: "📞", connected: false },
  { name: "Freshsales", icon: "🟢", connected: false }, { name: "Monday CRM", icon: "🟣", connected: false },
  { name: "Copper", icon: "🔶", connected: false }, { name: "Insightly", icon: "💡", connected: false },
];

const CALENDAR_INTEGRATIONS = [
  { name: "Google Calendar", icon: "📅", connected: false }, { name: "Calendly", icon: "🗓️", connected: false },
  { name: "Microsoft Outlook", icon: "📧", connected: false }, { name: "Cal.com", icon: "⏰", connected: false },
  { name: "Acuity Scheduling", icon: "📆", connected: false }, { name: "ScheduleOnce", icon: "🕐", connected: false },
];

const VOICE_OPTIONS = [
  { id: "v1", name: "Alex", gender: "Male", tone: "Warm & Professional", accent: "American" },
  { id: "v2", name: "Sarah", gender: "Female", tone: "Friendly & Confident", accent: "American" },
  { id: "v3", name: "James", gender: "Male", tone: "Authoritative & Calm", accent: "British" },
  { id: "v4", name: "Maya", gender: "Female", tone: "Energetic & Persuasive", accent: "American" },
  { id: "v5", name: "Custom", gender: "—", tone: "Upload Voice Sample", accent: "Custom" },
];

const INDUSTRIES = [
  "Solar / Renewable Energy", "HVAC", "Roofing", "Windows & Doors", "Home Security",
  "Insurance", "Real Estate", "Financial Services", "Automotive", "Medical / Dental",
  "Legal Services", "Home Improvement", "Pest Control", "Landscaping", "Pool / Spa",
  "Plumbing", "Electrical", "Painting", "Flooring", "Kitchen & Bath",
];

const SAMPLE_LEADS = [
  { id: 1, name: "Marcus Johnson", phone: "(555) 234-5678", email: "mjohnson@email.com", source: "Web Form", status: "Aged", lastContact: "2025-08-14", industry: "Solar", score: 72, baseScore: 85, decayRate: -1.6, marketBoost: 0, notes: "Showed interest in 8kW system, stalled at financing", conversations: [
    { id: "c1", type: "sms", date: "2025-08-14", direction: "outbound", agent: "Maya", duration: null, transcript: [
      { role: "agent", text: "Hi Marcus, this is Maya from SunPower Solar. I wanted to follow up on the 8kW system you were looking at — utility rates in your area just went up 12% and there are some great new incentives. Would you like to hear about them?" },
      { role: "lead", text: "Maybe later, not a great time right now" },
      { role: "agent", text: "No problem at all! I'll check back in a few weeks. In the meantime, if you'd like to chat sooner, just text back anytime. Have a great day, Marcus!" },
    ], outcome: "deferred", sentiment: "neutral" },
  ]},
  { id: 2, name: "Patricia Williams", phone: "(555) 345-6789", email: "pwilliams@email.com", source: "Referral", status: "Dead", lastContact: "2025-06-22", industry: "Solar", score: 45, baseScore: 72, decayRate: -3.0, marketBoost: 0, notes: "Husband objected to cost, may reconsider", conversations: [] },
  { id: 3, name: "David Chen", phone: "(555) 456-7890", email: "dchen@email.com", source: "Facebook Ad", status: "Aged", lastContact: "2025-09-01", industry: "Solar", score: 68, baseScore: 78, decayRate: -1.4, marketBoost: 5, notes: "Requested quote, never responded to follow-up", conversations: [
    { id: "c2", type: "email", date: "2025-09-01", direction: "outbound", agent: "System", duration: null, transcript: [
      { role: "agent", text: "Subject: Your Solar Quote — Quick Update\n\nHi David,\n\nI wanted to circle back on the quote we put together for you. Since then, there have been some changes to the federal tax credit that could save you an additional $2,400. Would it be worth a quick 10-minute call to go over the updated numbers?\n\nBest,\nSunPower Solar Team" },
    ], outcome: "no_response", sentiment: "neutral" },
  ]},
  { id: 4, name: "Linda Martinez", phone: "(555) 567-8901", email: "lmartinez@email.com", source: "Google Ads", status: "Dead", lastContact: "2025-05-11", industry: "Solar", score: 33, baseScore: 65, decayRate: -3.2, marketBoost: 0, notes: "Said timing wasn't right, moving in 6 months", conversations: [] },
  { id: 5, name: "Robert Taylor", phone: "(555) 678-9012", email: "rtaylor@email.com", source: "Door Knock", status: "Revived", lastContact: "2026-03-10", industry: "Solar", score: 88, baseScore: 88, decayRate: 0, marketBoost: 0, notes: "Re-engaged via text, interested in battery storage", conversations: [
    { id: "c3", type: "sms", date: "2026-03-08", direction: "outbound", agent: "Sarah", duration: null, transcript: [
      { role: "agent", text: "Hi Robert! This is Sarah from SunPower Solar. We connected a while back about solar — just wanted to share that battery storage prices have dropped 22% since we last spoke. With the new utility rate hikes, many homeowners are locking in energy independence. Thought of you!" },
      { role: "lead", text: "Oh interesting! I've actually been thinking about this again. What are the new prices looking like?" },
      { role: "agent", text: "Great timing! A full solar + battery system is now running about $28,500 before the 30% federal tax credit — so effectively around $19,950. That's about $150/mo on financing, which is likely less than your current electric bill. Want me to set up a quick consultation?" },
      { role: "lead", text: "Yeah actually that sounds good. When do you have available?" },
      { role: "agent", text: "Awesome! How about this Thursday at 10am, or would Friday at 2pm work better for your schedule?" },
      { role: "lead", text: "Thursday at 10 works" },
      { role: "agent", text: "Perfect! You're all set for Thursday at 10am. I'll send a confirmation with all the details. Looking forward to it, Robert!" },
    ], outcome: "appointment_set", sentiment: "positive" },
    { id: "c4", type: "voice", date: "2026-03-10", direction: "outbound", agent: "Sarah", duration: "4:32", transcript: [
      { role: "agent", text: "Hi Robert, this is Sarah calling from SunPower Solar. I'm an AI assistant calling on behalf of the team — I just wanted to confirm your consultation scheduled for Thursday at 10am. Is that still looking good for you?" },
      { role: "lead", text: "Yeah, we're still good for Thursday." },
      { role: "agent", text: "Wonderful! Just so you know, our consultant Mike Torres will be handling your appointment. He specializes in solar plus battery systems and can walk you through all the financing options — including cash, loan, lease, and power purchase agreements. Is there anything specific you'd like Mike to prepare for?" },
      { role: "lead", text: "Actually yeah, can he bring info on the battery backup? We get power outages sometimes." },
      { role: "agent", text: "Absolutely, I'll make sure Mike has all the battery backup details ready, including how the system handles outages automatically. Is there anything else I can help with?" },
      { role: "lead", text: "No, that's it. Thanks!" },
      { role: "agent", text: "Great, you're all set! Have a wonderful rest of your day, Robert." },
    ], outcome: "confirmed", sentiment: "positive" },
  ]},
  { id: 6, name: "Jennifer Adams", phone: "(555) 789-0123", email: "jadams@email.com", source: "Zillow", status: "New", lastContact: "2026-03-15", industry: "Solar", score: 91, baseScore: 91, decayRate: 0, marketBoost: 0, notes: "Inbound lead, high intent, requested callback", conversations: [] },
  { id: 7, name: "Michael Brown", phone: "(555) 890-1234", email: "mbrown@email.com", source: "CRM Import", status: "Aged", lastContact: "2025-07-19", industry: "Solar", score: 55, baseScore: 74, decayRate: -2.1, marketBoost: 3, notes: "Interested but concerned about roof age", conversations: [] },
  { id: 8, name: "Sandra Wilson", phone: "(555) 901-2345", email: "swilson@email.com", source: "Instagram", status: "Appointment Set", lastContact: "2026-03-14", industry: "Solar", score: 95, baseScore: 95, decayRate: 0, marketBoost: 0, notes: "Appointment 3/18 at 2pm, very motivated", conversations: [
    { id: "c5", type: "voice", date: "2026-03-13", direction: "outbound", agent: "Alex", duration: "6:18", transcript: [
      { role: "agent", text: "Hi Sandra, this is Alex calling from SunPower Solar. I'm an AI assistant reaching out because you expressed interest in going solar. I'd love to help you take the next step. Do you have a few minutes?" },
      { role: "lead", text: "Sure, I've been wanting to do this for a while. My electric bill is insane." },
      { role: "agent", text: "I hear that a lot, and honestly, that's one of the best reasons to look into solar. With utility rates climbing, locking in your energy costs can save a significant amount over time. Can I ask — what's your average monthly electric bill right now?" },
      { role: "lead", text: "It's been around $320 lately. Summer it goes up to like $400." },
      { role: "agent", text: "Wow, yeah, that's definitely on the higher side. The good news is, with a properly sized system, most homeowners in your area can eliminate 90-95% of that bill. Plus there's a 30% federal tax credit right now. Would you like to set up a free consultation where one of our experts can design a custom system for your home?" },
      { role: "lead", text: "Yes! When can we do it?" },
      { role: "agent", text: "Great! I have Monday the 18th at 2pm or Wednesday the 20th at 11am — which works better for you?" },
      { role: "lead", text: "Monday at 2 is perfect." },
      { role: "agent", text: "You're all set for Monday, March 18th at 2pm. Our consultant Sarah Kim will come to your home — she'll review your roof, your energy usage, and walk you through all the options including financing. I'll send you a confirmation text and email right now. Is there anything else I can help with?" },
      { role: "lead", text: "No, that's great. Thank you!" },
      { role: "agent", text: "My pleasure, Sandra! You're going to love what solar can do for your home. Have a wonderful day!" },
    ], outcome: "appointment_set", sentiment: "very_positive" },
  ]},
];

const SAMPLE_PROPOSALS = [
  { id: "P001", customer: "Robert Taylor", system: "8.4kW Solar + Battery", cashPrice: 28500, loanPayment: 185, leasePayment: 125, ppaRate: 0.089, status: "Sent", created: "2026-03-12" },
  { id: "P002", customer: "Sandra Wilson", system: "10.2kW Solar", cashPrice: 32000, loanPayment: 210, leasePayment: 155, ppaRate: 0.095, status: "Viewed", created: "2026-03-14" },
];

// FEATURE 1: Show-up guarantee appointment data
const SAMPLE_APPOINTMENTS = [
  { id: 1, lead: "Sandra Wilson", date: "2026-03-18", time: "2:00 PM", type: "In-Home Consultation", rep: "Sarah Kim", status: "Confirmed", product: "Solar 10.2kW", showed: null, creditApplied: false },
  { id: 2, lead: "Robert Taylor", date: "2026-03-19", time: "10:00 AM", type: "Virtual Consultation", rep: "Mike Torres", status: "Confirmed", product: "Solar + Battery", showed: null, creditApplied: false },
  { id: 3, lead: "David Chen", date: "2026-03-20", time: "3:30 PM", type: "Phone Consultation", rep: "Mike Torres", status: "Pending", product: "Solar 6kW", showed: null, creditApplied: false },
  { id: 4, lead: "Jennifer Adams", date: "2026-03-21", time: "11:00 AM", type: "In-Home Consultation", rep: "Sarah Kim", status: "Confirmed", product: "Solar 12kW", showed: null, creditApplied: false },
  { id: 5, lead: "Marcus Johnson", date: "2026-03-14", time: "1:00 PM", type: "Virtual Consultation", rep: "Mike Torres", status: "Completed", product: "Solar 8kW", showed: false, creditApplied: true },
  { id: 6, lead: "Prev Client A", date: "2026-03-10", time: "9:00 AM", type: "In-Home", rep: "Sarah Kim", status: "Completed", product: "Solar 7kW", showed: true, creditApplied: false },
  { id: 7, lead: "Prev Client B", date: "2026-03-11", time: "3:00 PM", type: "Virtual", rep: "Mike Torres", status: "Completed", product: "HVAC", showed: true, creditApplied: false },
];

// FEATURE 5: Performance thresholds for tier suggestions
const TIER_THRESHOLDS = {
  suggestAliv: 50,   // riivīv appts to suggest alīv
  suggestSales: 25,  // alīv appts to suggest sales tool
  suggestEnterprise: 100, // total appts to suggest enterprise tier
};

// ============================================================
// STYLES
// ============================================================
const S = {
  app: { display: "flex", height: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans', 'Outfit', system-ui, sans-serif", overflow: "hidden" },
  /* width controlled by .catalyst-sidebar CSS so collapse animates smoothly */
  sidebar: { background: COLORS.surface, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" },
  sidebarNav: { flex: 1, overflowY: "auto", padding: "8px 0" },
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", cursor: "pointer", fontSize: 13.5,
    background: active ? COLORS.orangeGlow : "transparent",
    color: active ? COLORS.orangeLight : COLORS.textMuted,
    borderLeft: active ? `3px solid ${COLORS.orange}` : "3px solid transparent",
    transition: "all 0.2s", fontWeight: active ? 600 : 400,
  }),
  navSection: { padding: "16px 20px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: COLORS.textDim },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0 },
  content: { flex: 1, overflowY: "auto", padding: 28 },
  card: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, marginBottom: 20 },
  cardHeader: { fontSize: 15, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" },
  statCard: (color) => ({
    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "20px 24px",
    borderTop: `3px solid ${color}`, flex: 1, minWidth: 180,
  }),
  badge: (color) => ({
    display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    background: `${color}22`, color: color, border: `1px solid ${color}44`,
  }),
  btn: (v = "primary") => ({
    padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
    fontFamily: "inherit", transition: "all 0.2s",
    ...(v === "primary" ? { background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`, color: "#fff" } : {}),
    ...(v === "secondary" ? { background: COLORS.surfaceAlt, color: COLORS.text, border: `1px solid ${COLORS.border}` } : {}),
    ...(v === "ghost" ? { background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}` } : {}),
    ...(v === "success" ? { background: COLORS.green, color: "#fff" } : {}),
    ...(v === "danger" ? { background: COLORS.red, color: "#fff" } : {}),
    ...(v === "teal" ? { background: COLORS.teal, color: "#fff" } : {}),
  }),
  input: { width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  select: { padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}22` },
  tag: (color) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, background: `${color}22`, color }),
  tab: (active) => ({
    padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? COLORS.orangeGlow : "transparent",
    color: active ? COLORS.orangeLight : COLORS.textMuted,
    border: active ? `1px solid ${COLORS.orange}44` : "1px solid transparent", transition: "all 0.2s",
  }),
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" },
  modalContent: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 32, maxWidth: 560, width: "90%", maxHeight: "85vh", overflowY: "auto" },
};

// ============================================================
// SHARED COMPONENTS
// ============================================================
function Logo({ size = "default" }) {
  const s = size === "small" ? 0.6 : 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 * s }}>
      <svg width={32 * s} height={32 * s} viewBox="0 0 100 100">
        <defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f39c12" /><stop offset="100%" stopColor="#d35400" /></linearGradient></defs>
        <polygon points="50,5 61,35 95,35 68,55 78,88 50,68 22,88 32,55 5,35 39,35" fill="url(#sg)" />
        <polygon points="50,22 56,38 73,38 60,48 64,65 50,55 36,65 40,48 27,38 44,38" fill="#f39c12" opacity="0.6" />
      </svg>
      <span className="logo-wordmark" style={{ fontSize: 24 * s, fontWeight: 700, background: "linear-gradient(135deg, #f39c12, #e67e22, #d35400)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: -0.5 }}>catalyst</span>
    </div>
  );
}

function StatCard({ label, value, change, color = COLORS.orange, icon, suffix = "", onClick }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      style={{
        ...S.statCard(color),
        cursor: clickable ? "pointer" : "default",
        transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
      }}
      onClick={onClick}
      onMouseEnter={(e) => { if (clickable) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`; } }}
      onMouseLeave={(e) => { if (clickable) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; } }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.text }}>{value}{suffix && <span style={{ fontSize: 14, fontWeight: 400, color: COLORS.textMuted }}>{suffix}</span>}</div>
      {change !== undefined && (
        <div style={{ fontSize: 12, color: change >= 0 ? COLORS.green : COLORS.red, marginTop: 4, fontWeight: 500 }}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs last month
        </div>
      )}
      {clickable && (
        <div style={{ fontSize: 10, color: color, marginTop: 6, fontWeight: 600, opacity: 0.7 }}>View details →</div>
      )}
    </div>
  );
}

// Drill-down slide-out panel showing leads/deals for a given stat
function DrillDownPanel({ title, description, onClose, filter, emptyText = "No leads match this filter." }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    leadsApi.list(filter || {})
      .then((data) => { setLeads(Array.isArray(data) ? data : (data?.leads || [])); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filter)]);

  const statusColors = {
    new: COLORS.blue, qualified: COLORS.green, contacted: COLORS.yellow,
    lost: COLORS.red, "appointment set": COLORS.teal, won: COLORS.green,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 100%)", height: "100%", background: COLORS.surface,
          borderLeft: `1px solid ${COLORS.border}`, boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", animation: "slideInRight 0.25s ease-out",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h3>
            {description && <p style={{ fontSize: 12, color: COLORS.textMuted, margin: "4px 0 0" }}>{description}</p>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {loading && <LoadingState message="Loading..." />}
          {error && <ErrorState message={error} />}
          {!loading && !error && leads.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>
              <div style={{ fontSize: 38, marginBottom: 12 }}>📭</div>
              <div>{emptyText}</div>
            </div>
          )}
          {!loading && !error && leads.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {leads.map((l) => (
                <div key={l.id} style={{ padding: 14, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceAlt }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.name || l.fullName || "Unnamed lead"}</div>
                      <div style={{ fontSize: 12, color: COLORS.textMuted }}>{l.email || "—"} · {l.phone || "—"}</div>
                    </div>
                    <span style={S.badge(statusColors[(l.status || "").toLowerCase()] || COLORS.textMuted)}>{l.status || "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: COLORS.textMuted, marginTop: 8 }}>
                    {l.source && <span>📍 {l.source}</span>}
                    {l.score != null && <span>🎯 Score: {l.score}</span>}
                    {l.estimatedValue != null && <span>💰 ${Number(l.estimatedValue).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ value, max = 100, color = COLORS.orange, height = 6, showLabel = false }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height, borderRadius: height / 2, background: COLORS.surfaceAlt, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: height / 2, transition: "width 0.6s ease" }} />
      </div>
      {showLabel && <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 38, textAlign: "right" }}>{Math.round(pct)}%</span>}
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {tabs.map((t) => <div key={t} style={S.tab(active === t)} onClick={() => onChange(t)}>{t}</div>)}
    </div>
  );
}

// Label → setting-key map: persists toggle state to org_settings without
// needing to pass settingKey on every call site. If the label isn't in the
// map (or you want an explicit key), pass `settingKey` directly.
const TOGGLE_LABEL_TO_KEY = {
  // Lead notifications
  "New lead created": "notify.lead.created",
  "Lead score changed": "notify.lead.scoreChanged",
  "Lead replied to outreach": "notify.lead.replied",
  "Lead score decay warning": "notify.lead.decayWarning",
  // Appointment notifications
  "Appointment booked": "notify.appt.booked",
  "Appointment confirmed": "notify.appt.confirmed",
  "No-show detected": "notify.appt.noShow",
  // Campaign notifications
  "Campaign completed": "notify.campaign.completed",
  "Daily campaign performance digest": "notify.campaign.dailyDigest",
  "Weekly summary email": "notify.campaign.weeklySummary",
  // Delivery
  "In-app notifications": "notify.channel.inApp",
  "Email notifications": "notify.channel.email",
  "SMS notifications": "notify.channel.sms",
  // AI learning
  "Continuous learning from call outcomes": "ai.learning.continuous",
  "Auto-improve talk tracks": "ai.learning.autoImprove",
  "Industry-specific sales psychology": "ai.learning.industryPsychology",
  "Auto-suggest upsell opportunities": "ai.learning.autoUpsell",
  // Lead scoring
  "Automatic lead score decay over time": "ai.scoring.autoDecay",
  "Market condition score boosting (utility rates, incentives)": "ai.scoring.marketBoost",
  "Auto-score new leads on creation": "ai.scoring.autoScore",
  // Outreach
  "AI generates follow-up messages automatically": "ai.outreach.autoFollowUp",
  "Respect quiet hours (8am–9pm local time)": "ai.outreach.quietHours",
  "TCPA compliance enforcement": "ai.outreach.tcpa",
  "DNC list checking before outreach": "ai.outreach.dncCheck",
  // Security
  "Encrypt lead data at rest": "security.encryptAtRest",
  "Audit logging enabled": "security.auditLogging",
  "Auto-redact PII from AI logs": "security.piiRedact",
  // Voice AI
  "Low-latency mode (< 500ms)": "voice.lowLatency",
  "Handle interruptions gracefully": "voice.gracefulInterrupts",
  "Detect firm 'No' responses": "voice.detectFirmNo",
  "AI disclosure at call start (TCPA)": "voice.aiDisclosure",
  // Compliance tab
  "Prior Express Written Consent (PEWC)": "compliance.pewc",
  "One-to-One consent (FCC Jan 2026)": "compliance.oneToOne",
  "AI voice disclosure at call start": "compliance.aiDisclosure",
  "National + State DNC scrubbing": "compliance.dncScrubbing",
  "Instant opt-out on STOP/No": "compliance.instantOptOut",
  "Intent-to-opt-out AI detection": "compliance.intentDetection",
  "A2P 10DLC for SMS": "compliance.a2p10dlc",
  "Full audit trail logging": "compliance.auditTrail",
  // Campaign page compliance strip
  "TCPA consent verification": "compliance.pewc",
  "DNC scrubbing": "compliance.dncScrubbing",
  "AI disclosure at call start": "compliance.aiDisclosure",
  "Quiet hours (8am-9pm local)": "compliance.quietHours",
  // Appointments
  "Auto-send confirmation text + email": "appt.autoConfirm",
  "24-hour reminder": "appt.reminder24h",
  "Same-day morning reminder": "appt.sameDayReminder",
  "Post-appointment show-up tracking": "appt.showUpTracking",
};

// Context holds the full settings blob + a setter that patches one key and
// optimistically updates local state. Loads once after login.
const SettingsContext = createContext({
  settings: {},
  loaded: false,
  setSetting: () => {},
});

function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsApi.get()
      .then((res) => { if (!cancelled) { setSettings(res?.settings || {}); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); }); // fail open — use defaults
    return () => { cancelled = true; };
  }, []);

  const setSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value })); // optimistic
    settingsApi.patch({ [key]: value }).catch((err) => {
      console.error("Failed to persist setting", key, err.message);
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loaded, setSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

function useSetting(key, defaultValue = false) {
  const ctx = useContext(SettingsContext);
  const value = key && key in ctx.settings ? ctx.settings[key] : defaultValue;
  const setValue = useCallback((v) => key && ctx.setSetting(key, v), [key, ctx]);
  return [value, setValue];
}

function Toggle({ value, onChange, label, settingKey }) {
  // Resolve effective key: explicit prop wins, else look up by label.
  const resolvedKey = settingKey || (typeof label === "string" ? TOGGLE_LABEL_TO_KEY[label] : null);
  const [stored, setStored] = useSetting(resolvedKey, value);
  const effectiveValue = resolvedKey ? stored : value;
  const handle = (next) => {
    if (resolvedKey) setStored(next);
    if (onChange) onChange(next);
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
      <div onClick={() => handle(!effectiveValue)} style={{ width: 40, height: 22, borderRadius: 11, background: effectiveValue ? COLORS.orange : COLORS.border, position: "relative", transition: "all 0.2s", cursor: "pointer", flexShrink: 0 }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 2, left: effectiveValue ? 20 : 2, transition: "all 0.2s" }} />
      </div>
      <span style={{ color: COLORS.textMuted }}>{label}</span>
    </label>
  );
}

function LoadingState({ message = "Loading..." }) {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <div style={{ fontSize: 14, color: COLORS.textMuted }}>{message}</div>
    </div>
  );
}

function EmptyState({ icon = "📭", title, description, action, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{description}</div>
      {action && <button style={S.btn("primary")} onClick={onAction}>{action}</button>}
    </div>
  );
}

function ErrorState({ message = "Something went wrong", onRetry }) {
  return (
    <div className="error-state">
      <div className="error-state-icon">⚠️</div>
      <div className="error-state-msg">{message}</div>
      {onRetry && <button style={S.btn("secondary")} onClick={onRetry}>Try Again</button>}
    </div>
  );
}

// Web Speech API voice preview — lets users hear a sample of each voice agent
function VoicePreviewButton({ voiceName, voiceGender, accent, sample, fullWidth = false }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState([]);

  // Chrome populates voices asynchronously — listen for voiceschanged + poll
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSupported(false);
      return;
    }
    const load = () => {
      const vs = window.speechSynthesis.getVoices();
      if (vs && vs.length) setVoices(vs);
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    const t = setInterval(() => {
      const vs = window.speechSynthesis.getVoices();
      if (vs && vs.length) { setVoices(vs); clearInterval(t); }
    }, 250);
    return () => {
      clearInterval(t);
      window.speechSynthesis.removeEventListener?.("voiceschanged", load);
    };
  }, []);

  const pickVoice = () => {
    if (!voices.length) return null;
    const wantFemale = voiceGender === "Female";
    const wantBritish = accent === "British";
    const scored = voices.map((v) => {
      let score = 0;
      const name = (v.name || "").toLowerCase();
      if (wantBritish && v.lang?.startsWith("en-GB")) score += 4;
      if (!wantBritish && v.lang?.startsWith("en-US")) score += 3;
      if (v.lang?.startsWith("en")) score += 1;
      if (wantFemale && /(samantha|victoria|karen|serena|tessa|fiona|zira|susan|female)/.test(name)) score += 3;
      if (!wantFemale && /(alex|daniel|fred|oliver|david|mark|tom|male)/.test(name)) score += 3;
      return { v, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.v || voices[0];
  };

  const speak = (e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    const synth = window.speechSynthesis;
    if (!synth) return;

    if (speaking || synth.speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }

    const text = sample || `Hi, this is ${voiceName} from Leviosai. I'm an AI assistant, and I'm here to help revive and qualify your leads. Thanks for taking a listen — I hope my tone is a match for what you're looking for.`;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) { utter.voice = voice; utter.lang = voice.lang || "en-US"; }
    else { utter.lang = accent === "British" ? "en-GB" : "en-US"; }
    utter.rate = 1.0;
    utter.pitch = voiceGender === "Female" ? 1.05 : 0.95;
    utter.volume = 1.0;
    utter.onend = () => setSpeaking(false);
    utter.onerror = (ev) => { console.warn("Voice preview error:", ev.error); setSpeaking(false); };

    // Chrome bug workaround: resume in case synth was suspended by a previous tab switch
    if (synth.paused) synth.resume();
    setSpeaking(true);
    // Small delay lets Chrome register the user gesture before speak()
    setTimeout(() => synth.speak(utter), 50);
  };

  if (!supported) return null;

  return (
    <button
      onClick={speak}
      style={{
        ...S.btn(speaking ? "danger" : "secondary"),
        width: fullWidth ? "100%" : "auto",
        fontSize: 11,
        padding: "6px 12px",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      <span>{speaking ? "⏹" : "▶"}</span>
      <span>{speaking ? "Stop" : "Hear sample"}</span>
    </button>
  );
}

function ComplianceBadge() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 6, background: `${COLORS.green}15`, border: `1px solid ${COLORS.green}33` }}>
      <span style={{ color: COLORS.green, fontSize: 12 }}>🛡️</span>
      <span style={{ fontSize: 11, color: COLORS.green, fontWeight: 600 }}>TCPA Compliant</span>
    </div>
  );
}

// FEATURE 5: Performance-based tier suggestion banner
function TierSuggestionBanner({ totalAppts, hasAliv, hasSalesTool, onAction }) {
  let suggestion = null;
  if (!hasAliv && totalAppts >= TIER_THRESHOLDS.suggestAliv) {
    suggestion = { icon: "🚀", color: COLORS.blue, title: "Unlock alīv — New Lead Engine", desc: `You've set ${totalAppts} appointments with riivīv! Based on your success rate, adding alīv could generate ${Math.round(totalAppts * 0.6)} additional appointments per month from new leads. Plus, you'll only pay one maintenance fee.`, action: "Explore alīv", type: "aliv" };
  } else if (hasAliv && !hasSalesTool && totalAppts >= TIER_THRESHOLDS.suggestSales) {
    suggestion = { icon: "📝", color: COLORS.purple, title: "Unlock Automated Sales & Proposals", desc: `With ${totalAppts} qualified appointments, you're leaving revenue on the table. Our AI proposal engine can auto-generate financing options and close deals — a feature no other platform offers. Clients using it see 38% higher close rates.`, action: "Unlock Sales Tool", type: "sales" };
  } else if (totalAppts >= TIER_THRESHOLDS.suggestEnterprise) {
    suggestion = { icon: "👑", color: COLORS.orangeLight, title: "You've Outgrown Your Current Tier", desc: `With ${totalAppts} appointments this month, upgrading to Enterprise would save you $${Math.round(totalAppts * 12)} annually with volume pricing and dedicated AI optimization. Let's talk.`, action: "Upgrade to Enterprise", type: "enterprise" };
  }
  if (!suggestion) return null;
  return (
    <div style={{ padding: 18, borderRadius: 12, background: `${suggestion.color}12`, border: `1px solid ${suggestion.color}33`, marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{ fontSize: 32 }}>{suggestion.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: suggestion.color, marginBottom: 4 }}>{suggestion.title}</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>{suggestion.desc}</div>
      </div>
      <button style={S.btn("primary")} onClick={() => onAction && onAction(suggestion.type)}>{suggestion.action}</button>
      <button style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
    </div>
  );
}

// FEATURE 2: Conversation Replay Component
function ConversationReplay({ conversations, leadName, onClose }) {
  const [selectedConvo, setSelectedConvo] = useState(conversations[0] || null);
  const sentimentColors = { very_positive: COLORS.green, positive: COLORS.greenLight, neutral: COLORS.yellow, negative: COLORS.red };
  const outcomeLabels = { appointment_set: "Appointment Set", confirmed: "Confirmed", deferred: "Deferred", no_response: "No Response", declined: "Declined" };
  const outcomeColors = { appointment_set: COLORS.green, confirmed: COLORS.green, deferred: COLORS.yellow, no_response: COLORS.textMuted, declined: COLORS.red };

  if (!conversations.length) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No Conversations Yet</div>
      <div style={{ fontSize: 13, color: COLORS.textMuted }}>AI conversations with {leadName} will appear here as they happen.</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
        {conversations.map((c) => (
          <div key={c.id} onClick={() => setSelectedConvo(c)} style={{
            padding: "10px 16px", borderRadius: 8, cursor: "pointer", flexShrink: 0,
            border: `1px solid ${selectedConvo?.id === c.id ? COLORS.orange : COLORS.border}`,
            background: selectedConvo?.id === c.id ? COLORS.orangeGlow : "transparent",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {c.type === "voice" ? "📞" : c.type === "sms" ? "💬" : "✉️"} {c.type.toUpperCase()}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>{c.date}</div>
            <div style={{ marginTop: 4 }}><span style={S.badge(outcomeColors[c.outcome] || COLORS.textMuted)}>{outcomeLabels[c.outcome] || c.outcome}</span></div>
          </div>
        ))}
      </div>
      {selectedConvo && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Agent: {selectedConvo.agent}</span>
              {selectedConvo.duration && <span style={S.tag(COLORS.textMuted)}>Duration: {selectedConvo.duration}</span>}
              <span style={S.tag(sentimentColors[selectedConvo.sentiment] || COLORS.textMuted)}>Sentiment: {selectedConvo.sentiment}</span>
            </div>
            <span style={S.badge(outcomeColors[selectedConvo.outcome])}>{outcomeLabels[selectedConvo.outcome]}</span>
          </div>
          <div style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 16, maxHeight: 360, overflowY: "auto" }}>
            {selectedConvo.transcript.map((msg, i) => (
              <div key={i} style={{
                display: "flex", flexDirection: msg.role === "agent" ? "row" : "row-reverse",
                marginBottom: 12,
              }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.6,
                  background: msg.role === "agent" ? `${COLORS.orange}20` : `${COLORS.blue}20`,
                  borderBottomLeft: msg.role === "agent" ? "2px" : "12px",
                  borderBottomRight: msg.role === "agent" ? "12px" : "2px",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: msg.role === "agent" ? COLORS.orange : COLORS.blue, marginBottom: 4, textTransform: "uppercase" }}>
                    {msg.role === "agent" ? `🤖 ${selectedConvo.agent} (AI)` : `👤 ${leadName}`}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: 12, background: COLORS.orangeGlow, borderRadius: 8, border: `1px solid ${COLORS.orange}33` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.orangeLight, marginBottom: 4 }}>🧠 AI Analysis</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
              {selectedConvo.outcome === "appointment_set"
                ? "Successful conversion. The agent used value-first positioning, addressed implicit concerns proactively, and offered exactly 2 appointment options per protocol. Talk track effectiveness: High."
                : selectedConvo.outcome === "confirmed"
                ? "Confirmation call executed well. Agent disclosed AI identity (TCPA compliant), confirmed details, and captured additional prep notes for the sales rep."
                : selectedConvo.outcome === "deferred"
                ? "Lead expressed timing concern. Recommend re-engagement in 2-3 weeks with updated market data. Tone was receptive — not a firm no. Score maintained."
                : "No engagement detected. Consider switching channel (voice → SMS) or adjusting time of outreach. Lead may respond better to evening contact."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// FEATURE 3: Lead Score Decay Visualization
function LeadScoreDecayPanel({ lead }) {
  const months = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const decayData = months.map((m, i) => {
    const decay = Math.max(0, lead.baseScore + (lead.decayRate * i));
    const boost = i >= 5 ? lead.marketBoost : 0;
    return { month: m, score: Math.min(100, Math.round(decay + boost)), boost };
  });

  return (
    <div style={{ padding: 16, background: COLORS.surfaceAlt, borderRadius: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>📉 Score Decay Model</div>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ color: COLORS.textMuted }}>Base: <strong style={{ color: COLORS.text }}>{lead.baseScore}</strong></span>
          <span style={{ color: COLORS.textMuted }}>Decay: <strong style={{ color: COLORS.red }}>{lead.decayRate}/mo</strong></span>
          {lead.marketBoost > 0 && <span style={{ color: COLORS.textMuted }}>Market Boost: <strong style={{ color: COLORS.green }}>+{lead.marketBoost}</strong></span>}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={decayData}>
          <defs>
            <linearGradient id="decayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.orange} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.orange} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" stroke={COLORS.textDim} fontSize={10} />
          <YAxis domain={[0, 100]} stroke={COLORS.textDim} fontSize={10} />
          <Area type="monotone" dataKey="score" stroke={COLORS.orange} fill="url(#decayGrad)" strokeWidth={2} />
          <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 11 }} />
        </AreaChart>
      </ResponsiveContainer>
      {lead.marketBoost > 0 && (
        <div style={{ fontSize: 11, color: COLORS.green, marginTop: 6 }}>
          ⚡ Market boost applied: Utility rates in this area increased 12% → Score boosted +{lead.marketBoost} pts
        </div>
      )}
      {lead.decayRate < -2.5 && (
        <div style={{ fontSize: 11, color: COLORS.red, marginTop: 6 }}>
          ⚠️ Rapid decay detected. Recommend immediate re-engagement before score drops below revival threshold.
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOGIN
// ============================================================
function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await auth.login(email, pass);
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: `radial-gradient(ellipse at 30% 20%, ${COLORS.orangeGlow}, transparent 60%), ${COLORS.bg}` }}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "48px 40px", width: "100%", maxWidth: 400, textAlign: "center" }}>
        <Logo />
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "12px 0 32px", lineHeight: 1.5 }}>Agentic AI Sales & Lead Revival Platform</p>
        {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 16 }}>{error}</div>}
        <div style={{ textAlign: "left", marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, display: "block", marginBottom: 6 }}>Email</label>
          <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="email" />
        </div>
        <div style={{ textAlign: "left", marginBottom: 24 }}>
          <label style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, display: "block", marginBottom: 6 }}>Password</label>
          <input style={S.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="current-password" />
        </div>
        <button style={{ ...S.btn("primary"), width: "100%", padding: "12px 20px", fontSize: 14, opacity: loading ? 0.7 : 1 }} onClick={handleLogin} disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <p style={{ color: COLORS.textDim, fontSize: 11, marginTop: 20 }}>
          Don&apos;t have an account?{" "}
          <span style={{ color: COLORS.orange, cursor: "pointer" }} onClick={() => navigate("/register")}>
            Create account
          </span>
        </p>
        <p style={{ color: COLORS.textDim, fontSize: 11, marginTop: 8 }}>Powered by <span style={{ color: COLORS.orange }}>Leviosai, Inc.</span> — Part of The Reaction Stack</p>
      </div>
    </div>
  );
}

// ============================================================
// REGISTER — single-user signup (creates user + organization + workspace)
// ============================================================
function RegisterPage({ onRegister }) {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validate = () => {
    if (!firstName.trim() || !lastName.trim()) return "First and last name are required";
    if (!email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address";
    if (!password) return "Password is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    return null;
  };

  const handleRegister = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = {
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
      if (organizationName.trim()) payload.organizationName = organizationName.trim();
      const res = await auth.register(payload);
      setToken(res.token);
      localStorage.setItem(ONBOARDING_FLAG_KEY, "1");
      onRegister(res.user);
      navigate("/");
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const field = (label, input, required = true) => (
    <div style={{ textAlign: "left", marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, display: "block", marginBottom: 6 }}>
        {label}{required && <span style={{ color: COLORS.orange }}> *</span>}
      </label>
      {input}
    </div>
  );

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: `radial-gradient(ellipse at 70% 20%, ${COLORS.orangeGlow}, transparent 60%), ${COLORS.bg}` }}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "40px 36px", width: "100%", maxWidth: 440, textAlign: "center" }}>
        <Logo />
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "16px 0 4px", color: COLORS.text }}>Create your account</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 24px", lineHeight: 1.5 }}>
          One account per organization — workspace is set up automatically
        </p>
        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 16, textAlign: "left" }}>
            {error}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {field("First name", (
            <input style={S.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
          ))}
          {field("Last name", (
            <input style={S.input} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
          ))}
        </div>
        {field("Email", (
          <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        ))}
        {field(
          "Organization name",
          <input
            style={S.input}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder={firstName.trim() ? `${firstName.trim()}'s Organization` : "Your company or team name"}
            autoComplete="organization"
          />,
          false
        )}
        {field("Password", (
          <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        ))}
        {field("Confirm password", (
          <input
            style={S.input}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRegister()}
            autoComplete="new-password"
          />
        ))}
        <button
          style={{ ...S.btn("primary"), width: "100%", padding: "12px 20px", fontSize: 14, opacity: loading ? 0.7 : 1, marginTop: 8 }}
          onClick={handleRegister}
          disabled={loading}
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
        <p style={{ color: COLORS.textDim, fontSize: 11, marginTop: 20 }}>
          Already have an account?{" "}
          <span style={{ color: COLORS.orange, cursor: "pointer" }} onClick={() => navigate("/")}>
            Sign in
          </span>
        </p>
        <p style={{ color: COLORS.textDim, fontSize: 10, marginTop: 8 }}>Powered by <span style={{ color: COLORS.orange }}>Leviosai, Inc.</span></p>
      </div>
    </div>
  );
}

// ============================================================
// ADMIN LOGIN — Leviosai Operator Portal (separate from client login)
// ============================================================
function AdminLoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await auth.login(email, pass);
      if (res.user.role !== "admin") {
        setError("Operator access only. This portal is restricted to Leviosai administrators.");
        setLoading(false);
        return;
      }
      setToken(res.token);
      onLogin(res.user);
      navigate("/admin");
    } catch (err) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: `radial-gradient(ellipse at 70% 80%, rgba(155,89,182,0.12), transparent 60%), ${COLORS.bg}` }}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "48px 40px", width: "100%", maxWidth: 400, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🛡️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: COLORS.text }}>Leviosai Operator Portal</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "0 0 32px", lineHeight: 1.5 }}>Restricted access — administrators only</p>
        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 16, textAlign: "left", lineHeight: 1.5 }}>
            {error}
          </div>
        )}
        <div style={{ textAlign: "left", marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, display: "block", marginBottom: 6 }}>Email</label>
          <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="email" />
        </div>
        <div style={{ textAlign: "left", marginBottom: 24 }}>
          <label style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 500, display: "block", marginBottom: 6 }}>Password</label>
          <input style={S.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} autoComplete="current-password" />
        </div>
        <button
          style={{ ...S.btn("primary"), width: "100%", padding: "12px 20px", fontSize: 14, opacity: loading ? 0.7 : 1, background: `linear-gradient(135deg, ${COLORS.purple}, #7d3c98)` }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? "Verifying..." : "Sign In to Operator Portal"}
        </button>
        <p style={{ color: COLORS.textDim, fontSize: 11, marginTop: 20 }}>
          Not an admin?{" "}
          <span style={{ color: COLORS.orange, cursor: "pointer" }} onClick={() => navigate("/")}>
            Back to main login
          </span>
        </p>
        <p style={{ color: COLORS.textDim, fontSize: 10, marginTop: 8 }}>Powered by <span style={{ color: COLORS.purple }}>Leviosai, Inc.</span></p>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD — with Features 1, 3, 5
// ============================================================
function DashboardPage({ setPage }) {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drill, setDrill] = useState(null); // { title, description, filter }
  const [sdrAnalytics, setSdrAnalytics] = useState(null);
  const [callAnalytics, setCallAnalytics] = useState(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      dashboard.getStats().then(setStats),
      activityApi.list({ limit: 7 }).then(setActivity),
      sdrApi.getAnalytics().then(setSdrAnalytics).catch(() => {}),
      callApi.getAnalytics().then(setCallAnalytics).catch(() => {}),
    ]).catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalAppts = stats?.upcomingAppointments?.length || 0;
  const revivalData = [
    { month: "Oct", revived: 45, appts: 15, closed: 4 },
    { month: "Nov", revived: 62, appts: 21, closed: 7 },
    { month: "Dec", revived: 58, appts: 19, closed: 8 },
    { month: "Jan", revived: 78, appts: 26, closed: 11 },
    { month: "Feb", revived: 91, appts: 30, closed: 13 },
    { month: "Mar", revived: 104, appts: 34, closed: 16 },
  ];
  const channelData = [
    { name: "Voice AI", value: 38 }, { name: "SMS/Text", value: 35 },
    { name: "Email", value: 22 }, { name: "Omnichannel", value: 5 },
  ];
  const channelColors = [COLORS.orange, COLORS.blue, COLORS.green, COLORS.purple];
  const recentActivity = [
    { time: "2 min ago", action: "Voice AI set appointment", lead: "Robert Taylor", result: "success" },
    { time: "18 min ago", action: "SMS revived lead", lead: "David Chen", result: "success" },
    { time: "34 min ago", action: "Email follow-up sent", lead: "Michael Brown", result: "pending" },
    { time: "1 hr ago", action: "No-show detected — $200 credit applied", lead: "Marcus Johnson", result: "credit" },
    { time: "1.5 hrs ago", action: "New lead scraped & qualified", lead: "Jennifer Adams", result: "success" },
    { time: "2 hrs ago", action: "Proposal viewed by customer", lead: "Sandra Wilson", result: "success" },
    { time: "3 hrs ago", action: "Lead score boosted +5 (market change)", lead: "David Chen", result: "boost" },
  ];

  if (loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Dashboard</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>Welcome back. Here's your performance overview.</p>
        </div>
        <button
          onClick={() => setPage("Sandbox")}
          style={{
            background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`,
            color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px",
            fontSize: 14, fontWeight: 600, cursor: "pointer", letterSpacing: 0.3,
            boxShadow: `0 4px 20px ${COLORS.orangeGlow}`,
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 6px 28px ${COLORS.orangeGlow}`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 20px ${COLORS.orangeGlow}`; }}
        >
          See me in action
        </button>
      </div>

      {/* FEATURE 5: Performance tier suggestion */}
      <TierSuggestionBanner totalAppts={totalAppts} hasAliv={true} hasSalesTool={false} onAction={(t) => setPage(t === "sales" ? "Proposals & Sales" : "Billing")} />

      <div className="grid-stats" style={{ marginBottom: 24 }}>
        <StatCard label="Total Leads" value={stats?.totalLeads || 0} color={COLORS.orange} icon="🔥"
          onClick={() => setDrill({ title: "All Leads", description: "Every lead in your pipeline", filter: {} })} />
        <StatCard label="Hot Leads" value={stats?.hotLeads || 0} color={COLORS.green} icon="📅"
          onClick={() => setDrill({ title: "Hot Leads", description: "High-temperature leads ready for outreach", filter: { temperature: "hot" } })} />
        <StatCard label="Won Deals" value={stats?.wonDeals || 0} color={COLORS.blue} icon="📈"
          onClick={() => setDrill({ title: "Won Deals", description: "Closed-won leads", filter: { status: "qualified" }, emptyText: "No won deals yet — keep pushing!" })} />
        <StatCard label="Pipeline Value" value={`$${((stats?.pipelineValue || 0) / 1000).toFixed(0)}K`} color={COLORS.teal} icon="💰"
          onClick={() => setDrill({ title: "Pipeline Value", description: "Active leads contributing to pipeline", filter: {} })} />
        <StatCard label="Won Revenue" value={`$${((stats?.wonRevenue || 0) / 1000).toFixed(0)}K`} color={COLORS.yellow} icon="💸"
          onClick={() => setDrill({ title: "Won Revenue Breakdown", description: "Revenue-generating closed deals", filter: { status: "qualified" }, emptyText: "No won revenue yet." })} />
        <StatCard label="Show-Up Rate" value="87" suffix="%" change={3.2} color={COLORS.purple} icon="✅"
          onClick={() => setPage("Appointments")} />
      </div>

      {drill && (
        <DrillDownPanel
          title={drill.title}
          description={drill.description}
          filter={drill.filter}
          emptyText={drill.emptyText}
          onClose={() => setDrill(null)}
        />
      )}

      <div className="grid-dashboard-charts" style={{ marginBottom: 20 }}>
        <div style={S.card}>
          <div style={S.cardHeader}><span>Revival & Appointment Trends</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>Last 6 months</span></div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={revivalData}>
              <defs>
                <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.orange} stopOpacity={0.3} /><stop offset="100%" stopColor={COLORS.orange} stopOpacity={0} /></linearGradient>
                <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.green} stopOpacity={0.3} /><stop offset="100%" stopColor={COLORS.green} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="month" stroke={COLORS.textDim} fontSize={11} />
              <YAxis stroke={COLORS.textDim} fontSize={11} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="revived" stroke={COLORS.orange} fill="url(#gR)" strokeWidth={2} name="Revived" />
              <Area type="monotone" dataKey="appts" stroke={COLORS.green} fill="url(#gA)" strokeWidth={2} name="Appts Set" />
              <Line type="monotone" dataKey="closed" stroke={COLORS.purple} strokeWidth={2} dot={{ r: 3 }} name="Deals Closed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>Outreach Channels</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart><Pie data={channelData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">{channelData.map((_, i) => <Cell key={i} fill={channelColors[i]} />)}</Pie><Tooltip contentStyle={{ background: "#1e1e1e", border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12, color: COLORS.text }} itemStyle={{ color: COLORS.text }} /></PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
            {channelData.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: channelColors[i] }} /><span style={{ color: COLORS.textMuted }}>{d.name} ({d.value}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2col">
        <div style={S.card}>
          <div style={S.cardHeader}><span>Recent Activity</span><span style={{ fontSize: 12, color: COLORS.orange, cursor: "pointer" }} onClick={() => setPage("Conversation Replay")}>View All →</span></div>
          {recentActivity.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < recentActivity.length - 1 ? `1px solid ${COLORS.border}22` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                background: a.result === "success" ? COLORS.green : a.result === "credit" ? COLORS.yellow : a.result === "boost" ? COLORS.teal : a.result === "declined" ? COLORS.red : COLORS.yellow }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>{a.action}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>{a.lead} · {a.time}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={S.cardHeader}><span>Goal Tracking</span><ComplianceBadge /></div>
          {[
            { label: "Lead Revival Rate", current: 15.2, target: 15, color: COLORS.green, met: true },
            { label: "Revived → Appt Set", current: 32.7, target: 33, color: COLORS.orange, met: false },
            { label: "Monthly Appt Target", current: 34, target: 40, color: COLORS.blue, met: false },
            { label: "Show-Up Rate", current: 87, target: 80, color: COLORS.teal, met: true },
          ].map((g, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>{g.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.orange }}>{g.current}{typeof g.target === "number" && g.target <= 100 ? "%" : ""} / {g.target}{typeof g.target === "number" && g.target <= 100 ? "%" : ""}</span>
              </div>
              <ProgressBar value={g.current} max={g.target} color={g.color} height={8} />
              <div style={{ fontSize: 11, color: g.met ? COLORS.green : COLORS.yellow, marginTop: 4 }}>{g.met ? "✓ Goal exceeded" : "⟳ In progress"}</div>
            </div>
          ))}
          {/* FEATURE 1: Show-up guarantee highlight */}
          <div style={{ marginTop: 12, padding: 14, background: `${COLORS.teal}12`, borderRadius: 8, border: `1px solid ${COLORS.teal}33` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, marginBottom: 4 }}>🛡️ Show-Up Guarantee Active</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
              3 no-shows this month → $600 in credits applied to your invoice. You only pay full price for appointments that happen.
            </div>
          </div>
          <div style={{ marginTop: 12, padding: 14, background: COLORS.orangeGlow, borderRadius: 8, border: `1px solid ${COLORS.orange}33` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.orangeLight, marginBottom: 4 }}>💡 AI Suggestion</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
              {/* FEATURE 3: Score decay intelligence */}
              4 leads have scores decaying rapidly. Market conditions (utility rate hike +12%) triggered score boosts for 8 leads in your area. Recommend immediate outreach to these re-scored leads for optimal revival window.
            </div>
          </div>
        </div>
      </div>

      {/* SDR Agent Analytics */}
      {(sdrAnalytics || callAnalytics) && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>🤖 SDR Agent — This Month</div>
            <button style={{ ...S.btn("ghost"), padding: "5px 14px", fontSize: 12 }} onClick={() => setPage("SDR Agent")}>View Full Dashboard →</button>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              { label: "Sequences Triggered", value: sdrAnalytics?.totalEnrollments ?? "—", color: COLORS.blue },
              { label: "Bookings via SDR",    value: sdrAnalytics?.booked ?? "—",            color: COLORS.green },
              { label: "Booking Rate",        value: sdrAnalytics ? `${sdrAnalytics.bookedRate}%` : "—", color: COLORS.teal },
              { label: "Active Sequences",    value: sdrAnalytics?.active ?? "—",            color: COLORS.orange },
              { label: "AI Calls Made",       value: callAnalytics?.totalCalls ?? "—",       color: COLORS.purple },
              { label: "Call Answer Rate",    value: callAnalytics ? `${callAnalytics.answerRate}%` : "—", color: COLORS.yellow },
            ].map(s => (
              <div key={s.label} style={{ flex: "1 1 130px", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {sdrAnalytics?.usage && (
            <div style={{ ...S.card }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Monthly Usage</div>
              {[
                { label: "Leads Enrolled", used: sdrAnalytics.usage.leadsUsed, limit: sdrAnalytics.usage.leadsLimit, color: COLORS.orange },
                { label: "Call Minutes",   used: sdrAnalytics.usage.minutesUsed, limit: sdrAnalytics.usage.minutesLimit, color: COLORS.blue },
              ].map(u => (
                <div key={u.label} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: COLORS.text }}>{u.label}</span>
                    <span style={{ color: COLORS.textMuted }}>{u.used} / {u.limit}</span>
                  </div>
                  <ProgressBar value={u.used} max={u.limit || 1} color={u.used / (u.limit || 1) > 0.9 ? COLORS.red : u.color} height={6} />
                  {u.used / (u.limit || 1) > 0.9 && (
                    <div style={{ fontSize: 11, color: COLORS.red, marginTop: 4 }}>⚠ Near limit — <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setPage("Billing")}>upgrade plan</span></div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LEAD ACTION MODALS — branded replacements for window.prompt/alert
// ============================================================

// Shared branded shell for lead-action modals. Single header styling so SMS,
// Email, Call confirm, AI score and Edit Lead all feel like one product.
function LeadActionShell({ icon, title, subtitle, lead, onClose, children, width = 560 }) {
  return (
    <div style={S.modal} onClick={onClose}>
      <div style={{ ...S.modalContent, maxWidth: width, padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          padding: "18px 24px",
          background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`,
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{subtitle}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, width: 30, height: 30, borderRadius: 8 }}>✕</button>
        </div>
        {lead && (
          <div style={{ padding: "12px 24px", background: COLORS.surfaceAlt, borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: COLORS.orangeGlow, color: COLORS.orange, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{(lead.firstName || lead.name || "?")[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: COLORS.text }}>{lead.name || [lead.firstName, lead.lastName].filter(Boolean).join(" ")}</div>
              <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{lead.email || "—"} · {lead.phone || "—"}</div>
            </div>
          </div>
        )}
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

// SMS + Email composer. One component handles both via the `channel` prop.
function SendMessageModal({ lead, channel, onClose, onSent }) {
  const isEmail = channel === "email";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setError(""); setGenerating(true);
    try {
      const gen = await aiApi.generateMessage(lead.id, channel);
      if (isEmail) setSubject(gen.subject || "Following up");
      setBody(gen.message || "");
    } catch (e) {
      setError(e.message || "Could not generate with AI.");
    } finally {
      setGenerating(false);
    }
  };

  const send = async () => {
    if (!body.trim()) { setError("Message body is required."); return; }
    if (isEmail && !subject.trim()) { setError("Subject is required."); return; }
    setError(""); setSending(true);
    try {
      if (isEmail) await messagingApi.sendEmail(lead.id, subject, body, true);
      else await messagingApi.sendSMS(lead.id, body, true);
      onSent && onSent({ channel });
      onClose();
    } catch (e) {
      setError(e.message || "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <LeadActionShell
      icon={isEmail ? "✉️" : "💬"}
      title={isEmail ? "Send Email" : "Send SMS"}
      subtitle={isEmail ? `Delivered via Resend · ${lead.email || "no email on file"}` : `Delivered via Twilio · ${lead.phone || "no phone on file"}`}
      lead={lead}
      onClose={onClose}
    >
      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" onClick={generate} disabled={generating}
          style={{ ...S.btn("ghost"), fontSize: 11, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>🤖</span><span>{generating ? "Generating…" : "Generate with AI"}</span>
        </button>
      </div>
      {isEmail && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Subject</label>
          <input style={S.input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick follow-up" />
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>{isEmail ? "Body" : "Message"}</label>
        <textarea
          style={{ ...S.input, minHeight: isEmail ? 180 : 110, fontFamily: "inherit", resize: "vertical", padding: 12 }}
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={isEmail ? "Write your email…" : "Keep it short and TCPA-compliant — reply STOP to opt out."}
          maxLength={isEmail ? 5000 : 320}
        />
        {!isEmail && <div style={{ fontSize: 10, color: COLORS.textDim, textAlign: "right", marginTop: 4 }}>{body.length}/320</div>}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={S.btn("ghost")}>Cancel</button>
        <button onClick={send} disabled={sending} style={S.btn("primary")}>
          {sending ? "Sending…" : isEmail ? "✉️ Send Email" : "💬 Send SMS"}
        </button>
      </div>
    </LeadActionShell>
  );
}

// Voice-AI call confirmation modal (branded replacement for confirm/alert).
function CallConfirmModal({ lead, onClose, onCalled }) {
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const place = async () => {
    setError(""); setPlacing(true);
    try {
      const r = await messagingApi.initiateCall(lead.id);
      setResult(r);
      onCalled && onCalled(r);
    } catch (e) {
      setError(e.message || "Could not start call.");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <LeadActionShell
      icon="📞"
      title="Voice AI Call"
      subtitle={`Dial ${lead.phone || "(no phone on file)"}`}
      lead={lead}
      onClose={onClose}
      width={480}
    >
      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}
      {!result ? (
        <>
          <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
            Your Leviosai Voice AI agent will dial this lead, disclose it's an AI per TCPA, and handle the conversation with your configured talk track. The call will be recorded and transcribed.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={S.btn("ghost")}>Cancel</button>
            <button onClick={place} disabled={placing} style={S.btn("primary")}>
              {placing ? "Connecting…" : "📞 Start Call"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: 14, borderRadius: 10, background: `${COLORS.green}15`, border: `1px solid ${COLORS.green}55`, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.green, marginBottom: 4 }}>
              {result.twilioConfigured ? "✓ Call initiated" : "✓ Call logged (demo mode)"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>
              {result.twilioConfigured
                ? `Twilio SID: ${result.call?.sid || "—"}`
                : "Twilio is not configured in this environment — this call was logged but not dialed."}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={S.btn("primary")}>Done</button>
          </div>
        </>
      )}
    </LeadActionShell>
  );
}

// AI score result modal (branded replacement for alert).
function ScoreResultModal({ lead, onClose }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    aiApi.scoreLead(lead.id)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setError(e.message || "Scoring failed."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lead.id]);

  const tempColor = result?.temperature === "hot" ? COLORS.red : result?.temperature === "warm" ? COLORS.orange : COLORS.blue;

  return (
    <LeadActionShell icon="🧠" title="AI Lead Score" subtitle="Powered by Claude Sonnet" lead={lead} onClose={onClose} width={520}>
      {loading && <LoadingState message="Analyzing lead…" />}
      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}
      {result && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <div style={{ width: 88, height: 88, borderRadius: 44, background: `conic-gradient(${tempColor} ${result.score * 3.6}deg, ${COLORS.surfaceAlt} 0)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 72, height: 72, borderRadius: 36, background: COLORS.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: tempColor }}>{result.score}</div>
                <div style={{ fontSize: 9, color: COLORS.textMuted }}>/100</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Temperature</div>
              <div style={{ ...S.badge(tempColor), fontSize: 13, padding: "4px 12px", display: "inline-block" }}>{(result.temperature || "").toUpperCase()}</div>
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 10, background: COLORS.surfaceAlt, fontSize: 13, lineHeight: 1.6, color: COLORS.text, marginBottom: 16 }}>
            {result.reasoning || "No additional notes."}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={S.btn("primary")}>Done</button>
          </div>
        </>
      )}
    </LeadActionShell>
  );
}

// Edit Lead modal — mirrors Add Lead fields but PATCHes existing lead.
function EditLeadModal({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: lead.firstName || "",
    lastName: lead.lastName || "",
    email: lead.email || "",
    phone: lead.phone || "",
    source: lead.source || "",
    status: lead.rawStatus || lead.status || "new",
    notes: lead.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError("First name, last name, and email are required."); return;
    }
    setSaving(true);
    try {
      await leadsApi.update(lead.id, form);
      onSaved && onSaved();
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <LeadActionShell icon="✏️" title="Edit Lead" subtitle="Update contact info and status" lead={lead} onClose={onClose} width={600}>
      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>First Name *</label>
          <input style={S.input} value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Last Name *</label>
          <input style={S.input} value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Email *</label>
        <input style={S.input} type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Phone</label>
          <input style={S.input} value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Source</label>
          <select style={{ ...S.select, width: "100%" }} value={form.source} onChange={(e) => setForm(f => ({ ...f, source: e.target.value }))}>
            <option value="">—</option>
            <option value="Manual Entry">Manual Entry</option>
            <option value="Website">Website</option>
            <option value="Referral">Referral</option>
            <option value="Cold Call">Cold Call</option>
            <option value="Facebook Ad">Facebook Ad</option>
            <option value="Google Ad">Google Ad</option>
            <option value="CSV Import">CSV Import</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Status</label>
        <select style={{ ...S.select, width: "100%" }} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
          <option value="new">New</option>
          <option value="contacted">Aged (contacted)</option>
          <option value="qualified">Revived (qualified)</option>
          <option value="proposal">Appointment Set (proposal)</option>
          <option value="won">Won</option>
          <option value="lost">Dead (lost)</option>
        </select>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Notes</label>
        <textarea style={{ ...S.input, minHeight: 90, fontFamily: "inherit", padding: 12 }} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={S.btn("ghost")}>Cancel</button>
        <button onClick={save} disabled={saving} style={S.btn("primary")}>{saving ? "Saving…" : "Save Changes"}</button>
      </div>
    </LeadActionShell>
  );
}

// ============================================================
// LEADS — with Features 2, 3
// ============================================================
function LeadsPage({ onNavigate }) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({ firstName: "", lastName: "", email: "", phone: "", source: "" });
  const [addLeadError, setAddLeadError] = useState(null);
  const [addLeadSaving, setAddLeadSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // action: { kind: 'sms'|'email'|'call'|'score'|'edit', lead }
  const [action, setAction] = useState(null);

  const openLead = (lead) => {
    navigate(`/leads/${lead.id}`);
  };

  const statusMap = { "New": "new", "Dead": "lost", "Aged": "contacted", "Revived": "qualified", "Appointment Set": "proposal" };
  const statusLabelMap = { "new": "New", "lost": "Dead", "contacted": "Aged", "qualified": "Revived", "proposal": "Appointment Set", "won": "Revived" };

  const fetchLeads = useCallback(() => {
    setLoading(true);
    setError(null);
    const filters = {};
    if (filter !== "All" && statusMap[filter]) filters.status = statusMap[filter];
    if (search) filters.search = search;
    leadsApi.list(filters).then((data) => {
      setLeads(data.map(l => ({
        ...l,
        name: `${l.firstName} ${l.lastName}`,
        status: statusLabelMap[l.status] || l.status,
        score: l.aiScore || 0,
        baseScore: l.aiScore || 50,
        decayRate: -1.5,
        marketBoost: 0,
        conversations: [],
        source: l.source || "—",
        lastContact: l.lastContactedAt ? new Date(l.lastContactedAt).toISOString().split("T")[0] : "—",
      })));
    }).catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const statusColors = { "Dead": COLORS.red, "Aged": COLORS.yellow, "Revived": COLORS.blue, "New": COLORS.green, "Appointment Set": COLORS.purple };
  const filters = ["All", "Dead", "Aged", "Revived", "New", "Appointment Set"];
  const filtered = leads.filter(l => (filter === "All" || l.status === filter) && (l.name.toLowerCase().includes(search.toLowerCase()) || l.email.toLowerCase().includes(search.toLowerCase())));

  if (loading && leads.length === 0) return <LoadingState message="Loading leads..." />;
  if (error && leads.length === 0) return <ErrorState message={error} onRetry={fetchLeads} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Lead Management</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>{leads.length} total · {leads.filter(l => l.status === "Appointment Set").length} appts set · {leads.filter(l => l.marketBoost > 0).length} market-boosted</p>
        </div>
        <div className="page-header-actions">
          <button style={S.btn("secondary")} onClick={() => setShowUpload(true)}>📤 Import Leads</button>
          <button style={S.btn("primary")} onClick={() => { setAddLeadForm({ firstName: "", lastName: "", email: "", phone: "", source: "" }); setAddLeadError(null); setShowAddLead(true); }}>+ Add Lead</button>
        </div>
      </div>

      {/* FEATURE 3: Decay alert banner */}
      <div style={{ padding: 14, borderRadius: 10, background: `${COLORS.red}10`, border: `1px solid ${COLORS.red}33`, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>📉</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.red }}>Rapid Score Decay Alert</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted }}>{leads.filter(l => l.decayRate < -2.5).length} leads losing score rapidly. Auto-engagement recommended before they drop below revival threshold.</div>
        </div>
        <button style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12 }}>Auto-Engage All</button>
      </div>

      <div className="filter-bar">
        <input style={{ ...S.input, maxWidth: 280 }} placeholder="Search leads..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <TabBar tabs={filters} active={filter} onChange={setFilter} />
      </div>

      <div style={S.card}>
        {filtered.length === 0 && !loading ? (
          <EmptyState icon="👥" title="No leads found" description={search || filter !== "All" ? "Try adjusting your search or filter criteria." : "Import or add your first lead to get started."} action="+ Add Lead" />
        ) : (
        <div className="table-responsive">
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Name</th><th style={S.th}>Contact</th><th style={S.th} className="hide-mobile">Source</th><th style={S.th}>Status</th>
            <th style={S.th}>Score</th><th style={S.th} className="hide-mobile">Decay</th><th style={S.th} className="hide-mobile">Convos</th><th style={S.th}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => openLead(l)}>
                <td style={S.td}><span style={{ fontWeight: 600 }}>{l.name}</span></td>
                <td style={S.td}><div style={{ fontSize: 12 }}>{l.phone}</div><div style={{ fontSize: 11, color: COLORS.textMuted }}>{l.email}</div></td>
                <td style={S.td} className="hide-mobile"><span style={S.tag(COLORS.textMuted)}>{l.source}</span></td>
                <td style={S.td}><span style={S.badge(statusColors[l.status] || COLORS.textMuted)}>{l.status}</span></td>
                <td style={S.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ProgressBar value={l.score} color={l.score > 75 ? COLORS.green : l.score > 50 ? COLORS.yellow : COLORS.red} />
                    <span style={{ fontSize: 12, fontWeight: 600, minWidth: 24 }}>{l.score}</span>
                    {l.marketBoost > 0 && <span style={{ fontSize: 10, color: COLORS.green }}>⚡+{l.marketBoost}</span>}
                  </div>
                </td>
                {/* FEATURE 3: Decay indicator */}
                <td style={S.td} className="hide-mobile">
                  {l.decayRate < 0 ? (
                    <span style={{ fontSize: 12, color: l.decayRate < -2.5 ? COLORS.red : COLORS.yellow, fontWeight: 600 }}>
                      {l.decayRate}/mo {l.decayRate < -2.5 ? "⚠️" : ""}
                    </span>
                  ) : <span style={{ fontSize: 12, color: COLORS.green }}>Stable</span>}
                </td>
                {/* FEATURE 2: Conversation count */}
                <td style={S.td} className="hide-mobile">
                  <span style={{ ...S.tag(l.conversations.length > 0 ? COLORS.blue : COLORS.textDim), cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); openLead(l); }}>
                    💬 {l.conversations.length}
                  </span>
                </td>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button title="Voice AI call" style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setAction({ kind: "call", lead: l })}>📞</button>
                    <button title="Send SMS" style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setAction({ kind: "sms", lead: l })}>💬</button>
                    <button title="Send email" style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setAction({ kind: "email", lead: l })}>✉️</button>
                    <button title="Edit lead" style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setAction({ kind: "edit", lead: l })}>✏️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div style={S.modal} onClick={() => setShowUpload(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Import Leads</h3>
            <p style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 20 }}>Upload your leads via file or connect a CRM to sync automatically.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { icon: "📄", title: "CSV / Excel File", desc: "Upload .csv, .xlsx, or .xls" },
                { icon: "📸", title: "Screenshot / Image", desc: "AI extracts lead data from images" },
                { icon: "☁️", title: "CRM Sync", desc: "Import from connected CRM" },
                { icon: "📋", title: "Paste Data", desc: "Copy/paste from any source" },
              ].map((opt, i) => (
                <div key={i} style={{ padding: 16, borderRadius: 10, border: `1px solid ${COLORS.border}`, cursor: "pointer", textAlign: "center", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.orange; e.currentTarget.style.background = COLORS.orangeGlow; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{opt.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: 20, borderRadius: 10, border: `2px dashed ${COLORS.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>☁️</div>
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>Drag & drop files here or <span style={{ color: COLORS.orange, textDecoration: "underline" }}>browse</span></div>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 4 }}>Supports CSV, XLSX, XLS, PNG, JPG, PDF</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button style={S.btn("ghost")} onClick={() => setShowUpload(false)}>Cancel</button>
              <button style={S.btn("primary")}>Upload & Process</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <div style={S.modal} onClick={() => setShowAddLead(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Add New Lead</h3>
            <p style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 20 }}>Manually add a lead to your pipeline.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>First Name *</label>
                <input style={S.input} placeholder="Jane" value={addLeadForm.firstName} onChange={(e) => setAddLeadForm(f => ({ ...f, firstName: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Last Name *</label>
                <input style={S.input} placeholder="Smith" value={addLeadForm.lastName} onChange={(e) => setAddLeadForm(f => ({ ...f, lastName: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Email *</label>
              <input style={S.input} type="email" placeholder="jane@example.com" value={addLeadForm.email} onChange={(e) => setAddLeadForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Phone</label>
                <input style={S.input} placeholder="+1 (555) 000-0000" value={addLeadForm.phone} onChange={(e) => setAddLeadForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Source</label>
                <select style={{ ...S.select, width: "100%" }} value={addLeadForm.source} onChange={(e) => setAddLeadForm(f => ({ ...f, source: e.target.value }))}>
                  <option value="">Select source…</option>
                  <option value="Manual Entry">Manual Entry</option>
                  <option value="Website">Website</option>
                  <option value="Referral">Referral</option>
                  <option value="Cold Call">Cold Call</option>
                  <option value="Facebook Ad">Facebook Ad</option>
                  <option value="Google Ad">Google Ad</option>
                  <option value="CSV Import">CSV Import</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            {addLeadError && <div style={{ padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}44`, color: COLORS.red, fontSize: 13, marginBottom: 14 }}>{addLeadError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button style={S.btn("ghost")} onClick={() => setShowAddLead(false)}>Cancel</button>
              <button style={S.btn("primary")} disabled={addLeadSaving} onClick={async () => {
                if (!addLeadForm.firstName.trim() || !addLeadForm.lastName.trim() || !addLeadForm.email.trim()) {
                  setAddLeadError("First name, last name, and email are required.");
                  return;
                }
                setAddLeadSaving(true);
                setAddLeadError(null);
                try {
                  await leadsApi.create({ ...addLeadForm, status: "new" });
                  setShowAddLead(false);
                  fetchLeads();
                } catch (err) {
                  setAddLeadError(err.message || "Failed to add lead.");
                } finally {
                  setAddLeadSaving(false);
                }
              }}>{addLeadSaving ? "Saving…" : "Add Lead"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Branded lead-action modals */}
      {action?.kind === "sms" && (
        <SendMessageModal lead={action.lead} channel="sms"
          onClose={() => setAction(null)}
          onSent={() => fetchLeads()} />
      )}
      {action?.kind === "email" && (
        <SendMessageModal lead={action.lead} channel="email"
          onClose={() => setAction(null)}
          onSent={() => fetchLeads()} />
      )}
      {action?.kind === "call" && (
        <CallConfirmModal lead={action.lead}
          onClose={() => setAction(null)}
          onCalled={() => fetchLeads()} />
      )}
      {action?.kind === "score" && (
        <ScoreResultModal lead={action.lead}
          onClose={() => { setAction(null); fetchLeads(); }} />
      )}
      {action?.kind === "edit" && (
        <EditLeadModal lead={action.lead}
          onClose={() => setAction(null)}
          onSaved={() => { fetchLeads(); }} />
      )}
    </div>
  );
}

// ============================================================
// CAMPAIGNS
// ============================================================
function CampaignsPage() {
  const [activeProduct, setActiveProduct] = useState("riiviv");
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const campaigns = {
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

  return (
    <div>
      <div className="page-header">
        <div><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Campaigns</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>Manage your riivīv and alīv AI agent campaigns</p></div>
        <div className="page-header-actions"><button style={S.btn("primary")} onClick={() => setShowNewCampaign(true)}>+ New Campaign</button></div>
      </div>

      <div className="grid-2col" style={{ marginBottom: 24 }}>
        {[
          { key: "riiviv", label: "riivīv", desc: "Dead & Aged Lead Revival Engine", stat1: "217", s1l: "Revived", stat2: "73", s2l: "Appts Set", color: COLORS.orange },
          { key: "aliv", label: "alīv", desc: "New Lead to Appointment Engine", stat1: "1,930", s1l: "Leads Found", stat2: "140", s2l: "Appts Set", color: COLORS.blue },
        ].map((p) => (
          <div key={p.key} onClick={() => setActiveProduct(p.key)} style={{
            flex: 1, padding: 20, borderRadius: 12, cursor: "pointer",
            border: `1px solid ${activeProduct === p.key ? p.color : COLORS.border}`,
            background: activeProduct === p.key ? `${p.color}15` : COLORS.surface, transition: "all 0.2s",
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: activeProduct === p.key ? p.color : COLORS.text, marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>{p.desc}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: p.color }}>{p.stat1}</div><div style={{ fontSize: 10, color: COLORS.textMuted }}>{p.s1l}</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.green }}>{p.stat2}</div><div style={{ fontSize: 10, color: COLORS.textMuted }}>{p.s2l}</div></div>
            </div>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}><span>{activeProduct === "riiviv" ? "riivīv" : "alīv"} Campaigns</span><ComplianceBadge /></div>
        <div className="table-responsive">
        <table style={S.table}>
          <thead><tr><th style={S.th}>Campaign</th><th style={S.th}>Status</th><th style={S.th}>Leads</th><th style={S.th} className="hide-mobile">Contacted</th>{activeProduct === "riiviv" && <th style={S.th} className="hide-mobile">Revived</th>}<th style={S.th}>Appts</th><th style={S.th} className="hide-mobile">Channel</th><th style={S.th} className="hide-mobile">Started</th></tr></thead>
          <tbody>
            {campaigns[activeProduct].map((c) => (
              <tr key={c.id}>
                <td style={S.td}><span style={{ fontWeight: 600 }}>{c.name}</span></td>
                <td style={S.td}><span style={S.badge(c.status === "Active" ? COLORS.green : COLORS.textMuted)}>{c.status}</span></td>
                <td style={S.td}>{c.leads.toLocaleString()}</td>
                <td style={S.td} className="hide-mobile">{c.contacted.toLocaleString()}</td>
                {activeProduct === "riiviv" && <td style={S.td} className="hide-mobile"><span style={{ fontWeight: 600, color: COLORS.orange }}>{c.revived}</span></td>}
                <td style={S.td}><span style={{ fontWeight: 600, color: COLORS.green }}>{c.appts}</span></td>
                <td style={S.td} className="hide-mobile"><span style={S.tag(COLORS.textMuted)}>{c.channel}</span></td>
                <td style={S.td} className="hide-mobile"><span style={{ fontSize: 12, color: COLORS.textMuted }}>{c.started}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {showNewCampaign && (
        <div style={S.modal} onClick={() => setShowNewCampaign(false)}>
          <div style={{ ...S.modalContent, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Create New Campaign</h3>
            <div style={{ display: "grid", gap: 16 }}>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Campaign Name</label><input style={S.input} placeholder="e.g., Solar Spring Revival" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Product</label><select style={{ ...S.select, width: "100%" }}><option>riivīv — Lead Revival</option><option>alīv — New Leads</option></select></div>
                <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Industry</label><select style={{ ...S.select, width: "100%" }}>{INDUSTRIES.map((ind) => <option key={ind}>{ind}</option>)}</select></div>
              </div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Voice Agent</label><select style={{ ...S.select, width: "100%" }}>{VOICE_OPTIONS.map((v) => <option key={v.id}>{v.name} — {v.tone} ({v.accent})</option>)}</select></div>
              <div style={{ padding: 14, background: COLORS.orangeGlow, borderRadius: 8, border: `1px solid ${COLORS.orange}33` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.orangeLight, marginBottom: 6 }}>🛡️ Compliance</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <Toggle value={true} label="TCPA consent verification" /><Toggle value={true} label="DNC scrubbing" /><Toggle value={true} label="AI disclosure at call start" /><Toggle value={true} label="Quiet hours (8am-9pm local)" />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
              <button style={S.btn("ghost")} onClick={() => setShowNewCampaign(false)}>Cancel</button>
              <button style={S.btn("primary")}>Launch Campaign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// APPOINTMENTS — with Feature 1 (Show-Up Guarantee)
// ============================================================
function AppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightId, setHighlightId] = useState(() => {
    const hId = sessionStorage.getItem("highlight_appointment");
    return hId ? parseInt(hId) : null;
  });

  useEffect(() => {
    setLoading(true);
    appointmentsApi.list().then((data) => {
      setAppointments(data.map(a => ({
        id: a.id,
        lead: `${a.leadFirstName || ""} ${a.leadLastName || ""}`.trim() || a.title,
        date: new Date(a.scheduledAt).toISOString().split("T")[0],
        time: new Date(a.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        type: "Consultation",
        rep: "TBD",
        status: a.status === "scheduled" ? "Confirmed" : a.status === "completed" ? "Completed" : a.status,
        product: "—",
        showed: a.status === "completed" ? true : null,
        creditApplied: false,
      })));
    }).catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Scroll to highlighted row and clear after timeout
  useEffect(() => {
    if (highlightId !== null && appointments.length) {
      sessionStorage.removeItem("highlight_appointment");
      const timer = setTimeout(() => setHighlightId(null), 6000);
      setTimeout(() => {
        const row = document.querySelector(`tr[data-appt-id="${highlightId}"]`);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightId, appointments]);
  const [showGuaranteeInfo, setShowGuaranteeInfo] = useState(false);

  const toggleShowUp = (id, showed) => {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, showed, creditApplied: !showed, status: "Completed" } : a));
  };

  const deleteAppointment = async (id) => {
    if (!window.confirm("Delete this appointment?")) return;
    try {
      await appointmentsApi.delete(id);
      setAppointments(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  };

  const noShows = appointments.filter(a => a.showed === false);
  const totalCredits = noShows.length * 200;

  if (loading && appointments.length === 0) return <LoadingState message="Loading appointments..." />;
  if (error && appointments.length === 0) return <ErrorState message={error} />;

  return (
    <div>
      <div className="page-header">
        <div><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Appointments</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>{appointments.length} total · {noShows.length} no-shows · ${totalCredits} in credits</p></div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 24 }}>
        <StatCard label="This Week" value="5" color={COLORS.green} icon="📅" />
        <StatCard label="This Month" value="34" color={COLORS.orange} icon="📊" />
        <StatCard label="Show Rate" value="87" suffix="%" color={COLORS.teal} icon="✅" />
        <StatCard label="No-Show Credits" value={`$${totalCredits}`} color={COLORS.yellow} icon="💸" />
        <StatCard label="Close Rate" value="42" suffix="%" color={COLORS.purple} icon="🏆" />
      </div>

      {/* FEATURE 1: Show-Up Guarantee Banner */}
      <div style={{ padding: 18, borderRadius: 12, background: `${COLORS.teal}10`, border: `1px solid ${COLORS.teal}33`, marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 32 }}>🛡️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.teal }}>Show-Up Guarantee Active</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
            You pay $400/$500 per appointment set. If a prospect doesn't show, you receive a <strong style={{ color: COLORS.teal }}>$200 credit</strong> automatically applied to your next invoice. {noShows.length} no-shows this month = <strong style={{ color: COLORS.teal }}>${totalCredits} in credits</strong>.
          </div>
        </div>
        <button style={S.btn("ghost")} onClick={() => setShowGuaranteeInfo(true)}>Details</button>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}><span>All Appointments</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select style={S.select}><option>All Reps</option><option>Mike Torres</option><option>Sarah Kim</option><option>Round Robin</option></select>
          </div>
        </div>
        <div className="table-responsive">
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Lead</th><th style={S.th}>Date & Time</th><th style={S.th} className="hide-mobile">Type</th><th style={S.th} className="hide-mobile">Rep</th><th style={S.th} className="hide-mobile">Product</th><th style={S.th}>Status</th><th style={S.th}>Showed?</th><th style={S.th}>Credit</th><th style={S.th}></th>
          </tr></thead>
          <tbody>
            {appointments.map((a) => (
              <tr key={a.id} data-appt-id={a.id} style={a.id === highlightId ? { animation: "highlightPulse 1.5s ease-in-out 3" } : undefined}>
                <td style={S.td}><span style={{ fontWeight: 600 }}>{a.lead}</span>{a.id === highlightId && <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${COLORS.green}22`, color: COLORS.green, fontWeight: 600, animation: "slideUp 0.5s ease-out" }}>NEW</span>}</td>
                <td style={S.td}><div style={{ fontSize: 13 }}>{a.date}</div><div style={{ fontSize: 12, color: COLORS.orange, fontWeight: 600 }}>{a.time}</div></td>
                <td style={S.td} className="hide-mobile"><span style={S.tag(COLORS.textMuted)}>{a.type}</span></td>
                <td style={S.td} className="hide-mobile">{a.rep}</td>
                <td style={S.td} className="hide-mobile">{a.product}</td>
                <td style={S.td}><span style={S.badge(a.status === "Confirmed" ? COLORS.green : a.status === "Completed" ? COLORS.blue : COLORS.yellow)}>{a.status}</span></td>
                {/* FEATURE 1: Show-up tracking */}
                <td style={S.td}>
                  {a.status === "Completed" ? (
                    a.showed === true ? <span style={{ color: COLORS.green, fontWeight: 600 }}>✓ Yes</span> :
                    a.showed === false ? <span style={{ color: COLORS.red, fontWeight: 600 }}>✗ No-Show</span> :
                    <span style={{ color: COLORS.textMuted }}>—</span>
                  ) : a.status === "Confirmed" || a.status === "Pending" ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button style={{ ...S.btn("success"), padding: "4px 10px", fontSize: 11 }} onClick={() => toggleShowUp(a.id, true)}>✓</button>
                      <button style={{ ...S.btn("danger"), padding: "4px 10px", fontSize: 11 }} onClick={() => toggleShowUp(a.id, false)}>✗</button>
                    </div>
                  ) : <span style={{ color: COLORS.textMuted }}>—</span>}
                </td>
                <td style={S.td}>
                  {a.creditApplied ? <span style={S.badge(COLORS.teal)}>$200 Credit</span> : <span style={{ color: COLORS.textDim }}>—</span>}
                </td>
                <td style={S.td}>
                  <button style={{ ...S.btn("danger"), padding: "4px 10px", fontSize: 11 }} onClick={() => deleteAppointment(a.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Scheduling config card */}
      <div style={S.card}>
        <div style={S.cardHeader}>Calendar & Scheduling Settings</div>
        <div className="grid-2col">
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Scheduling Mode</div>
            {["Round Robin (rotate evenly)", "First Available Rep", "Specific Rep Assignment", "Weighted Distribution"].map((mode, i) => (
              <label key={mode} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, cursor: "pointer", fontSize: 13, background: i === 0 ? COLORS.orangeGlow : "transparent", marginBottom: 8 }}>
                <input type="radio" name="schedMode" defaultChecked={i === 0} /> {mode}
              </label>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>AI Appointment Strategy</div>
            <div style={{ padding: 14, background: COLORS.surfaceAlt, borderRadius: 8, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6, marginBottom: 12 }}>
              AI offers <strong style={{ color: COLORS.orangeLight }}>2 specific time slots first</strong>, optimized for prospect availability and rep calendars. If neither works: "What time works best for you this week?"
            </div>
            <Toggle value={true} label="Auto-send confirmation text + email" />
            <div style={{ marginTop: 8 }}><Toggle value={true} label="24-hour reminder" /></div>
            <div style={{ marginTop: 8 }}><Toggle value={true} label="Same-day morning reminder" /></div>
            <div style={{ marginTop: 8 }}><Toggle value={true} label="Post-appointment show-up tracking" /></div>
          </div>
        </div>
      </div>

      {showGuaranteeInfo && (
        <div style={S.modal} onClick={() => setShowGuaranteeInfo(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🛡️ Show-Up Guarantee Program</h3>
            <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.8 }}>
              <p><strong style={{ color: COLORS.text }}>How it works:</strong></p>
              <p>• You pay the standard per-appointment fee ($400 riivīv / $500 alīv) for every appointment set by our AI agents.</p>
              <p>• If the prospect <strong style={{ color: COLORS.red }}>does not show up</strong>, you automatically receive a <strong style={{ color: COLORS.teal }}>$200 credit</strong> on your next invoice.</p>
              <p>• Credits are tracked in real-time and appear on your monthly billing statement.</p>
              <p>• Mark appointments as "Showed" or "No-Show" directly in the Appointments table, or our AI can auto-detect from your calendar.</p>
              <p style={{ marginTop: 12 }}><strong style={{ color: COLORS.text }}>This month's summary:</strong></p>
              <p>• Total appointments: {appointments.filter(a => a.status === "Completed").length} completed</p>
              <p>• No-shows: {noShows.length}</p>
              <p>• Credits earned: <strong style={{ color: COLORS.teal }}>${totalCredits}</strong></p>
            </div>
            <button style={{ ...S.btn("primary"), marginTop: 20, width: "100%" }} onClick={() => setShowGuaranteeInfo(false)}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PROPOSALS — with Feature 4 (White-Label)
// ============================================================
function ProposalsPage() {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [whiteLabel, setWhiteLabel] = useState({ companyName: "SunPower Solar Solutions", primaryColor: "#e67e22", logoUploaded: true });
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [newProposalForm, setNewProposalForm] = useState({ leadId: "", title: "", amount: "" });
  const [newProposalError, setNewProposalError] = useState(null);
  const [newProposalSaving, setNewProposalSaving] = useState(false);
  const [leads, setLeads] = useState([]);

  const fetchProposals = useCallback(() => {
    setLoading(true);
    proposalsApi.list().then(setProposals).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProposals();
    leadsApi.list().then(setLeads).catch(console.error);
  }, [fetchProposals]);

  const deleteProposal = async (id) => {
    if (!window.confirm("Delete this proposal?")) return;
    try {
      await proposalsApi.delete(id);
      setProposals(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  };

  const closeProposal = async (p) => {
    try {
      const updated = await proposalsApi.update(p.id, { status: "accepted" });
      setProposals(prev => prev.map(x => x.id === p.id ? { ...x, status: "accepted" } : x));
    } catch (err) {
      alert("Failed to update: " + err.message);
    }
  };

  const statusColor = (s) => s === "accepted" ? COLORS.green : s === "viewed" ? COLORS.blue : s === "sent" ? COLORS.orange : COLORS.textMuted;
  const statusLabel = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "Draft";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Proposals & Sales</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>AI-powered proposals with white-label branding</p></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={S.badge(COLORS.purple)}>✨ Premium Feature</span>
          <button style={S.btn("primary")} onClick={() => { setNewProposalForm({ leadId: "", title: "", amount: "" }); setNewProposalError(null); setShowNewProposal(true); }}>+ New Proposal</button>
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 24 }}>
        <StatCard label="Proposals Sent" value={proposals.length} color={COLORS.orange} icon="📝" />
        <StatCard label="Viewed" value={proposals.filter(p => p.status === "viewed").length} color={COLORS.blue} icon="👁️" />
        <StatCard label="Accepted" value={proposals.filter(p => p.status === "accepted").length} color={COLORS.green} icon="✅" />
        <StatCard label="Revenue Closed" value={`$${Math.round(proposals.filter(p => p.status === "accepted").reduce((s, p) => s + (p.amount || 0), 0) / 1000)}K`} color={COLORS.purple} icon="💰" />
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>Active Proposals</div>
        {loading ? <LoadingState message="Loading proposals..." /> : proposals.length === 0 ? (
          <EmptyState icon="📝" title="No proposals yet" description="Create your first proposal to get started." action="+ New Proposal" onAction={() => { setNewProposalForm({ leadId: "", title: "", amount: "" }); setNewProposalError(null); setShowNewProposal(true); }} />
        ) : (
        <div className="table-responsive">
        <table style={S.table}>
          <thead><tr><th style={S.th}>#</th><th style={S.th}>Customer</th><th style={S.th}>Title / System</th><th style={S.th}>Amount</th><th style={S.th} className="hide-mobile">Loan Est./mo</th><th style={S.th} className="hide-mobile">Lease Est./mo</th><th style={S.th}>Status</th><th style={S.th}>Actions</th></tr></thead>
          <tbody>
            {proposals.map((p) => {
              const cashPrice = p.amount || 0;
              const loanPayment = cashPrice ? Math.round(cashPrice / 150) : "—";
              const leasePayment = cashPrice ? Math.round(cashPrice / 220) : "—";
              const customer = `${p.leadFirstName || ""} ${p.leadLastName || ""}`.trim() || "—";
              const viewableProposal = { id: `P${String(p.id).padStart(3, "0")}`, customer, system: p.title, cashPrice, loanPayment, leasePayment, status: statusLabel(p.status), created: new Date(p.createdAt).toISOString().split("T")[0] };
              return (
                <tr key={p.id}>
                  <td style={S.td}><span style={{ fontWeight: 600, color: COLORS.orange }}>P{String(p.id).padStart(3, "0")}</span></td>
                  <td style={S.td}><span style={{ fontWeight: 600 }}>{customer}</span></td>
                  <td style={S.td}>{p.title}</td>
                  <td style={S.td}>${cashPrice.toLocaleString()}</td>
                  <td style={S.td} className="hide-mobile">{loanPayment !== "—" ? `$${loanPayment}/mo` : "—"}</td>
                  <td style={S.td} className="hide-mobile">{leasePayment !== "—" ? `$${leasePayment}/mo` : "—"}</td>
                  <td style={S.td}><span style={S.badge(statusColor(p.status))}>{statusLabel(p.status)}</span></td>
                  <td style={S.td}><div style={{ display: "flex", gap: 6 }}>
                    <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setSelectedProposal(viewableProposal)}>View</button>
                    {p.status !== "accepted" && <button style={{ ...S.btn("primary"), padding: "5px 10px", fontSize: 11 }} onClick={() => closeProposal(p)}>Close Deal</button>}
                    <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={() => deleteProposal(p.id)}>✕</button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {/* FEATURE 4: White-Label Branding Config */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span>🏷️ White-Label Proposal Branding</span>
          <span style={S.badge(COLORS.green)}>✓ Configured</span>
        </div>
        <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>Proposals are fully branded with your company identity. Catalyst appears only as a subtle "Powered by" footer.</p>
        <div className="grid-3col">
          <div>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Company Name on Proposals</label>
            <input style={S.input} value={whiteLabel.companyName} onChange={(e) => setWhiteLabel({ ...whiteLabel, companyName: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Brand Color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={whiteLabel.primaryColor} onChange={(e) => setWhiteLabel({ ...whiteLabel, primaryColor: e.target.value })} style={{ width: 40, height: 36, border: "none", borderRadius: 6, cursor: "pointer" }} />
              <input style={S.input} value={whiteLabel.primaryColor} onChange={(e) => setWhiteLabel({ ...whiteLabel, primaryColor: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Company Logo</label>
            <div style={{ padding: 10, border: `1px solid ${COLORS.border}`, borderRadius: 8, textAlign: "center", fontSize: 12, color: COLORS.green }}>
              {whiteLabel.logoUploaded ? "✓ Logo uploaded" : "Click to upload"}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: 12, background: COLORS.surfaceAlt, borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: COLORS.textMuted }}>Preview: Proposals show <strong style={{ color: COLORS.text }}>{whiteLabel.companyName}</strong> as primary brand, with a small <span style={{ color: COLORS.orangeLight }}>"Powered by Catalyst"</span> footer.</div>
        </div>
      </div>

      <div className="grid-2col">
        <div style={S.card}>
          <div style={S.cardHeader}>Financing Options</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { icon: "💵", name: "Cash Purchase", enabled: true, key: "proposal.financing.cash" },
              { icon: "🏦", name: "Loan Financing", enabled: true, key: "proposal.financing.loan" },
              { icon: "📋", name: "Lease Agreement", enabled: true, key: "proposal.financing.lease" },
              { icon: "⚡", name: "PPA", enabled: true, key: "proposal.financing.ppa" },
            ].map((opt, i) => (
              <div key={i} style={{ padding: 16, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.orangeGlow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><span style={{ fontSize: 20 }}>{opt.icon}</span><span style={{ fontSize: 13, fontWeight: 600 }}>{opt.name}</span></div>
                <Toggle value={opt.enabled} label="Enabled" settingKey={opt.key} />
              </div>
            ))}
          </div>
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>External Connections</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 16, borderRadius: 10, border: `2px dashed ${COLORS.border}`, textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>🔗</div><div style={{ fontSize: 13, fontWeight: 600 }}>Link Proposal Tool</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>SolarEdge, Enphase, Aurora, etc.</div>
            </div>
            <div style={{ padding: 16, borderRadius: 10, border: `2px dashed ${COLORS.border}`, textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>📄</div><div style={{ fontSize: 13, fontWeight: 600 }}>Upload Price Sheet</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>PDF, CSV, or Excel pricing</div>
            </div>
          </div>
        </div>
      </div>

      {/* New Proposal Modal */}
      {showNewProposal && (
        <div style={S.modal} onClick={() => setShowNewProposal(false)}>
          <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>New Proposal</h3>
            <p style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 20 }}>Create a proposal for a lead.</p>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Customer (Lead) *</label>
              <select style={{ ...S.select, width: "100%" }} value={newProposalForm.leadId} onChange={(e) => setNewProposalForm(f => ({ ...f, leadId: e.target.value }))}>
                <option value="">Select a lead…</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.name || `${l.firstName} ${l.lastName}`}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>System / Title *</label>
              <input style={S.input} placeholder="e.g. 8.4kW Solar + Battery" value={newProposalForm.title} onChange={(e) => setNewProposalForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 4 }}>Cash Price ($)</label>
              <input style={S.input} type="number" placeholder="28500" value={newProposalForm.amount} onChange={(e) => setNewProposalForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            {newProposalError && <div style={{ padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}44`, color: COLORS.red, fontSize: 13, marginBottom: 14 }}>{newProposalError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button style={S.btn("ghost")} onClick={() => setShowNewProposal(false)}>Cancel</button>
              <button style={S.btn("primary")} disabled={newProposalSaving} onClick={async () => {
                if (!newProposalForm.leadId || !newProposalForm.title.trim()) {
                  setNewProposalError("Customer and title are required.");
                  return;
                }
                setNewProposalSaving(true);
                setNewProposalError(null);
                try {
                  await proposalsApi.create({ leadId: parseInt(newProposalForm.leadId), title: newProposalForm.title, amount: newProposalForm.amount ? parseInt(newProposalForm.amount) : null, status: "sent" });
                  setShowNewProposal(false);
                  fetchProposals();
                } catch (err) {
                  setNewProposalError(err.message || "Failed to create proposal.");
                } finally {
                  setNewProposalSaving(false);
                }
              }}>{newProposalSaving ? "Creating…" : "Create Proposal"}</button>
            </div>
          </div>
        </div>
      )}

      {/* FEATURE 4: White-Labeled Proposal Viewer */}
      {selectedProposal && (
        <div style={S.modal} onClick={() => setSelectedProposal(null)}>
          <div style={{ ...S.modalContent, maxWidth: 700, background: "#fff", color: "#1a1a1a" }} onClick={(e) => e.stopPropagation()}>
            {/* White-labeled header with client branding */}
            <div style={{ textAlign: "center", marginBottom: 24, borderBottom: `3px solid ${whiteLabel.primaryColor}`, paddingBottom: 20 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: whiteLabel.primaryColor }}>{whiteLabel.companyName}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Custom Solar Energy Proposal</div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Prepared for {selectedProposal.customer} · {selectedProposal.created}</div>
            </div>

            <div style={{ background: `linear-gradient(135deg, ${whiteLabel.primaryColor}15, transparent)`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", marginBottom: 12 }}>☀️ Recommended: {selectedProposal.system}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {[
                  { label: "Annual Savings", value: "$2,840", icon: "💰" },
                  { label: "25-Year Savings", value: "$71,000+", icon: "📈" },
                  { label: "CO₂ Offset", value: "8.2 tons/yr", icon: "🌿" },
                ].map((s, i) => (
                  <div key={i} style={{ textAlign: "center", padding: 12, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <div style={{ fontSize: 18 }}>{s.icon}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: whiteLabel.primaryColor }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { title: "Cash Purchase", price: `$${selectedProposal.cashPrice.toLocaleString()}`, sub: "Best value — full ownership", highlight: true },
                { title: "Loan Financing", price: `$${selectedProposal.loanPayment}/mo`, sub: "25-year warranty included" },
                { title: "Lease", price: `$${selectedProposal.leasePayment}/mo`, sub: "$0 down, maintenance included" },
              ].map((opt, i) => (
                <div key={i} style={{
                  padding: 20, borderRadius: 10, textAlign: "center", cursor: "pointer",
                  border: `2px solid ${opt.highlight ? whiteLabel.primaryColor : "#e0e0e0"}`,
                  background: opt.highlight ? `${whiteLabel.primaryColor}10` : "#fafafa",
                }}>
                  {opt.highlight && <div style={{ fontSize: 10, fontWeight: 700, color: whiteLabel.primaryColor, marginBottom: 8, textTransform: "uppercase" }}>Most Popular</div>}
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{opt.title}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: whiteLabel.primaryColor }}>{opt.price}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{opt.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 20 }}>
              <button style={{ ...S.btn("success"), background: whiteLabel.primaryColor }}>✅ Accept & Pay Deposit</button>
              <button style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${whiteLabel.primaryColor}`, background: "transparent", color: whiteLabel.primaryColor, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>📧 Email to Customer</button>
              <button style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #ddd", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }} onClick={() => setSelectedProposal(null)}>Close</button>
            </div>

            {/* Subtle Catalyst footer */}
            <div style={{ textAlign: "center", paddingTop: 16, borderTop: "1px solid #eee" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: 0.4 }}>
                <svg width={14} height={14} viewBox="0 0 100 100"><polygon points="50,5 61,35 95,35 68,55 78,88 50,68 22,88 32,55 5,35 39,35" fill="#d35400" /></svg>
                <span style={{ fontSize: 10, color: "#999" }}>Powered by Catalyst · Leviosai, Inc.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// VOICE AI
// ============================================================
function VoiceAIPage() {
  const navigate = useNavigate();
  const [voices, setVoices]                   = useState([]);
  const [voicesLoading, setVoicesLoading]     = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [savingVoice, setSavingVoice]         = useState(false);
  const [voiceSaved, setVoiceSaved]           = useState(false);
  const [playingId, setPlayingId]             = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    setVoicesLoading(true);
    Promise.all([callApi.getVoices(), sdrApi.getConfig()])
      .then(([vList, cfg]) => {
        setVoices(vList || []);
        if (cfg?.assistantVoiceId) setSelectedVoiceId(cfg.assistantVoiceId);
        else if (vList?.length) setSelectedVoiceId(vList[0].id);
      })
      .catch(() => {})
      .finally(() => setVoicesLoading(false));
  }, []);

  const playPreview = (voiceId, url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingId === voiceId) { setPlayingId(null); return; }
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(voiceId);
    audio.play().catch(() => setPlayingId(null));
    audio.onended = () => setPlayingId(null);
  };

  const saveVoice = async () => {
    if (!selectedVoiceId) return;
    setSavingVoice(true);
    try {
      await sdrApi.saveVoice(selectedVoiceId);
      setVoiceSaved(true);
      setTimeout(() => setVoiceSaved(false), 3000);
    } catch {}
    setSavingVoice(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Voice AI</h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
          Choose the ElevenLabs voice for outbound AI calls. Conversation behavior is a single system prompt — not separate talk-track or objection modules.
        </p>
      </div>

      <div style={{
        ...S.card,
        marginBottom: 16,
        padding: 14,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.surfaceAlt,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Single-prompt agent</div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
          Opener, tone, objection handling, and booking goals all belong in one system prompt on the SDR Agent page.
          The live call agent loads that prompt only — there is no separate objection-handling UI or workflow.
        </div>
        <button type="button" style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }} onClick={() => navigate("/sdr")}>
          Edit system prompt on SDR Agent →
        </button>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={S.cardHeader}>AI Voice</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>Select the ElevenLabs voice your AI agent will use on calls. Click ▶ to preview.</div>
          </div>
          <button
            type="button"
            style={{ ...S.btn("primary"), padding: "8px 20px", opacity: savingVoice ? 0.6 : 1 }}
            onClick={saveVoice}
            disabled={savingVoice || !selectedVoiceId}
          >
            {voiceSaved ? "✓ Saved" : savingVoice ? "Saving…" : "Save Voice"}
          </button>
        </div>

        {voicesLoading ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 0" }}>Loading voices from ElevenLabs…</div>
        ) : voices.length === 0 ? (
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "12px 0" }}>No voices found. Check that ELEVENLABS_API_KEY is set.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {voices.map(v => {
              const isSelected  = selectedVoiceId === v.id;
              const isPreviewing = playingId === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVoiceId(v.id)}
                  style={{
                    border: `2px solid ${isSelected ? COLORS.orange : COLORS.border}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                    background: isSelected ? COLORS.orangeGlow : COLORS.surfaceAlt,
                    display: "flex", alignItems: "center", gap: 12,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); playPreview(v.id, v.previewUrl); }}
                    style={{
                      width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: isPreviewing ? COLORS.red : isSelected ? COLORS.orange : COLORS.border,
                      color: "#fff", fontSize: 13, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    title={isPreviewing ? "Stop" : "Preview"}
                  >
                    {isPreviewing ? "■" : "▶"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                    <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", marginTop: 2 }}>{v.id.slice(0, 22)}…</div>
                  </div>
                  {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.orange, flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CONVERSATION REPLAY (Dedicated Page) — Feature 2
// ============================================================
function ConversationReplayPage() {
  const allConvos = SAMPLE_LEADS.flatMap(l => l.conversations.map(c => ({ ...c, leadName: l.name, leadId: l.id })));
  const [filterType, setFilterType] = useState("All");
  const [selected, setSelected] = useState(null);

  const filtered = filterType === "All" ? allConvos : allConvos.filter(c => c.type === filterType.toLowerCase());
  const sentimentColors = { very_positive: COLORS.green, positive: COLORS.greenLight, neutral: COLORS.yellow, negative: COLORS.red };
  const outcomeLabels = { appointment_set: "Appt Set", confirmed: "Confirmed", deferred: "Deferred", no_response: "No Response", declined: "Declined" };
  const outcomeColors = { appointment_set: COLORS.green, confirmed: COLORS.green, deferred: COLORS.yellow, no_response: COLORS.textMuted, declined: COLORS.red };

  return (
    <div>
      <div style={{ marginBottom: 24 }}><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Conversation Replay</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>Review all AI conversations — learn what works, refine what doesn't</p></div>

      <div className="grid-stats" style={{ marginBottom: 24 }}>
        <StatCard label="Total Conversations" value={allConvos.length} color={COLORS.orange} icon="💬" />
        <StatCard label="Appointments Set" value={allConvos.filter(c => c.outcome === "appointment_set").length} color={COLORS.green} icon="📅" />
        <StatCard label="Avg Sentiment" value="Positive" color={COLORS.greenLight} icon="😊" />
        <StatCard label="Success Rate" value="60" suffix="%" color={COLORS.blue} icon="🎯" />
      </div>

      <TabBar tabs={["All", "Voice", "SMS", "Email"]} active={filterType} onChange={setFilterType} />

      <div style={S.card}>
        <div style={S.cardHeader}><span>All Conversations</span><span style={{ fontSize: 12, color: COLORS.textMuted }}>{filtered.length} conversations</span></div>
        <div className="table-responsive">
        <table style={S.table}>
          <thead><tr><th style={S.th}>Lead</th><th style={S.th}>Type</th><th style={S.th}>Date</th><th style={S.th} className="hide-mobile">Agent</th><th style={S.th} className="hide-mobile">Duration</th><th style={S.th}>Outcome</th><th style={S.th} className="hide-mobile">Sentiment</th><th style={S.th}>Action</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td style={S.td}><span style={{ fontWeight: 600 }}>{c.leadName}</span></td>
                <td style={S.td}>{c.type === "voice" ? "📞" : c.type === "sms" ? "💬" : "✉️"} {c.type}</td>
                <td style={S.td}>{c.date}</td>
                <td style={S.td} className="hide-mobile">{c.agent}</td>
                <td style={S.td} className="hide-mobile">{c.duration || "—"}</td>
                <td style={S.td}><span style={S.badge(outcomeColors[c.outcome])}>{outcomeLabels[c.outcome]}</span></td>
                <td style={S.td} className="hide-mobile"><span style={{ fontSize: 12, color: sentimentColors[c.sentiment] }}>{c.sentiment}</span></td>
                <td style={S.td}><button style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => setSelected(c)}>▶ Replay</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {selected && (
        <div style={S.modal} onClick={() => setSelected(null)}>
          <div style={{ ...S.modalContent, maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div><h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Conversation with {selected.leadName}</h3><div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>{selected.date} · {selected.type} · Agent: {selected.agent}</div></div>
              <button style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 16, maxHeight: 400, overflowY: "auto" }}>
              {selected.transcript.map((msg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: msg.role === "agent" ? "row" : "row-reverse", marginBottom: 12 }}>
                  <div style={{ maxWidth: "80%", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.6, background: msg.role === "agent" ? `${COLORS.orange}20` : `${COLORS.blue}20` }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: msg.role === "agent" ? COLORS.orange : COLORS.blue, marginBottom: 4, textTransform: "uppercase" }}>
                      {msg.role === "agent" ? `🤖 ${selected.agent} (AI)` : `👤 ${selected.leadName}`}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: 12, background: COLORS.orangeGlow, borderRadius: 8, border: `1px solid ${COLORS.orange}33` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.orangeLight, marginBottom: 4 }}>🧠 AI Analysis</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
                {selected.outcome === "appointment_set" ? "Successful conversion. Agent used value-first positioning and offered exactly 2 appointment options per protocol."
                  : selected.outcome === "confirmed" ? "Confirmation handled cleanly. AI disclosed identity, confirmed details, captured prep notes."
                  : "Recommend adjusting approach — try switching channel or timing for next attempt."}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CONNECT YOUR TECH — Integration Hub
// ============================================================
function ConnectTechPage() {
  const categories = Object.entries(INTEGRATION_CATEGORIES);
  const [activeTab, setActiveTab] = useState(categories[0][0]);
  const [connections, setConnections] = useState(integrationsService.getConnections());
  const [connectModal, setConnectModal] = useState(null);
  const [formData, setFormData] = useState({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);

  useEffect(() => {
    calendarApi.status().then(setCalendarStatus).catch(() => {});
  }, []);

  const totalConnected = Object.keys(connections).filter(k => connections[k]?.connected).length
    + (calendarStatus?.connections?.length || 0);
  const tabLabels = categories.map(([key, cat]) => cat.label);

  const isCalendarConnected = (integrationId) => {
    const provider = providerFromIntegrationId(integrationId);
    if (!provider) return false;
    return !!calendarStatus?.connections?.find((c) => c.provider === provider);
  };

  const handleConnect = async (integration) => {
    const provider = providerFromIntegrationId(integration.id);
    if (provider) {
      setOauthBusy(true);
      try {
        const { url } = await calendarApi.startOAuth(provider);
        window.location.href = url;
      } catch (err) {
        alert(err.message || "Could not start calendar OAuth");
        setOauthBusy(false);
      }
      return;
    }
    if (integration.authType === "oauth") {
      alert(`OAuth flow: In production, this redirects to ${integration.oauthUrl}`);
      return;
    }
    setFormData({});
    setTestResult(null);
    setConnectModal(integration);
  };

  const handleDisconnect = async (integrationId) => {
    const provider = providerFromIntegrationId(integrationId);
    if (provider) {
      try {
        const data = await calendarApi.disconnect(provider);
        setCalendarStatus(data);
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    integrationsService.disconnect(integrationId);
    setConnections(integrationsService.getConnections());
  };

  const handleSaveConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await integrationsService.testConnection(connectModal.id);
      if (result.success) {
        integrationsService.saveConnection(connectModal.id, formData);
        setConnections(integrationsService.getConnections());
        setTestResult({ success: true, message: "Connected successfully" });
        setTimeout(() => setConnectModal(null), 1200);
      } else {
        setTestResult({ success: false, message: result.message || "Connection failed" });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    }
    setTesting(false);
  };

  const activeCategory = INTEGRATION_CATEGORIES[activeTab];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Connect Your Tech</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {totalConnected} integration{totalConnected !== 1 ? "s" : ""} connected
          </p>
        </div>
        <div className="page-header-actions">
          <span style={S.badge(totalConnected > 0 ? COLORS.green : COLORS.textMuted)}>
            {totalConnected > 0 ? `${totalConnected} Active` : "None connected"}
          </span>
        </div>
      </div>

      {/* Status overview */}
      <div className="grid-stats" style={{ marginBottom: 24 }}>
        {categories.map(([key, cat]) => {
          const connected = cat.items.filter(i =>
            connections[i.id]?.connected || i.backendConfigured || isCalendarConnected(i.id)
          ).length;
          return (
            <StatCard key={key} label={cat.label} value={`${connected}/${cat.items.length}`} color={connected > 0 ? COLORS.green : COLORS.textMuted} icon={cat.items[0]?.icon || "🔌"} />
          );
        })}
      </div>

      <TabBar tabs={tabLabels} active={activeCategory?.label} onChange={(label) => {
        const entry = categories.find(([, cat]) => cat.label === label);
        if (entry) setActiveTab(entry[0]);
      }} />

      <div style={S.card}>
        <div style={S.cardHeader}>
          <span>{activeCategory?.label} Integrations</span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>
            {activeCategory?.items.filter(i =>
              connections[i.id]?.connected || i.backendConfigured || isCalendarConnected(i.id)
            ).length} connected
          </span>
        </div>
        <div className="integration-grid">
          {activeCategory?.items.filter(i => i.id !== "twilio").map((integration) => {
            const isConnected = connections[integration.id]?.connected || integration.backendConfigured || isCalendarConnected(integration.id);
            const isLiveCalendar = !!providerFromIntegrationId(integration.id);
            return (
              <div key={integration.id} className="integration-card" style={{
                border: `1px solid ${isConnected ? COLORS.green : COLORS.border}`,
                background: isConnected ? `${COLORS.green}08` : "transparent",
              }}>
                <div className="integration-card-info">
                  <span style={{ fontSize: 28 }}>{integration.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{integration.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>{integration.description}</div>
                    <div style={{ fontSize: 11 }}>
                      {isConnected ? (
                        <span style={{ color: COLORS.green, fontWeight: 600 }}>
                          {integration.backendConfigured
                            ? "✓ Configured via .env"
                            : isLiveCalendar
                              ? `✓ Connected${calendarStatus?.activeProvider === providerFromIntegrationId(integration.id) ? " · Active for bookings" : ""}`
                              : `✓ Connected ${connections[integration.id]?.connectedAt ? new Date(connections[integration.id].connectedAt).toLocaleDateString() : ""}`}
                        </span>
                      ) : (
                        <span style={{ color: COLORS.textDim }}>Not connected</span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {isConnected && !integration.backendConfigured && (
                    <button style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 11 }} onClick={() => handleDisconnect(integration.id)}>Disconnect</button>
                  )}
                  {!isConnected && (
                    <button style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12 }} disabled={oauthBusy} onClick={() => handleConnect(integration)}>
                      {oauthBusy && isLiveCalendar ? "…" : "Connect"}
                    </button>
                  )}
                  {isConnected && !isLiveCalendar && (
                    <button style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 11 }} onClick={() => handleConnect(integration)}>Configure</button>
                  )}
                  {isConnected && isLiveCalendar && calendarStatus?.activeProvider !== providerFromIntegrationId(integration.id) && (
                    <button
                      style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 11 }}
                      onClick={async () => {
                        const provider = providerFromIntegrationId(integration.id);
                        try {
                          await calendarApi.setActive(provider);
                          setCalendarStatus(await calendarApi.status());
                        } catch (err) {
                          alert(err.message);
                        }
                      }}
                    >
                      Use for bookings
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* API Keys & Webhook Info */}
      <div className="grid-2col">
        <div style={S.card}>
          <div style={S.cardHeader}>Webhook Endpoints</div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16 }}>Use these URLs to receive events from external services.</p>
          {[
            { label: "Inbound SMS", url: "/api/webhooks/twilio/sms", status: "active" },
            { label: "Call Status", url: "/api/webhooks/twilio/call-status", status: "active" },
            { label: "Stripe Billing", url: "/api/billing/webhook", status: "active" },
            { label: "Custom Events", url: "/api/reactor/emit", status: "active" },
          ].map((wh, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${COLORS.border}22` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{wh.label}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace" }}>{wh.url}</div>
              </div>
              <span style={S.badge(COLORS.green)}>{wh.status}</span>
            </div>
          ))}
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>Environment Configuration</div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16 }}>API keys and tokens configured via environment variables.</p>
          {[
            { key: "TWILIO_ACCOUNT_SID", status: "set" },
            { key: "TWILIO_AUTH_TOKEN", status: "set" },
            { key: "ANTHROPIC_API_KEY", status: "set" },
            { key: "RESEND_API_KEY", status: "set" },
            { key: "STRIPE_SECRET_KEY", status: "check" },
            { key: "DATABASE_URL", status: "set" },
          ].map((env, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}22` }}>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: COLORS.textMuted }}>{env.key}</span>
              <span style={{ fontSize: 11, color: env.status === "set" ? COLORS.green : COLORS.yellow, fontWeight: 600 }}>
                {env.status === "set" ? "✓ Set" : "⚠ Check"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Modal */}
      {connectModal && (
        <div style={S.modal} onClick={() => setConnectModal(null)}>
          <div style={{ ...S.modalContent, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 28 }}>{connectModal.icon}</span>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Connect {connectModal.name}</h3>
                </div>
                <p style={{ color: COLORS.textMuted, fontSize: 12, margin: 0 }}>{connectModal.description}</p>
              </div>
              <button style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={() => setConnectModal(null)}>✕</button>
            </div>

            {connectModal.authType === "oauth" ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
                  Click below to authorize Catalyst to access your {connectModal.name} account.
                </p>
                <button
                  style={{ ...S.btn("primary"), padding: "12px 32px" }}
                  disabled={oauthBusy}
                  onClick={() => handleConnect(connectModal)}
                >
                  Authorize with {connectModal.name}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {connectModal.fields?.map((field) => (
                  <div key={field.key}>
                    <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>{field.label}</label>
                    <input
                      style={S.input}
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      value={formData[field.key] || ""}
                      onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}

            {testResult && (
              <div style={{
                marginTop: 16, padding: 12, borderRadius: 8,
                background: testResult.success ? `${COLORS.green}15` : `${COLORS.red}15`,
                border: `1px solid ${testResult.success ? COLORS.green : COLORS.red}33`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: testResult.success ? COLORS.green : COLORS.red }}>
                  {testResult.success ? "✓ " : "✗ "}{testResult.message}
                </div>
              </div>
            )}

            {connectModal.authType !== "oauth" && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button style={S.btn("ghost")} onClick={() => setConnectModal(null)}>Cancel</button>
                <button
                  style={{ ...S.btn("primary"), opacity: testing ? 0.7 : 1 }}
                  onClick={handleSaveConnection}
                  disabled={testing}
                >
                  {testing ? "Testing..." : "Test & Connect"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// BILLING — with Features 1 & 5 + Stripe readiness
// ============================================================
// Sample invoice data used by both list & detail view
const INVOICE_LIST = [
  { id: "INV-2026-003", period: "Mar 2026", periodStart: "2026-03-01", periodEnd: "2026-03-31", issuedDate: "2026-04-01", dueDate: "2026-04-15", riivivAppts: 34, alivAppts: 12, riivivLeads: ["Marcus Johnson", "David Chen", "Patricia Williams", "Michael Brown", "Linda Martinez"], alivLeads: ["Sandra Wilson", "Jennifer Adams", "Robert Taylor"], noShows: 3, credits: 600, status: "Due" },
  { id: "INV-2026-002", period: "Feb 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28", issuedDate: "2026-03-01", dueDate: "2026-03-15", riivivAppts: 28, alivAppts: 10, riivivLeads: [], alivLeads: [], noShows: 2, credits: 400, status: "Paid" },
  { id: "INV-2026-001", period: "Jan 2026", periodStart: "2026-01-01", periodEnd: "2026-01-31", issuedDate: "2026-02-01", dueDate: "2026-02-15", riivivAppts: 24, alivAppts: 8, riivivLeads: [], alivLeads: [], noShows: 1, credits: 200, status: "Paid" },
  { id: "INV-2025-012", period: "Dec 2025", periodStart: "2025-12-01", periodEnd: "2025-12-31", issuedDate: "2026-01-01", dueDate: "2026-01-15", riivivAppts: 20, alivAppts: 8, riivivLeads: [], alivLeads: [], noShows: 0, credits: 0, status: "Paid" },
];

function computeInvoiceTotals(inv) {
  const RIIVIV_RATE = 400, ALIV_RATE = 500, MAINT = 750;
  const riivivSubtotal = inv.riivivAppts * RIIVIV_RATE;
  const alivSubtotal = inv.alivAppts * ALIV_RATE;
  const subtotal = riivivSubtotal + alivSubtotal + MAINT;
  const total = subtotal - inv.credits;
  return { riivivSubtotal, alivSubtotal, maintenance: MAINT, subtotal, credits: inv.credits, total, riivivRate: RIIVIV_RATE, alivRate: ALIV_RATE };
}

function InvoiceDetailPage({ invoice, onBack, onPay }) {
  const totals = computeInvoiceTotals(invoice);
  const statusColor = invoice.status === "Paid" ? COLORS.green : invoice.status === "Due" ? COLORS.orange : COLORS.yellow;

  const handlePrint = () => window.print();

  const handleDownload = () => {
    // Build a printable HTML doc and trigger browser download via Blob
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${invoice.id}</title>
      <style>body{font-family:-apple-system,sans-serif;padding:40px;color:#111} h1{color:#e67e22} table{width:100%;border-collapse:collapse;margin:20px 0} th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left} .total{font-size:20px;font-weight:700;color:#e67e22}</style>
      </head><body>
      <h1>Leviosai — Invoice ${invoice.id}</h1>
      <p><strong>Period:</strong> ${invoice.period}<br/><strong>Issued:</strong> ${invoice.issuedDate}<br/><strong>Due:</strong> ${invoice.dueDate}<br/><strong>Status:</strong> ${invoice.status}</p>
      <table>
        <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
        <tr><td>Monthly Maintenance</td><td>1</td><td>$${totals.maintenance}</td><td>$${totals.maintenance}</td></tr>
        <tr><td>riivīv appointments</td><td>${invoice.riivivAppts}</td><td>$${totals.riivivRate}</td><td>$${totals.riivivSubtotal.toLocaleString()}</td></tr>
        <tr><td>alīv appointments</td><td>${invoice.alivAppts}</td><td>$${totals.alivRate}</td><td>$${totals.alivSubtotal.toLocaleString()}</td></tr>
        <tr><td colspan="3" style="text-align:right">Subtotal</td><td>$${totals.subtotal.toLocaleString()}</td></tr>
        <tr><td colspan="3" style="text-align:right">Show-Up Guarantee Credits (${invoice.noShows} no-shows × $200)</td><td>-$${totals.credits}</td></tr>
        <tr><td colspan="3" style="text-align:right" class="total">TOTAL DUE</td><td class="total">$${totals.total.toLocaleString()}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:40px">Leviosai, Inc. · christian@leviosai.io · Part of The Reaction Stack</p>
      </body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.id}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", animation: "fadeInUp 0.3s ease-out" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <button onClick={onBack} style={{ ...S.btn("ghost"), fontSize: 13 }}>← Back to Billing</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleDownload} style={S.btn("secondary")}>⬇ Download</button>
          <button onClick={handlePrint} style={S.btn("secondary")}>🖨 Print</button>
          {invoice.status === "Due" && <button onClick={onPay} style={S.btn("primary")}>Pay Now</button>}
        </div>
      </div>

      <div style={{ background: "#fff", color: "#111", borderRadius: 16, padding: "48px 56px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 48, borderBottom: "2px solid #f0f0f0", paddingBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <svg width="40" height="40" viewBox="0 0 100 100">
                <defs><linearGradient id="invLogo" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f39c12" /><stop offset="100%" stopColor="#d35400" /></linearGradient></defs>
                <polygon points="50,5 61,35 95,35 68,55 78,88 50,68 22,88 32,55 5,35 39,35" fill="url(#invLogo)" />
              </svg>
              <div style={{ fontSize: 28, fontWeight: 700, background: "linear-gradient(135deg, #f39c12, #d35400)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: -0.5 }}>catalyst</div>
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Leviosai, Inc.</div>
            <div style={{ fontSize: 11, color: "#999" }}>christian@leviosai.io</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#e67e22", letterSpacing: -0.5 }}>INVOICE</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{invoice.id}</div>
            <div style={{ display: "inline-block", marginTop: 8, padding: "4px 12px", borderRadius: 20, background: `${statusColor}20`, color: statusColor, fontSize: 12, fontWeight: 700 }}>{invoice.status.toUpperCase()}</div>
          </div>
        </div>

        {/* Bill To / Dates */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 36 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.2, marginBottom: 8 }}>BILLED TO</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>SunPower Solar Solutions</div>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginTop: 4 }}>
              123 Solar Ave<br />Austin, TX 78701<br />info@sunpowersolar.com
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.2, marginBottom: 8 }}>INVOICE DETAILS</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: 12 }}>
              <span style={{ color: "#999" }}>Period:</span><span style={{ fontWeight: 600 }}>{invoice.period}</span>
              <span style={{ color: "#999" }}>Issued:</span><span>{invoice.issuedDate}</span>
              <span style={{ color: "#999" }}>Due Date:</span><span style={{ fontWeight: 600 }}>{invoice.dueDate}</span>
            </div>
          </div>
        </div>

        {/* Line items table */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Description</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Qty</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Rate</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "16px", fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>Monthly Maintenance</div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Platform access, AI infrastructure, support</div>
              </td>
              <td style={{ padding: "16px", textAlign: "center", fontSize: 13 }}>1</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13 }}>${totals.maintenance.toLocaleString()}</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13, fontWeight: 600 }}>${totals.maintenance.toLocaleString()}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "16px", fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "#e67e22" }}>riivīv appointments <span style={{ fontSize: 10, color: "#999", fontWeight: 400 }}>(Dead Lead Revival)</span></div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Qualified appointments from revived leads</div>
              </td>
              <td style={{ padding: "16px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{invoice.riivivAppts}</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13 }}>${totals.riivivRate}</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13, fontWeight: 600 }}>${totals.riivivSubtotal.toLocaleString()}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "16px", fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "#1abc9c" }}>alīv appointments <span style={{ fontSize: 10, color: "#999", fontWeight: 400 }}>(New Lead Engine)</span></div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Qualified appointments from newly-generated leads</div>
              </td>
              <td style={{ padding: "16px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{invoice.alivAppts}</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13 }}>${totals.alivRate}</td>
              <td style={{ padding: "16px", textAlign: "right", fontSize: 13, fontWeight: 600 }}>${totals.alivSubtotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
          <div style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, color: "#666" }}>
              <span>Subtotal</span><span>${totals.subtotal.toLocaleString()}</span>
            </div>
            {invoice.credits > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, color: "#1abc9c" }}>
                <span>🛡 Show-Up Guarantee Credits ({invoice.noShows} × $200)</span>
                <span>-${invoice.credits.toLocaleString()}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 8px", borderTop: "2px solid #111", marginTop: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{invoice.status === "Paid" ? "AMOUNT PAID" : "TOTAL DUE"}</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#e67e22" }}>${totals.total.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Breakdown: specific leads */}
        {(invoice.riivivLeads?.length || invoice.alivLeads?.length) > 0 && (
          <div style={{ borderTop: "1px solid #eee", paddingTop: 24, marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 1.2, marginBottom: 12 }}>APPOINTMENT BREAKDOWN</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e67e22", marginBottom: 8 }}>riivīv ({invoice.riivivAppts} appts)</div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.8 }}>
                  {invoice.riivivLeads?.length ? invoice.riivivLeads.join(" · ") + (invoice.riivivAppts > invoice.riivivLeads.length ? ` +${invoice.riivivAppts - invoice.riivivLeads.length} more` : "") : "Details available on request"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1abc9c", marginBottom: 8 }}>alīv ({invoice.alivAppts} appts)</div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.8 }}>
                  {invoice.alivLeads?.length ? invoice.alivLeads.join(" · ") + (invoice.alivAppts > invoice.alivLeads.length ? ` +${invoice.alivAppts - invoice.alivLeads.length} more` : "") : "Details available on request"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: "1px solid #eee", paddingTop: 24, marginTop: 32, textAlign: "center", fontSize: 11, color: "#999" }}>
          <div>Thank you for your business! Questions? Email <a href="mailto:christian@leviosai.io" style={{ color: "#e67e22" }}>christian@leviosai.io</a></div>
          <div style={{ marginTop: 4 }}>Leviosai, Inc. · Part of The Reaction Stack</div>
        </div>
      </div>
    </div>
  );
}

// In-app Update Payment Method modal form
function PaymentMethodModal({ onClose, onSave }) {
  const [form, setForm] = useState({ cardNumber: "", name: "", expiry: "", cvc: "", zip: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const formatCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  const formatExp = (v) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const digits = form.cardNumber.replace(/\s/g, "");
    if (digits.length < 15) return setError("Please enter a valid card number.");
    if (!/^\d{2}\/\d{2}$/.test(form.expiry)) return setError("Expiry must be MM/YY.");
    if (!/^\d{3,4}$/.test(form.cvc)) return setError("CVC must be 3 or 4 digits.");
    if (!form.name.trim()) return setError("Cardholder name is required.");
    setSaving(true);
    try {
      const res = await fetch("/api/billing/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("catalyst_token")}` },
        body: JSON.stringify({
          last4: digits.slice(-4),
          brand: digits.startsWith("4") ? "Visa" : digits.startsWith("5") ? "Mastercard" : digits.startsWith("3") ? "Amex" : "Card",
          expMonth: parseInt(form.expiry.split("/")[0]),
          expYear: 2000 + parseInt(form.expiry.split("/")[1]),
          name: form.name,
          zip: form.zip,
        }),
      });
      // Even if backend endpoint doesn't exist, treat as success for demo
      const data = res.ok ? await res.json() : {
        last4: digits.slice(-4),
        brand: digits.startsWith("4") ? "Visa" : digits.startsWith("5") ? "Mastercard" : "Card",
        expMonth: parseInt(form.expiry.split("/")[0]),
        expYear: 2000 + parseInt(form.expiry.split("/")[1]),
      };
      onSave(data);
      onClose();
    } catch (err) {
      setError("Could not save payment method. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={{ ...S.modalContent, maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Update Payment Method</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 22 }}>✕</button>
        </div>
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 20 }}>🔒 Your card info is encrypted in transit.</p>

        {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: `${COLORS.red}22`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Card Number</label>
            <input style={S.input} placeholder="1234 5678 9012 3456" value={form.cardNumber}
              onChange={(e) => setForm({ ...form, cardNumber: formatCard(e.target.value) })} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Cardholder Name</label>
            <input style={S.input} placeholder="John Owner" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Expiry</label>
              <input style={S.input} placeholder="MM/YY" value={form.expiry}
                onChange={(e) => setForm({ ...form, expiry: formatExp(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>CVC</label>
              <input style={S.input} placeholder="123" value={form.cvc}
                onChange={(e) => setForm({ ...form, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>ZIP</label>
              <input style={S.input} placeholder="78701" value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ ...S.btn("secondary"), flex: 1 }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...S.btn("primary"), flex: 1, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : "Save Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BillingPage() {
  const [billingData, setBillingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Overview");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState({ brand: "Visa", last4: "4242", expMonth: 12, expYear: 2027 });

  useEffect(() => {
    // Try real API first, fall back to mock
    fetch("/api/billing", {
      headers: { Authorization: `Bearer ${localStorage.getItem("catalyst_token")}` },
    }).then(r => r.ok ? r.json() : MOCK_BILLING)
      .then(setBillingData)
      .catch(() => setBillingData(MOCK_BILLING))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading billing..." />;

  // If viewing a specific invoice, render detail page instead
  if (selectedInvoice) {
    return (
      <InvoiceDetailPage
        invoice={selectedInvoice}
        onBack={() => setSelectedInvoice(null)}
        onPay={() => alert(`Processing payment for ${selectedInvoice.id}... (Stripe integration needed)`)}
      />
    );
  }

  const currentInvoice = INVOICE_LIST[0];
  const totalsCurrent = computeInvoiceTotals(currentInvoice);
  const noShowCredits = totalsCurrent.credits;
  const invoiceTotal = totalsCurrent.total;

  return (
    <div>
      <div className="page-header">
        <div><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Billing & Subscription</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>Manage your plan, invoices, and payment methods</p></div>
        <div className="page-header-actions">
          <button style={S.btn("secondary")} onClick={async () => {
            try {
              const res = await fetch("/api/billing/portal", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("catalyst_token")}` },
                body: JSON.stringify({ returnUrl: window.location.href }),
              });
              const data = await res.json();
              if (data.url) window.location.href = data.url;
              else alert("Stripe portal not configured yet. Set STRIPE_SECRET_KEY in environment.");
            } catch { alert("Stripe not configured. Add STRIPE_SECRET_KEY to connect billing."); }
          }}>Manage in Stripe</button>
        </div>
      </div>

      <TabBar tabs={["Overview", "Invoices", "Plans"]} active={activeTab} onChange={setActiveTab} />

      {activeTab === "Overview" && (
        <>
          <div className="grid-stats" style={{ marginBottom: 24 }}>
            <StatCard label="Current Plan" value="Growth" color={COLORS.orange} icon="⭐" />
            <StatCard label="This Month" value={`$${invoiceTotal.toLocaleString()}`} color={COLORS.blue} icon="💰" />
            <StatCard label="No-Show Credits" value={`$${noShowCredits}`} color={COLORS.teal} icon="🛡️" />
            <StatCard label="Total Appointments" value="46" color={COLORS.green} icon="📅" />
          </div>

          <div className="grid-2col" style={{ marginBottom: 20 }}>
            <div style={S.card}>
              <div style={S.cardHeader}>Current Plan</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.orangeLight }}>Growth Tier</div><div style={{ fontSize: 12, color: COLORS.textMuted }}>riivīv + alīv Bundle</div></div>
                <span style={S.badge(COLORS.green)}>Active</span>
              </div>
              {[
                ["Setup Fee (paid)", "$3,500.00"], ["Monthly Maintenance", "$750.00"],
                ["riivīv per appointment", "$400.00"], ["alīv per appointment", "$500.00"],
                ["Bundle discount", "Single maintenance fee"],
                ["Show-Up Guarantee", "$200 credit per no-show"],
              ].map(([l, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}22` }}>
                  <span style={{ fontSize: 13, color: COLORS.textMuted }}>{l}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: l.includes("Guarantee") ? COLORS.teal : COLORS.text }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={S.cardHeader}>Payment Method</div>
              <div style={{ padding: 20, borderRadius: 10, border: `1px solid ${COLORS.border}`, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>💳</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{paymentMethod.brand} ending in {paymentMethod.last4}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>Expires {String(paymentMethod.expMonth).padStart(2, "0")}/{paymentMethod.expYear}</div>
                  </div>
                </div>
              </div>
              <button style={{ ...S.btn("secondary"), width: "100%" }} onClick={() => setShowPaymentModal(true)}>Update Payment Method</button>
              <div style={{ marginTop: 16, padding: 14, background: `${COLORS.teal}10`, borderRadius: 8, border: `1px solid ${COLORS.teal}33` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, marginBottom: 4 }}>🛡️ Show-Up Guarantee Active</div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>3 no-shows this month = <strong style={{ color: COLORS.teal }}>${noShowCredits}</strong> in credits auto-applied.</div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "Invoices" && (
        <div style={S.card}>
          <div style={S.cardHeader}><span>Invoice History</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>Click any row to view the invoice</span></div>
          <div className="table-responsive">
          <table style={S.table}>
            <thead><tr><th style={S.th}>Invoice #</th><th style={S.th}>Period</th><th style={S.th}>Appointments</th><th style={S.th}>Credits</th><th style={S.th}>Total</th><th style={S.th}>Status</th><th style={S.th}>Action</th></tr></thead>
            <tbody>
              {INVOICE_LIST.map((inv) => {
                const t = computeInvoiceTotals(inv);
                return (
                  <tr key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      style={{ cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = COLORS.orangeGlow}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <td style={S.td}><span style={{ fontFamily: "monospace", fontSize: 12, color: COLORS.orange }}>{inv.id}</span></td>
                    <td style={S.td}><span style={{ fontWeight: 600 }}>{inv.period}</span></td>
                    <td style={S.td}><span style={{ fontSize: 12 }}>{inv.riivivAppts + inv.alivAppts} <span style={{ color: COLORS.textMuted, fontSize: 11 }}>({inv.riivivAppts}r · {inv.alivAppts}a)</span></span></td>
                    <td style={S.td}><span style={{ color: inv.credits > 0 ? COLORS.teal : COLORS.textMuted }}>{inv.credits > 0 ? `-$${inv.credits}` : "—"}</span></td>
                    <td style={S.td}><span style={{ fontWeight: 600 }}>${t.total.toLocaleString()}</span></td>
                    <td style={S.td}><span style={S.badge(inv.status === "Paid" ? COLORS.green : COLORS.orange)}>{inv.status}</span></td>
                    <td style={S.td} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setSelectedInvoice(inv)} style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11 }}>View →</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <PaymentMethodModal
          onClose={() => setShowPaymentModal(false)}
          onSave={(pm) => setPaymentMethod(pm)}
        />
      )}

      {activeTab === "Plans" && (
        <div style={S.card}>
          <div style={S.cardHeader}>Available Plans</div>
          <div className="grid-3col">
            {[0, 1, 2].map((tier) => (
              <div key={tier} style={{ padding: 24, borderRadius: 12, textAlign: "center", border: `2px solid ${tier === 1 ? COLORS.orange : COLORS.border}`, background: tier === 1 ? COLORS.orangeGlow : "transparent" }}>
                {tier === 1 && <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.orange, marginBottom: 8, textTransform: "uppercase" }}>Current Plan</div>}
                <div style={{ fontSize: 18, fontWeight: 700 }}>{TIERS.riiviv.tierNames[tier]}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.orangeLight, margin: "12px 0" }}>${TIERS.riiviv.setup[tier].toLocaleString()}</div>
                <div style={{ fontSize: 12, color: COLORS.textMuted }}>Setup Fee</div>
                <div style={{ margin: "16px 0", height: 1, background: COLORS.border }} />
                <div style={{ fontSize: 13, marginBottom: 4 }}>${TIERS.riiviv.maintenance[tier]}/mo maintenance</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>$400/appt (riivīv) · $500/appt (alīv)</div>
                <div style={{ fontSize: 12, color: COLORS.green, marginTop: 8 }}>Bundle: 1 maintenance fee</div>
                <div style={{ fontSize: 12, color: COLORS.teal, marginTop: 4 }}>🛡️ $200 no-show credit</div>
                <button
                  disabled={tier === 1}
                  onClick={async () => {
                    if (tier === 1) return;
                    const action = tier === 0 ? "downgrade" : "upgrade";
                    if (!confirm(`Confirm ${action} to ${TIERS.riiviv.tierNames[tier]} plan?`)) return;
                    try {
                      const res = await fetch("/api/billing/checkout", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("catalyst_token")}` },
                        body: JSON.stringify({ tier: TIERS.riiviv.tierNames[tier].toLowerCase() }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (data.url) { window.location.href = data.url; return; }
                      alert(`${action.charAt(0).toUpperCase() + action.slice(1)} requested — our team will reach out to finalize the plan change.`);
                    } catch {
                      alert(`${action.charAt(0).toUpperCase() + action.slice(1)} requested — our team will reach out to finalize the plan change.`);
                    }
                  }}
                  style={{ ...S.btn(tier === 1 ? "secondary" : "primary"), width: "100%", marginTop: 16, opacity: tier === 1 ? 0.7 : 1, cursor: tier === 1 ? "default" : "pointer" }}>
                  {tier === 1 ? "Current Plan" : tier === 0 ? "Downgrade" : "Upgrade"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETTINGS — Full Configuration Hub
// ============================================================
function SettingsPage() {
  const location = useLocation();
  const initialTab = new URLSearchParams(location.search).get("tab") || "Company";
  const [activeTab, setActiveTab] = useState(
    ["Company", "Team", "Notifications", "AI Preferences", "Security"].includes(initialTab)
      ? initialTab
      : "Company"
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div className="page-header">
        <div><h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Settings</h2><p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>Manage your workspace, team, and preferences</p></div>
        <div className="page-header-actions">
          {saved && <span style={{ fontSize: 12, color: COLORS.green, fontWeight: 600 }}>✓ Saved</span>}
          <button style={S.btn("primary")} onClick={handleSave}>Save Changes</button>
        </div>
      </div>

      <TabBar tabs={["Company", "Team", "Notifications", "AI Preferences", "Security"]} active={activeTab} onChange={setActiveTab} />

      {activeTab === "Company" && (
        <>
          <div style={S.card}>
            <div style={S.cardHeader}>Company Profile</div>
            <div className="grid-2col">
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Company Name</label><input style={S.input} defaultValue="SunPower Solar Solutions" /></div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Industry</label><select style={{ ...S.select, width: "100%" }}>{INDUSTRIES.map(i => <option key={i}>{i}</option>)}</select></div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Phone</label><input style={S.input} defaultValue="(555) 100-2000" /></div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Email</label><input style={S.input} defaultValue="info@sunpowersolar.com" /></div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Website</label><input style={S.input} defaultValue="https://sunpowersolar.com" /></div>
              <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Address</label><input style={S.input} defaultValue="123 Solar Ave, Austin, TX 78701" /></div>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.cardHeader}>Branding</div>
            <div className="grid-2col">
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Company Logo</label>
                <div style={{ padding: 24, border: `2px dashed ${COLORS.border}`, borderRadius: 10, textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>Drop logo here or <span style={{ color: COLORS.orange }}>browse</span></div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 4 }}>PNG, JPG, SVG — Max 2MB</div>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Brand Color</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <input type="color" defaultValue="#e67e22" style={{ width: 48, height: 40, border: "none", borderRadius: 6, cursor: "pointer" }} />
                  <input style={S.input} defaultValue="#e67e22" />
                </div>
                <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Timezone</label>
                <select style={{ ...S.select, width: "100%" }}>
                  <option>America/Chicago (CST)</option>
                  <option>America/New_York (EST)</option>
                  <option>America/Los_Angeles (PST)</option>
                  <option>America/Denver (MST)</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "Team" && (
        <div style={S.card}>
          <div style={S.cardHeader}><span>Team Members</span><span style={{ fontSize: 12, color: COLORS.textMuted }}>3 members</span></div>
          <div className="table-responsive">
          <table style={S.table}>
            <thead><tr><th style={S.th}>Name</th><th style={S.th}>Email</th><th style={S.th}>Role</th><th style={S.th}>Status</th><th style={S.th}>Actions</th></tr></thead>
            <tbody>
              {[{ name: "John Owner", email: "john@sunpowersolar.com", role: "Admin" }, { name: "Mike Torres", email: "mike@sunpowersolar.com", role: "Sales Rep" }, { name: "Sarah Kim", email: "sarah@sunpowersolar.com", role: "Sales Rep" }].map((m, i) => (
                <tr key={i}>
                  <td style={S.td}><span style={{ fontWeight: 600 }}>{m.name}</span></td>
                  <td style={S.td}>{m.email}</td>
                  <td style={S.td}><span style={S.tag(m.role === "Admin" ? COLORS.orange : COLORS.blue)}>{m.role}</span></td>
                  <td style={S.td}><span style={S.badge(COLORS.green)}>Active</span></td>
                  <td style={S.td}><button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button style={{ ...S.btn("primary"), marginTop: 16 }}>+ Invite Team Member</button>
        </div>
      )}

      {activeTab === "Notifications" && (
        <div style={S.card}>
          <div style={S.cardHeader}>Notification Preferences</div>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Lead Notifications</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="New lead created" />
                <Toggle value={true} label="Lead score changed" />
                <Toggle value={true} label="Lead replied to outreach" />
                <Toggle value={false} label="Lead score decay warning" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Appointment Notifications</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="Appointment booked" />
                <Toggle value={true} label="Appointment confirmed" />
                <Toggle value={true} label="No-show detected" />
                <Toggle value={true} label="24-hour reminder" settingKey="notify.appt.reminder24h" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Campaign Notifications</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="Campaign completed" />
                <Toggle value={false} label="Daily campaign performance digest" />
                <Toggle value={true} label="Weekly summary email" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Delivery Method</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="In-app notifications" />
                <Toggle value={true} label="Email notifications" />
                <Toggle value={false} label="SMS notifications" />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "AI Preferences" && (
        <div style={S.card}>
          <div style={S.cardHeader}>AI Learning & Behavior</div>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Learning</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="Continuous learning from call outcomes" />
                <Toggle value={true} label="Auto-improve talk tracks" />
                <Toggle value={true} label="Industry-specific sales psychology" />
                <Toggle value={true} label="Auto-suggest upsell opportunities" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Lead Scoring</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="Automatic lead score decay over time" />
                <Toggle value={true} label="Market condition score boosting (utility rates, incentives)" />
                <Toggle value={true} label="Auto-score new leads on creation" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Outreach Behavior</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="AI generates follow-up messages automatically" />
                <Toggle value={true} label="Respect quiet hours (8am–9pm local time)" />
                <Toggle value={true} label="TCPA compliance enforcement" />
                <Toggle value={true} label="DNC list checking before outreach" />
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Model</div>
              <div style={{ padding: 14, background: COLORS.surfaceAlt, borderRadius: 8, fontSize: 12, color: COLORS.textMuted }}>
                Currently using <strong style={{ color: COLORS.orangeLight }}>Claude Sonnet 4</strong> (claude-sonnet-4-20250514) for lead scoring, message generation, and objection handling.
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "Security" && (
        <div style={S.card}>
          <div style={S.cardHeader}>Security & Access</div>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Authentication</div>
              <div className="grid-2col">
                <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Session Duration</label>
                  <select style={{ ...S.select, width: "100%" }}><option>7 days</option><option>1 day</option><option>30 days</option></select>
                </div>
                <div><label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Password Policy</label>
                  <select style={{ ...S.select, width: "100%" }}><option>Strong (8+ chars, mixed)</option><option>Standard (6+ chars)</option></select>
                </div>
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>API Access</div>
              <div style={{ padding: 14, background: COLORS.surfaceAlt, borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>API Key</div><div style={{ fontSize: 11, color: COLORS.textMuted }}>For external integrations and webhooks</div></div>
                  <button style={S.btn("secondary")}>Generate Key</button>
                </div>
              </div>
            </div>
            <div style={{ height: 1, background: COLORS.border }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Data & Privacy</div>
              <div style={{ display: "grid", gap: 10 }}>
                <Toggle value={true} label="Encrypt lead data at rest" />
                <Toggle value={true} label="Audit logging enabled" />
                <Toggle value={true} label="Auto-redact PII from AI logs" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SANDBOX — Interactive AI Conversation Demo
// ============================================================
function SandboxPage({ setPage }) {
  const [scenarios, setScenarios] = useState([]);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [agentActions, setAgentActions] = useState([]);
  const [lead, setLead] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("active");
  const [showEvents, setShowEvents] = useState(false);
  const [appointment, setAppointment] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [events, setEvents] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    sandboxApi.scenarios().then(r => setScenarios(r.scenarios || [])).catch(console.error);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startScenario = async (scenarioId) => {
    setLoading(true);
    setMessages([]);
    setAgentActions([]);
    setEvents([]);
    try {
      const res = await sandboxApi.createSession(scenarioId);
      setSession(res.session);
      setLead(res.session.lead);
      setSessionStatus("active");
      // Send first outbound
      const out = await sandboxApi.sendOutbound(res.session.id);
      setMessages([out.message]);
      setLead(out.lead);
      setEvents(out.events || []);
      setAgentActions(["sms-agent: Sent initial outreach"]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const startCustom = async () => {
    setLoading(true);
    setMessages([]);
    setAgentActions([]);
    setEvents([]);
    try {
      const res = await sandboxApi.createSession();
      setSession(res.session);
      setLead(res.session.lead);
      setSessionStatus("active");
      const out = await sandboxApi.sendOutbound(res.session.id);
      setMessages([out.message]);
      setLead(out.lead);
      setEvents(out.events || []);
      setAgentActions(["sms-agent: Sent initial outreach"]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const sendReply = async () => {
    if (!replyText.trim() || !session || loading) return;
    setLoading(true);
    const text = replyText;
    setReplyText("");
    try {
      const res = await sandboxApi.sendReply(session.id, text);
      const newMsgs = [...messages];
      // Add inbound message
      newMsgs.push({ direction: "inbound", content: text, timestamp: new Date(), channel: "sms" });
      // Add AI response if present
      if (res.aiResponse) {
        newMsgs.push(res.aiResponse);
      }
      setMessages(newMsgs);
      setLead(res.lead);
      setSessionStatus(res.sessionStatus);
      setAgentActions(res.agentActions || []);
      setEvents(prev => [...prev, ...(res.events || [])]);

      // Appointment booked — trigger celebration
      if (res.appointment) {
        setAppointment(res.appointment);
        setTimeout(() => setShowCelebration(true), 800);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const goToAppointments = () => {
    // Store the appointment ID so the Appointments tab can highlight it
    if (appointment?.id) {
      sessionStorage.setItem("highlight_appointment", String(appointment.id));
    }
    setPage("Appointments");
  };

  const reset = () => {
    setSession(null);
    setMessages([]);
    setAgentActions([]);
    setEvents([]);
    setLead(null);
    setSessionStatus("active");
    setReplyText("");
    setAppointment(null);
    setShowCelebration(false);
  };

  // No active session — show scenario picker
  if (!session) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Sandbox</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>See the Reactor in action — pick a scenario or start a free conversation.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
          {scenarios.map(s => (
            <div key={s.id} onClick={() => startScenario(s.id)} style={{
              ...S.card, cursor: "pointer", transition: "border-color 0.2s, transform 0.15s",
              border: `1px solid ${COLORS.border}`,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.orange; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5, marginBottom: 10 }}>{s.description}</div>
              <div style={{ fontSize: 11, color: COLORS.orange }}>{s.replyCount} conversation turn{s.replyCount !== 1 ? "s" : ""}</div>
            </div>
          ))}

          <div onClick={startCustom} style={{
            ...S.card, cursor: "pointer", transition: "border-color 0.2s, transform 0.15s",
            border: `1px dashed ${COLORS.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.orange; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>+</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Free Conversation</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>Type anything and see how the AI responds</div>
          </div>
        </div>
      </div>
    );
  }

  // Active session — show chat + agent panel
  const statusColors = { active: COLORS.green, appointment_proposed: COLORS.orange, appointment_set: COLORS.blue, opted_out: COLORS.red, completed: COLORS.teal, objection_loop: COLORS.yellow };
  const statusLabels = { active: "Active", appointment_proposed: "Time Proposed", appointment_set: "Appointment Set", opted_out: "Opted Out", completed: "Completed", objection_loop: "Handling Objection" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>AI Sandbox</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            Chatting with {lead?.firstName} {lead?.lastName} — {lead?.industry} lead
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: `${statusColors[sessionStatus] || COLORS.green}22`, color: statusColors[sessionStatus] || COLORS.green, fontWeight: 600 }}>
            {statusLabels[sessionStatus] || sessionStatus}
          </span>
          <button onClick={reset} style={{ background: COLORS.surface, color: COLORS.textMuted, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 16px", fontSize: 12, cursor: "pointer" }}>
            New Session
          </button>
        </div>
      </div>

      <div className="grid-sandbox">
        {/* Chat panel */}
        <div className="sandbox-chat" style={{ ...S.card, display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", minHeight: 500 }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.direction === "outbound" ? "flex-start" : "flex-end", marginBottom: 12, padding: "0 4px" }}>
                <div style={{
                  maxWidth: "75%", padding: "10px 14px", borderRadius: 14,
                  background: m.direction === "outbound" ? `${COLORS.orange}18` : COLORS.surfaceAlt,
                  border: `1px solid ${m.direction === "outbound" ? COLORS.orange + "33" : COLORS.border}`,
                }}>
                  <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, fontWeight: 600 }}>
                    {m.direction === "outbound" ? "Aria (AI)" : `${lead?.firstName}`}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.text }}>{m.content}</div>
                  {m.metadata?.intent && (
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 6 }}>
                      Detected: {m.metadata.sentiment} / {m.metadata.intent}
                      {m.metadata.objectionCategory && ` (${m.metadata.objectionCategory})`}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12, padding: "0 4px" }}>
                <div style={{ padding: "10px 14px", borderRadius: 14, background: `${COLORS.orange}18`, border: `1px solid ${COLORS.orange}33` }}>
                  <div style={{ fontSize: 13, color: COLORS.textMuted }}>Aria is typing...</div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          {(sessionStatus === "active" || sessionStatus === "appointment_proposed") ? (
            <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "12px 0 0", display: "flex", gap: 10 }}>
              <input
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendReply()}
                placeholder={sessionStatus === "appointment_proposed" ? "Confirm or reschedule the time..." : "Type a reply as the lead..."}
                style={{
                  flex: 1, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 10,
                  padding: "10px 14px", color: COLORS.text, fontSize: 13, outline: "none",
                }}
              />
              <button onClick={sendReply} disabled={loading || !replyText.trim()} style={{
                background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`,
                color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading || !replyText.trim() ? 0.5 : 1,
              }}>
                Send
              </button>
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "14px 0 0", textAlign: "center" }}>
              {sessionStatus === "appointment_set" && showCelebration && appointment ? (
                <div style={{
                  background: `linear-gradient(135deg, ${COLORS.green}18, ${COLORS.teal}18)`,
                  border: `1px solid ${COLORS.green}44`,
                  borderRadius: 14, padding: 20, textAlign: "center",
                  animation: "slideUp 0.5s ease-out",
                }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.green, marginBottom: 4 }}>Appointment Confirmed!</div>
                  <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 2 }}>{appointment.leadName}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.orange, marginBottom: 4 }}>
                    {new Date(appointment.scheduledAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at {new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 14 }}>{appointment.industry} consultation</div>
                  <button onClick={goToAppointments} style={{
                    background: `linear-gradient(135deg, ${COLORS.green}, ${COLORS.teal})`,
                    color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    boxShadow: `0 4px 16px ${COLORS.green}33`,
                  }}>
                    View in Appointments
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                  {sessionStatus === "opted_out" ? "Lead opted out — conversation ended" :
                   sessionStatus === "appointment_set" ? "Booking appointment..." :
                   sessionStatus === "appointment_proposed" ? "Waiting for lead to confirm time..." : "Session ended"}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent Intelligence Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Lead card */}
          {lead && (
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Lead Profile</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.8 }}>
                <div><strong style={{ color: COLORS.text }}>Name:</strong> {lead.firstName} {lead.lastName}</div>
                <div><strong style={{ color: COLORS.text }}>Industry:</strong> {lead.industry}</div>
                <div><strong style={{ color: COLORS.text }}>Score:</strong> <span style={{ color: lead.score >= 70 ? COLORS.green : lead.score >= 40 ? COLORS.yellow : COLORS.red, fontWeight: 600 }}>{lead.score}/100</span></div>
                <div><strong style={{ color: COLORS.text }}>Temp:</strong> <span style={{ color: lead.temperature === "hot" ? COLORS.red : lead.temperature === "warm" ? COLORS.yellow : COLORS.blue }}>{lead.temperature}</span></div>
                <div><strong style={{ color: COLORS.text }}>State:</strong> {lead.reactorState}</div>
                <div><strong style={{ color: COLORS.text }}>Attempts:</strong> {lead.outreachAttempts}</div>
              </div>
            </div>
          )}

          {/* Agent actions */}
          <div style={{ ...S.card, flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Agent Activity</div>
              <button onClick={() => setShowEvents(!showEvents)} style={{ background: "none", border: "none", color: COLORS.orange, fontSize: 11, cursor: "pointer" }}>
                {showEvents ? "Actions" : "Events"}
              </button>
            </div>
            {!showEvents ? (
              agentActions.map((a, i) => (
                <div key={i} style={{ fontSize: 11, color: COLORS.textMuted, padding: "6px 0", borderBottom: `1px solid ${COLORS.border}22`, lineHeight: 1.5 }}>
                  <span style={{ color: COLORS.orange, fontWeight: 600 }}>{a.split(":")[0]}:</span>
                  <span>{a.split(":").slice(1).join(":")}</span>
                </div>
              ))
            ) : (
              events.map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: COLORS.textMuted, padding: "6px 0", borderBottom: `1px solid ${COLORS.border}22`, lineHeight: 1.5 }}>
                  <div style={{ color: COLORS.teal, fontWeight: 600 }}>{e.type}</div>
                  <div>{e.description}</div>
                </div>
              ))
            )}
            {agentActions.length === 0 && !showEvents && (
              <div style={{ fontSize: 12, color: COLORS.textDim, textAlign: "center", padding: 20 }}>No activity yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Admin panel lives in pages/AdminPanel.jsx (Module 6 — plan §13.5)

// Onboarding wizard lives in pages/SDROnboarding.jsx (Module 5 — plan §13.4)

// ============================================================
// MAIN APP
// ============================================================
const PAGE_TO_PATH = {
  "Dashboard": "/",
  "Leads": "/leads",
  "Campaigns": "/campaigns",
  "Appointments": "/appointments",
  "Conversation Replay": "/replay",
  "Sandbox": "/sandbox",
  "Proposals & Sales": "/proposals",
  "SDR Agent": "/sdr",
  "AI Calling": "/calling",
  "Voice AI": "/voice-ai",
  "SMS Inbox": "/sdr-sms",
  "Email Inbox": "/sdr-email",
  "SDR Setup": "/sdr-setup",
  "Connect Your Tech": "/integrations",
  "Billing": "/billing",
  "Settings": "/settings",
  "Admin": "/admin",
};
const PATH_TO_PAGE = Object.fromEntries(Object.entries(PAGE_TO_PATH).map(([k, v]) => [v, k]));

export default function CatalystApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(
    () => !!localStorage.getItem(ONBOARDING_FLAG_KEY)
  );
  // Eagerly read role from stored token so route guards work on first render
  const [userRole, setUserRole] = useState(() => {
    try {
      const token = localStorage.getItem("catalyst_token");
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.role ?? null;
      }
    } catch { /* ignore */ }
    return null;
  });

  const leadDetailMatch = location.pathname.match(/^\/leads\/([^/]+)$/);
  const isLeadDetail = !!leadDetailMatch;
  const page = isLeadDetail ? "Leads" : (PATH_TO_PAGE[location.pathname] ?? "Dashboard");

  // Collapse main CRM rail when opening a lead; restore when leaving
  useEffect(() => {
    setSidebarCollapsed(isLeadDetail);
  }, [isLeadDetail]);

  useEffect(() => {
    if (isAuthenticated() && !user) {
      auth.me()
        .then((u) => {
          setUser(u);
          setUserRole(u.role ?? null);
          if (shouldShowOnboarding(u)) setNeedsOnboarding(true);
          else {
            clearOnboardingStorage();
            setNeedsOnboarding(false);
          }
        })
        .catch(() => { clearToken(); setLoggedIn(false); });
    }
  }, [loggedIn]);

  // When user object arrives from login/register with onboardingComplete
  useEffect(() => {
    if (!user) return;
    if (shouldShowOnboarding(user)) setNeedsOnboarding(true);
    else if (user.onboardingComplete === true) {
      clearOnboardingStorage();
      setNeedsOnboarding(false);
    }
  }, [user]);

  const handleLogout = () => { clearToken(); setLoggedIn(false); setUser(null); setUserRole(null); };

  const navigateTo = (pageName) => {
    navigate(PAGE_TO_PATH[pageName] ?? "/");
    setSidebarOpen(false);
  };

  // ── Logged-in users should not see signup ─────────────────────────────────
  if (loggedIn && location.pathname === "/register") {
    navigate("/");
    return null;
  }

  // ── Legacy /twilio → SDR Setup ─────────────────────────────────────────────
  if (location.pathname === "/twilio") {
    navigate("/sdr-setup", { replace: true });
    return null;
  }

  // ── /admin-login route — public, no auth required ──────────────────────────
  if (location.pathname === "/admin-login") {
    // Already logged in — wait for userRole to resolve before redirecting
    if (loggedIn && userRole === "admin") { navigate("/admin"); return null; }
    if (loggedIn && userRole !== null && userRole !== "admin") { navigate("/"); return null; }
    // loggedIn but role still null → hold, don't flash login form
    if (loggedIn && userRole === null) return null;
    return (
      <AdminLoginPage
        onLogin={(u) => {
          setUser(u);
          setLoggedIn(true);
          setUserRole(u.role);
        }}
      />
    );
  }

  // ── Unauthenticated users ───────────────────────────────────────────────────
  if (!loggedIn) {
    // Trying to hit /admin without a session → send to operator login
    if (location.pathname === "/admin") { navigate("/admin-login"); return null; }
    if (location.pathname === "/register") {
      return (
        <RegisterPage
          onRegister={(u) => {
            setUser(u);
            setLoggedIn(true);
            setUserRole(u.role);
            setNeedsOnboarding(true);
          }}
        />
      );
    }
    return <LoginPage onLogin={(u) => { setUser(u); setLoggedIn(true); setUserRole(u.role); }} />;
  }

  // ── Onboarding wizard — show until onboardingComplete is persisted ─────────
  if (loggedIn && needsOnboarding && userRole !== "admin") {
    if (!user) return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg }}>
        <div style={{ color: COLORS.textMuted, fontSize: 14 }}>Setting up your workspace…</div>
      </div>
    );
    return (
      <SDROnboarding
        user={user}
        onComplete={() => {
          clearOnboardingStorage();
          setUser((u) => (u ? { ...u, onboardingComplete: true } : u));
          setNeedsOnboarding(false);
        }}
      />
    );
  }

  // ── /admin route guard — only redirect if role is definitively not admin
  // (userRole === null means state is still loading — don't redirect yet)
  if (location.pathname === "/admin" && userRole !== null && userRole !== "admin") {
    navigate("/");
    return null;
  }

  // ── Admin users get a completely separate shell — no CRM sidebar/nav ───────
  if (userRole === "admin") {
    return <AdminPanel user={user} onLogout={handleLogout} />;
  }

  // ── If role is still loading and we're at /admin, hold render ────────────
  if (userRole === null && location.pathname === "/admin") return null;

  // Authenticated app is wrapped below in <SettingsProvider> so every Toggle
  // with a recognized label/settingKey auto-persists to /api/settings.

  const navItems = [
    { section: "Overview" },
    { name: "Dashboard", icon: "📊" },
    { section: "CRM" },
    { name: "Leads", icon: "👥" },
    { name: "Campaigns", icon: "🚀", sub: "riivīv & alīv" },
    { name: "Appointments", icon: "📅" },
    { name: "Conversation Replay", icon: "💬" },
    { name: "Proposals & Sales", icon: "📝", badge: "PRO" },
    { name: "Sandbox", icon: "⚡", badge: "DEMO" },
    // All AI SDR product surfaces in one section (setup → config → voice → calls)
    { section: "AI SDR" },
    { name: "SDR Setup", icon: "🛠️", sub: "Twilio · Gmail" },
    { name: "SDR Agent", icon: "🤖", sub: "Prompt · Templates" },
    { name: "Voice AI", icon: "🎙️", sub: "ElevenLabs voice" },
    { name: "AI Calling", icon: "📞", sub: "Bookings · Outcomes" },
    { name: "SMS Inbox", icon: "💬", sub: "Text threads" },
    { name: "Email Inbox", icon: "✉️", sub: "Email threads" },
    { section: "Integrations" },
    { name: "Connect Your Tech", icon: "🔌" },
    { section: "Account" },
    { name: "Billing", icon: "💳" },
    { name: "Settings", icon: "⚙️" },
  ];

  const renderPage = () => {
    if (isLeadDetail) {
      return <LeadDetailPage onNavigate={navigateTo} />;
    }
    switch (page) {
      case "Dashboard": return <DashboardPage setPage={navigateTo} />;
      case "Leads": return <LeadsPage onNavigate={navigateTo} />;
      case "Campaigns": return <CampaignsPage />;
      case "Appointments": return <AppointmentsPage />;
      case "Conversation Replay": return <ConversationReplayPage />;
      case "Sandbox": return <SandboxPage setPage={navigateTo} />;
      case "Proposals & Sales": return <ProposalsPage />;
      case "Voice AI": return <VoiceAIPage />;
      case "Connect Your Tech": return <ConnectTechPage />;
      case "Billing": return <BillingPageLive />;
      case "Settings": return <SettingsPage />;
      case "SDR Agent": return <SDRConfigPage onNavigateBilling={() => navigateTo("Billing")} />;
      case "AI Calling": return <CallingPanelPage />;
      case "SDR Setup": return <SDRSetupPage />;
      case "SMS Inbox": return <MessageInboxPage channel="sms" />;
      case "Email Inbox": return <MessageInboxPage channel="email" />;
      default: return <DashboardPage setPage={navigateTo} />;
    }
  };

  return (
    <SettingsProvider>
    <div className="catalyst-app" style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Mobile sidebar overlay */}
      <div className={`sidebar-overlay ${sidebarOpen ? "active" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div
        className={`catalyst-sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}
        style={S.sidebar}
      >
        <div style={{ padding: sidebarCollapsed ? "16px 12px" : "20px 20px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <Logo />
            <div className="logo-tagline" style={{ fontSize: 10, color: COLORS.textDim, marginTop: 6, letterSpacing: 0.5 }}>THE REACTION STACK</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="sidebar-collapse-btn hide-mobile"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
            <button className="mobile-menu-btn sidebar-close-btn" onClick={() => setSidebarOpen(false)} style={{ color: COLORS.textMuted }}>✕</button>
          </div>
        </div>
        <div style={S.sidebarNav}>
          {navItems.map((item, i) => {
            if (item.section) return <div key={i} className="nav-section nav-section-label" style={S.navSection}>{item.section}</div>;
            return (
              <div
                key={i}
                className="nav-item-row"
                style={S.navItem(page === item.name)}
                onClick={() => navigateTo(item.name)}
                title={item.name}
              >
                <span>{item.icon}</span>
                <span className="nav-label" style={{ flex: 1 }}>{item.name}</span>
                {item.badge && <span className="nav-badge" style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: COLORS.purple, color: "#fff", fontWeight: 700 }}>{item.badge}</span>}
                {item.sub && <span className="nav-sub" style={{ fontSize: 10, color: COLORS.textDim }}>{item.sub}</span>}
              </div>
            );
          })}
        </div>
        <div className="sidebar-user" style={{ padding: sidebarCollapsed ? "12px 10px" : "16px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 10, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${COLORS.orange}, ${COLORS.orangeDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{(user?.firstName || "U")[0]}</div>
          <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{user ? `${user.firstName} ${user.lastName}` : "User"}</div><div style={{ fontSize: 10, color: COLORS.textMuted }}>{user?.email || "Growth Plan"}</div></div>
          {!sidebarCollapsed && (
            <button style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 16, flexShrink: 0 }} onClick={handleLogout} title="Sign out">⏻</button>
          )}
        </div>
      </div>
      <div className="catalyst-main" style={S.main}>
        {!isLeadDetail && (
          <div className="catalyst-topbar" style={S.topbar}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{page}</span>
            </div>
            <div className="topbar-right">
              <span className="compliance-badge-topbar"><ComplianceBadge /></span>
              <div style={{ position: "relative" }}><span style={{ cursor: "pointer", fontSize: 18 }}>🔔</span><span style={{ position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: 7, background: COLORS.red, fontSize: 9, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>5</span></div>
              <input className="topbar-search" style={{ ...S.input, maxWidth: 200, padding: "8px 14px" }} placeholder="Search..." />
            </div>
          </div>
        )}
        <div
          className={`catalyst-content ${isLeadDetail ? "is-lead-detail" : ""}`}
          style={isLeadDetail ? { ...S.content, padding: 0, overflow: "hidden" } : S.content}
        >
          {renderPage()}
        </div>
      </div>
    </div>
    </SettingsProvider>
  );
}
