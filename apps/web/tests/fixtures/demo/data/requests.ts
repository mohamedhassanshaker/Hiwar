/** The prototype's request types, requests and the Expense Claim transition steps. */
type RequestTypeSeed = { c: string; n: string; nAr: string; cat: string; v: string; st: string; ch: string; dec: string; sla: string; open: number };
type RequestSeed = { k: string; t: string; tAr: string; ty: string; p: string; by: string; st: string; d: string; ch: string; mode: string };
type RequestStepSeed = { n: string; nAr: string; aud: [string, string][]; out: [string, string, string][] };

export const RTYPES: RequestTypeSeed[] = [
  { c: 'EXP', n: 'Expense Claim', nAr: 'مطالبة مصروفات', cat: 'Finance', v: 'v6', st: 'Published', ch: 'Console, Teams, Email', dec: 'agent', sla: '2 business days', open: 23 },
  { c: 'PUR', n: 'Purchase Request', nAr: 'طلب شراء', cat: 'Procurement', v: 'v1', st: 'Draft', ch: 'Console, Teams', dec: 'hybrid', sla: '3 business days', open: 0 },
  { c: 'CRD', n: 'Card Replacement', nAr: 'استبدال بطاقة', cat: 'Customer', v: 'v3', st: 'Published', ch: 'Widget, WhatsApp', dec: 'template', sla: '4 hours', open: 41 },
  { c: 'LEV', n: 'Leave Request', nAr: 'طلب إجازة', cat: 'HR', v: 'v2', st: 'Published', ch: 'Console, Teams', dec: 'none', sla: '1 business day', open: 7 },
  { c: 'BUG', n: 'Bug Report', nAr: 'بلاغ خطأ', cat: 'IT', v: 'v4', st: 'Published', ch: 'Console, Slack, API', dec: 'agent', sla: '8 hours', open: 12 },
  { c: 'VEN', n: 'Vendor Onboarding', nAr: 'تسجيل مورد', cat: 'Procurement', v: 'v2', st: 'Published', ch: 'Console, Email', dec: 'template', sla: '5 business days', open: 3 },
];

export const REQS: RequestSeed[] = [
  { k: 'REQ-9012', t: 'Taxi reimbursement AED 186', tAr: 'تعويض تاكسي 186 د.إ', ty: 'EXP', p: 'FIN', by: 'u5', st: 'In review', d: '2026-10-09', ch: 'Teams', mode: 'agent' },
  { k: 'REQ-9011', t: 'Replace damaged card', tAr: 'استبدال بطاقة تالفة', ty: 'CRD', p: 'CS', by: 'ext', st: 'Completed', d: '2026-10-09', ch: 'Widget', mode: 'agent' },
  { k: 'REQ-9010', t: 'Need 5 monitors for new hires', tAr: 'نحتاج 5 شاشات للموظفين الجدد', ty: 'PUR', p: 'PRC', by: 'u2', st: 'Submitted', d: '2026-10-08', ch: 'Console', mode: 'form' },
  { k: 'REQ-9009', t: 'Login loop on mobile app', tAr: 'حلقة تسجيل الدخول في التطبيق', ty: 'BUG', p: 'IT', by: 'u4', st: 'In review', d: '2026-10-08', ch: 'Slack', mode: 'agent' },
  { k: 'REQ-9008', t: 'Annual leave 20–24 Oct', tAr: 'إجازة سنوية 20–24 أكتوبر', ty: 'LEV', p: 'FIN', by: 'u5', st: 'Approved', d: '2026-10-07', ch: 'Console', mode: 'form' },
  { k: 'REQ-9007', t: 'Question about VAT on fees', tAr: 'استفسار عن ضريبة الرسوم', ty: 'EXP', p: 'FIN', by: 'ext', st: 'Triage', d: '2026-10-05', ch: 'Email', mode: 'agent' },
  { k: 'REQ-9003', t: 'Onboard Gulf IT as vendor', tAr: 'تسجيل الخليج للتقنية كمورد', ty: 'VEN', p: 'PRC', by: 'u2', st: 'Rejected', d: '2026-09-28', ch: 'Console', mode: 'form' },
];

export const RT_STEPS: RequestStepSeed[] = [
  { n: 'Submitted', nAr: 'مقدم', aud: [['Requester', 'مقدم الطلب']], out: [['Submit', 'تقديم', 'Agent review']] },
  { n: 'Agent review', nAr: 'مراجعة الوكيل', aud: [['Expense Reviewer (agent)', 'مراجع المصروفات (وكيل)']], out: [['amount_aed < 5000', 'amount_aed < 5000', 'Finance approval'], ['amount_aed >= 5000', 'amount_aed >= 5000', 'Finance + Work Lead'], ['Return', 'إرجاع', 'Submitted']] },
  { n: 'Finance approval', nAr: 'اعتماد المالية', aud: [['Finance Approvers (any of)', 'معتمدو المالية (أي منهم)']], out: [['Approve', 'اعتماد', 'Payment'], ['Reject', 'رفض', 'Closed']] },
  { n: 'Finance + Work Lead', nAr: 'المالية + قائد العمل', aud: [['Finance Approvers', 'معتمدو المالية'], ['Work Lead (sequential)', 'قائد العمل (تسلسلي)']], out: [['Approve', 'اعتماد', 'Payment'], ['Reject', 'رفض', 'Closed']] },
  { n: 'Payment', nAr: 'الدفع', aud: [['Reconciliation Agent (agent)', 'وكيل التسويات (وكيل)']], out: [['Paid', 'مدفوع', 'Closed']] },
  { n: 'Closed', nAr: 'مغلق', aud: [], out: [] },
];

export const REQ_ATTR: Record<string, [string, string][]> = { EXP: [['amount_aed', '186.00'], ['expense_date', '2026-10-03'], ['category', 'ground_transport'], ['cost_center', 'FIN-OPS']], CRD: [['card_last4', '4821'], ['reason', 'damaged'], ['delivery_addr', 'Villa 12, Al Barsha, Dubai']], PUR: [['item', 'Monitor 27"'], ['quantity', '5'], ['budget_line', 'IT-OPS']], BUG: [['severity', 'S2'], ['platform', 'iOS 18'], ['steps', 'Login → OTP → loop']], LEV: [['from', '2026-10-20'], ['to', '2026-10-24'], ['leave_type', 'annual']], VEN: [['vendor', 'Gulf IT LLC'], ['trade_licence', 'CN-1182334']] };

export const REQ_DESC: Record<string, [string, string]> = { 'REQ-9012': ['Taxi fares from Dubai office to the Abu Dhabi client site and back on 3 October.', 'أجرة تاكسي من مكتب دبي إلى موقع العميل في أبوظبي والعودة في 3 أكتوبر.'] };
