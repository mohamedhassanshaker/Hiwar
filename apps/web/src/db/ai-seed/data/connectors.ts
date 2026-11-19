/** The prototype's connectors and the catalogue of ones you could install. */
type ConnectorSeed = {
  n: string;
  d: string;
  dAr: string;
  kind: string;
  url: string;
  auth: string;
  st: string;
  on: boolean;
  def: string;
  tools: [string, string][];
};

export const TIERS: [string, string, string, string][] = [['T0', 'Autonomous', 'مستقل', 'neutral'], ['T1', 'Confirm', 'تأكيد', 'info'], ['T2', 'Human approval', 'اعتماد بشري', 'warning'], ['T3', 'Forbidden', 'محظور', 'danger']];

/**
 * D374: `erp` and `knowledge` have no server on any cluster, so they are seeded off; enabled,
 * every run listed their tools and the runtime answered 502 (QA run 20261030_2, F1).
 */
export const CONNS0: ConnectorSeed[] = [
  { n: 'platform', d: "The platform's own tools: knowledge, memory, approvals, agent questions and runs", dAr: 'أدوات المنصة نفسها: المعرفة والذاكرة والموافقات وأسئلة الوكلاء والتشغيلات', kind: 'Platform MCP', url: 'internal://platform', auth: 'Run token', st: 'Healthy', on: true, def: 'T1', tools: [] },
  { n: 'erp', d: 'Oracle ERP via OpenAPI bridge', dAr: 'نظام ERP عبر جسر OpenAPI', kind: 'REST/OpenAPI', url: 'https://erp.hiwar.example/mcp', auth: 'OAuth 2.1', st: 'Disabled', on: false, def: 'T1', tools: [['claims.read', 'T0'], ['claims.update_status', 'T2'], ['purchase_order.submit', 'T2'], ['vendors.search', 'T0'], ['payments.release', 'T3']] },
  { n: 'm365', d: 'Microsoft 365 — mail, calendar, files', dAr: 'مايكروسوفت 365 — البريد والتقويم والملفات', kind: 'Remote MCP', url: 'https://mcp.m365.hiwar.example', auth: 'OAuth 2.1', st: 'Healthy', on: true, def: 'T1', tools: [['mail.read', 'T0'], ['mail.send', 'T2'], ['calendar.create_event', 'T1'], ['files.search', 'T0']] },
  { n: 'knowledge', d: 'Platform knowledge (Graphiti)', dAr: 'معرفة المنصة (Graphiti)', kind: 'Platform MCP', url: 'internal://knowledge', auth: 'Run token', st: 'Disabled', on: false, def: 'T0', tools: [['search', 'T0'], ['graph.query', 'T0']] },
  { n: 'cards', d: 'Customer card management', dAr: 'إدارة بطاقات المتعاملين', kind: 'Remote MCP', url: 'https://cards.hiwar.example/mcp', auth: 'API key', st: 'Degraded', on: true, def: 'T1', tools: [['get_status', 'T0'], ['block', 'T1'], ['replace', 'T2']] },
  { n: 'sandbox-fs', d: 'Workbench file system', dAr: 'نظام ملفات بيئة العمل', kind: 'Local MCP (stdio)', url: 'stdio://sandbox-fs', auth: '—', st: 'Disabled', on: false, def: 'T0', tools: [['read_file', 'T0'], ['write_file', 'T1'], ['delete_file', 'T2']] },
];

export const CATALOG: [string, string, string, string, number][] = [
  ['github', 'GitHub — repositories, issues, pull requests', 'GitHub — المستودعات والبلاغات وطلبات الدمج', 'Remote MCP', 42],
  ['jira', 'Jira — issues and sprints', 'Jira — البلاغات والدورات', 'Remote MCP', 18],
  ['servicenow', 'ServiceNow — incidents and changes', 'ServiceNow — الحوادث والتغييرات', 'Remote MCP', 26],
  ['salesforce', 'Salesforce — accounts, cases', 'Salesforce — الحسابات والحالات', 'Remote MCP', 30],
  ['sap', 'SAP S/4HANA — finance, procurement', 'SAP S/4HANA — المالية والمشتريات', 'REST/OpenAPI', 54],
  ['postgres', 'PostgreSQL — read-only queries', 'PostgreSQL — استعلامات قراءة فقط', 'Local MCP (stdio)', 4],
  ['google-drive', 'Google Drive — files', 'Google Drive — الملفات', 'Remote MCP', 9],
  ['uaepass', 'UAE Pass — identity verification', 'UAE Pass — التحقق من الهوية', 'REST/OpenAPI', 5],
];
