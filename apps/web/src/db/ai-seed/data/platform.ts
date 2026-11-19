/** The prototype's live channels, embedded deployments, feature flags and clients. */
type DeploymentSeed = { id: string; n: string; nAr: string; a: string; surf: string; sl: string; rate: number; conv: number; st: string };
type ClientSeed = {
  id: string;
  n: string;
  nAr: string;
  own: string;
  perms: string[];
  agents: string[];
  keys: number;
  mcp: boolean;
  agui: boolean;
  last: string;
  st: string;
};

export const CH_LIVE: [string, string, string][] = [['Web widget', 'Degraded', 'Embedded deployment: Website assistant'], ['WhatsApp', 'Degraded', 'Embedded deployment: Website assistant'], ['Microsoft Teams', 'Enabled', 'Discussion rooms (mirror)']];

export const CH_SOON = ['Slack', 'Email', 'SMS', 'Voice / IVR', 'Telegram', 'Webex', 'Google Chat', 'Instagram', 'Facebook Messenger'];

export const CHANNEL_TYPES = ['Web widget', 'Microsoft Teams', 'WhatsApp', 'Slack', 'Email', 'SMS', 'Voice / IVR', 'Telegram', 'Webex', 'Google Chat'];

export const DEPS: DeploymentSeed[] = [
  { id: 'dep_7f3a9c', n: 'Website assistant', nAr: 'مساعد الموقع', a: 'sup', surf: 'Widget · WhatsApp', sl: 'card-replacement v3 · strict', rate: 4.6, conv: 3120, st: 'Enabled' },
  { id: 'dep_2b81e0', n: 'Employee helpdesk', nAr: 'مكتب مساعدة الموظفين', a: 'kb', surf: 'Teams', sl: '—', rate: 4.3, conv: 842, st: 'Enabled' },
  { id: 'dep_91cd44', n: 'Vendor portal assistant', nAr: 'مساعد بوابة الموردين', a: 'prc', surf: 'Widget', sl: 'vendor-onboarding v1 · guided', rate: 0, conv: 0, st: 'Draft' },
];

export const FLAGS: [string, string, [string, string, boolean][]][] = [
  ['Agents & runs', 'الوكلاء والعمليات', [['Allow agents to assign work to other agents', 'السماح للوكلاء بإسناد العمل لوكلاء آخرين', true], ['Mixture-of-agents for high-stakes outputs', 'مزيج الوكلاء للمخرجات عالية الأهمية', false], ['Verifier step on every T2 tool call', 'خطوة تحقق عند كل استدعاء أداة T2', true], ['Capture full traces (RAW events)', 'التقاط التتبع الكامل (أحداث RAW)', false]]],
  ['Memory & knowledge', 'الذاكرة والمعرفة', [['Memory writes require review for org scope', 'كتابة الذاكرة تتطلب مراجعة لنطاق الجهة', true], ['Graph retrieval (Graphiti)', 'الاسترجاع الرسومي (Graphiti)', true], ['PII filter on memory writes', 'فلتر البيانات الشخصية عند الكتابة', true]]],
  ['Collaboration', 'التعاون', [['Mirror rooms to Microsoft Teams', 'عكس الاجتماعات إلى Microsoft Teams', true], ['Agentic interactive request entry', 'إدخال الطلبات التفاعلي بالوكيل', false]]],
  ['Engage', 'التفاعل', [['Embedded deployments', 'النشر المضمّن', true], ['Voice / IVR channel', 'قناة الصوت', false], ['Visitor ratings in widget', 'تقييم الزوار في الويدجت', true]]],
  ['Platform', 'المنصة', [['Plugins', 'الإضافات', true], ['Page assistant', 'مساعد الصفحة', true]]],
];

export const CLIENTS: ClientSeed[] = [
  { id: 'cli_crm', n: 'CRM integration', nAr: 'تكامل CRM', own: 'u2', perms: ['agents:invoke', 'requests:write', 'webhooks:receive'], agents: ['sup', 'exp'], keys: 2, mcp: true, agui: true, last: '2m', st: 'Active' },
  { id: 'cli_erp', n: 'Oracle ERP', nAr: 'Oracle ERP', own: 'u3', perms: ['agents:invoke', 'work_items:read'], agents: ['exp', 'rec'], keys: 1, mcp: true, agui: false, last: '1h', st: 'Active' },
  { id: 'cli_portal', n: 'Customer portal', nAr: 'بوابة المتعاملين', own: 'u2', perms: ['agents:invoke', 'knowledge:search'], agents: ['sup'], keys: 1, mcp: false, agui: true, last: '4m', st: 'Active' },
  { id: 'cli_bi', n: 'Legacy reporting', nAr: 'التقارير القديمة', own: 'u4', perms: ['work_items:read', 'rooms:read'], agents: [], keys: 1, mcp: false, agui: false, last: '41d', st: 'Inactive' },
];

export const CLIENT_PERMS: [string, string][] = [['agents:invoke', 'Run allowed agents'], ['requests:write', 'Submit requests'], ['work_items:read', 'Read work items'], ['rooms:read', 'Read discussion rooms'], ['knowledge:search', 'Search knowledge'], ['webhooks:receive', 'Receive outbound events']];

export const FLAG_GROUP: Record<string, string> = {
  "Agents & runs": "AgentsAndRuns",
  "Memory & knowledge": "MemoryAndKnowledge",
  Collaboration: "Collaboration",
  Engage: "Engage",
  Platform: "Platform",
};
