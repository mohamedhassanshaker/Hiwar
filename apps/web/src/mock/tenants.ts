/** Sample data for the operator Organizations screen functions that have no backend (O-Tenants board). */

export const PLAN_KEYS = ["starter", "growth", "business", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_NAMES: Record<PlanKey, string> = { starter: "Starter", growth: "Growth", business: "Business", enterprise: "Enterprise" };

/** [group, key, name, description, kind, unit, value per plan (Starter, Growth, Business, Enterprise)] */
export type Feature = { group: string; key: string; name: string; desc: string; kind: "sw" | "lim" | "both"; unit: string; plan: (string | boolean)[]; locked?: boolean };

export const FEATURES: Feature[] = [
  { group: "Usage", key: "conversations", name: "AI conversations included", desc: "Per month, pooled for the organization", kind: "lim", unit: "conversations / month", plan: ["300", "2,000", "10,000", "Custom"] },
  { group: "Usage", key: "overage", name: "Overage", desc: "Opt-in by the Owner, capped, invoiced at month end", kind: "sw", unit: "", plan: [true, true, true, true] },
  { group: "Usage", key: "agents", name: "Agents", desc: "Agents in the organization", kind: "lim", unit: "agents", plan: ["1", "5", "20", "Custom"] },
  { group: "Usage", key: "deployments", name: "Deployments", desc: "Live widgets on websites", kind: "lim", unit: "deployments", plan: ["1", "5", "20", "Custom"] },
  { group: "Usage", key: "seats", name: "Team members", desc: "Owner, Admins, Builders, Support and Analysts", kind: "lim", unit: "members", plan: ["2", "10", "30", "Custom"] },
  { group: "Usage", key: "storage", name: "Knowledge storage", desc: "Uploaded files and crawled pages", kind: "lim", unit: "GB", plan: ["1", "5", "25", "100"] },
  { group: "Agents", key: "models", name: "Model tiers", desc: "Fast, Standard and Advanced", kind: "lim", unit: "", plan: ["Fast", "Fast, Standard", "All three", "All three"] },
  { group: "Agents", key: "httpTools", name: "HTTP tools", desc: "Read and write tools that call the customer's systems", kind: "sw", unit: "", plan: [false, true, true, true] },
  { group: "Agents", key: "approval", name: "Tool approval", desc: "Staff approve write tools before they run", kind: "sw", unit: "", plan: [false, true, true, true] },
  { group: "Agents", key: "handover", name: "Human handover", desc: "Staff take over and hand back", kind: "sw", unit: "", plan: [true, true, true, true], locked: true },
  { group: "Agents", key: "arabic", name: "Arabic and right-to-left widget", desc: "Visitor language and layout", kind: "sw", unit: "", plan: [true, true, true, true], locked: true },
  { group: "Brand and data", key: "branding", name: "Remove “Powered by Hiwar”", desc: "In the widget footer", kind: "sw", unit: "", plan: [false, false, true, true] },
  { group: "Brand and data", key: "export", name: "Analytics and transcript export", desc: "CSV exports", kind: "sw", unit: "", plan: [false, true, true, true] },
  { group: "Brand and data", key: "retention", name: "Conversation retention", desc: "Then transcripts are deleted", kind: "lim", unit: "days", plan: ["90", "365", "730", "Custom"] },
  { group: "Brand and data", key: "api", name: "API and webhooks", desc: "Signed events and API keys", kind: "both", unit: "calls / day", plan: [false, false, "10,000", "Unlimited"] },
  { group: "Brand and data", key: "sso", name: "Single sign-on", desc: "SAML or OpenID Connect", kind: "sw", unit: "", plan: [false, false, false, true] },
  { group: "Support", key: "sla", name: "Support response time", desc: "First reply target", kind: "lim", unit: "", plan: ["2 working days", "1 working day", "4 working hours", "1 working hour"] },
  { group: "Support", key: "csm", name: "Named success manager", desc: "Regular check-ins", kind: "sw", unit: "", plan: [false, false, false, true] },
];

export type Tenant = {
  id: string;
  name: string;
  ini: string;
  industry: string;
  region: "UAE" | "KSA";
  data: "Shared" | "Own schema" | "Own database";
  plan: PlanKey;
  state: "Active" | "Trial" | "Overdue" | "Read-only";
  detail: string;
  limits: Record<string, [string, string]>;
  used: Record<string, string>;
};

export const TENANTS: Tenant[] = [
  { id: "t1", name: "Gulf Bites Restaurants", ini: "GB", industry: "Restaurants", region: "UAE", data: "Shared", plan: "growth", state: "Active", detail: "Renews 1 Dec 2026", limits: { seats: ["15", "Contract"] }, used: { conversations: "1,412 of 2,000", seats: "12 of 15", storage: "2.1 GB", agents: "3 of 5" } },
  { id: "t2", name: "Desert Bank", ini: "DB", industry: "Banking and finance", region: "UAE", data: "Own schema", plan: "enterprise", state: "Active", detail: "Renews 1 Apr 2027", limits: { conversations: ["60,000", "Contract"] }, used: { conversations: "38,904", agents: "14" } },
  { id: "t3", name: "Oasis Clinics", ini: "OC", industry: "Healthcare", region: "UAE", data: "Shared", plan: "growth", state: "Trial", detail: "Trial ends 28 Nov", limits: { conversations: ["2,500", "+500 until 31 Dec"] }, used: { conversations: "91 of 100" } },
  { id: "t4", name: "Riyadh Motors", ini: "RM", industry: "Automotive", region: "KSA", data: "Own database", plan: "business", state: "Overdue", detail: "Grace day 18 of 30", limits: {}, used: { storage: "19 GB" } },
  { id: "t5", name: "Najd Logistics", ini: "NL", industry: "Logistics", region: "KSA", data: "Shared", plan: "business", state: "Active", detail: "Overage on", limits: {}, used: { conversations: "100% · on overage" } },
  { id: "t6", name: "Marina Realty", ini: "MR", industry: "Real estate", region: "UAE", data: "Shared", plan: "starter", state: "Read-only", detail: "Grace ended 12 days ago", limits: {}, used: {} },
];

export const INDUSTRIES = ["Restaurants", "Retail and e-commerce", "Healthcare", "Real estate", "Banking and finance", "Automotive", "Logistics", "Education", "Government-owned company"];

/** Agent templates Hiwar publishes and versions (replaces the board's global frameworks). */
export type Template = { id: string; name: string; kind: string; live: string; draft: string; size: string; used: string; diff: [string, string, string][] };
export const TEMPLATE_KINDS = ["All", "Support", "Sales", "Bookings", "FAQ"];
export const TEMPLATES: Template[] = [
  { id: "rest", name: "Restaurant orders and bookings", kind: "Bookings", live: "v2.0", draft: "v2.1", size: "6 tools · 3 knowledge starters", used: "41 organizations", diff: [["Added", "Tool: check_table_availability with party size up to 20", "Read tool, no approval"], ["Changed", "Hand over when the visitor asks about allergies", "Topic moved from answer to sensitive"], ["Removed", "Greeting with a daily special", "Organizations that use it keep their copy"]] },
  { id: "shop", name: "E-commerce order status", kind: "Support", live: "v3.2", draft: "v3.3", size: "4 tools · returns policy starter", used: "63 organizations", diff: [["Added", "Tool: start_return, write tool with approval", "Approval required by default"], ["Changed", "Order number pattern accepts 10 to 14 digits", "Was 10 digits only"]] },
  { id: "clinic", name: "Clinic appointments", kind: "Bookings", live: "v1.4", draft: "", size: "3 tools · sensitive topics preset", used: "12 organizations", diff: [] },
  { id: "lead", name: "Lead capture for sales", kind: "Sales", live: "v1.1", draft: "v1.2", size: "capture_lead · qualification questions", used: "88 organizations", diff: [["Added", "Asks for company size before the phone number", "Qualification order"], ["Changed", "Lead email goes to the Owner and Admins", "Was the Owner only"]] },
  { id: "faq", name: "Website FAQ", kind: "FAQ", live: "v4.0", draft: "", size: "No tools · answers only from knowledge", used: "212 organizations", diff: [] },
];

export const MARKETS = [
  { name: "United Arab Emirates", currency: "AED", vat: "5%", state: "Live" },
  { name: "Saudi Arabia", currency: "SAR", vat: "15%", state: "Live" },
];
