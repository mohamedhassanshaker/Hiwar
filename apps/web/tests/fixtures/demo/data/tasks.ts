import type { ScreenId } from "@/lib/routes";

/** The prototype's work-item rows and their detail panels. */
type TaskSeed = {
  k: string;
  p: string;
  t: string;
  tAr: string;
  type: string;
  st: string;
  who: string | null;
  pri: string;
  due: string;
  sub: number;
  done: number;
};

type SubItemSeed = [string, string, string, string, number?];

type WorkItemDetailSeed = {
  rt: [string, string];
  org: [string, ScreenId] | null;
  rev: string;
  sch: string;
  parent?: string;
  at: [string, string][];
  subs: SubItemSeed[];
  act: [string, string, string][];
};


export const TASKS: TaskSeed[] = [
  { k: 'TSK-2318', p: 'FIN', t: 'Publish Q4 T&E policy', tAr: 'نشر سياسة السفر للربع الرابع', type: 'Task', st: 'InProgress', who: 'u3', pri: 'High', due: '12 Oct', sub: 3, done: 1 },
  { k: 'TSK-2320', p: 'FIN', t: 'Review claim EXP-4471', tAr: 'مراجعة المطالبة EXP-4471', type: 'Task', st: 'InProgress', who: 'exp', pri: 'Medium', due: '9 Oct', sub: 0, done: 0 },
  { k: 'TSK-2311', p: 'PRC', t: 'Laptop refresh — vendor comparison', tAr: 'تحديث الحواسيب — مقارنة الموردين', type: 'Task', st: 'InReview', who: 'prc', pri: 'Medium', due: '15 Oct', sub: 2, done: 2 },
  { k: 'BUG-311', p: 'IT', t: 'Receipt OCR drops Arabic line items', tAr: 'التعرف الضوئي يُسقط البنود العربية', type: 'Bug', st: 'Blocked', who: 'bug', pri: 'High', due: '10 Oct', sub: 0, done: 0 },
  { k: 'TSK-2324', p: 'FIN', t: 'Notify staff of new per-diem', tAr: 'إبلاغ الموظفين بالبدل الجديد', type: 'Subtask', st: 'Todo', who: 'u5', pri: 'Low', due: '13 Oct', sub: 0, done: 0 },
  { k: 'TSK-2325', p: 'FIN', t: 'Update knowledge base article', tAr: 'تحديث مقال قاعدة المعرفة', type: 'Subtask', st: 'Todo', who: 'kb', pri: 'Low', due: '14 Oct', sub: 0, done: 0 },
  { k: 'TSK-2301', p: 'FIN', t: 'September bank reconciliation', tAr: 'التسوية البنكية لشهر سبتمبر', type: 'Task', st: 'Done', who: 'rec', pri: 'Medium', due: '5 Oct', sub: 4, done: 4 },
  { k: 'TSK-2328', p: 'PRC', t: 'Vendor onboarding request — Gulf IT', tAr: 'طلب تسجيل مورد — الخليج للتقنية', type: 'Task', st: 'Backlog', who: null, pri: 'Medium', due: '—', sub: 0, done: 0 },
  { k: 'BUG-314', p: 'CS', t: 'Widget fails to switch to Arabic mid-chat', tAr: 'الويدجت لا يتحول للعربية أثناء المحادثة', type: 'Bug', st: 'Backlog', who: null, pri: 'Medium', due: '—', sub: 0, done: 0 },
];

export const COLS: [string, string][] = [['Backlog', 'قائمة الانتظار'], ['Todo', 'للتنفيذ'], ['InProgress', 'قيد التنفيذ'], ['InReview', 'قيد المراجعة'], ['Blocked', 'معطّل'], ['Done', 'منجز']];

export const WI: Record<string, WorkItemDetailSeed> = {
  'TSK-2318': { rt: ['Policy change', 'تغيير سياسة'], org: ['SES-1042', 'session'], rev: 'u2', sch: 'Policy change v3', at: [['policy_ref', 'FIN-POL-007'], ['effective_date', '2026-10-01'], ['impacted_claims', '19'], ['staff_notice', 'required']], subs: [['TSK-2323', 'Approve the claims review EXP-4480', 'اعتماد مراجعة المطالبات EXP-4480', 'u3', 1], ['TSK-2324', 'Notify staff of new per-diem', 'إبلاغ الموظفين بالبدل الجديد', 'u5'], ['TSK-2325', 'Update knowledge base article', 'تحديث مقال قاعدة المعرفة', 'kb']], act: [['exp', 'created EXP-4480 · 09:21', 'أنشأ EXP-4480 · 09:21'], ['u3', 'moved to In progress · 09:24', 'نقلت إلى قيد التنفيذ · 09:24'], ['exp', 'attached per-diem-impact-sep.xlsx · 09:14', 'أرفق per-diem-impact-sep.xlsx · 09:14']] },
  'TSK-2320': { rt: ['Expense Claim', 'مطالبة مصروفات'], org: ['REQ-9007', 'requests'], rev: 'u3', sch: 'Expense Claim v6', at: [['claim_id', 'EXP-4471'], ['amount_aed', '3,420.00'], ['lines', '6'], ['receipts', '4']], subs: [], act: [['exp', 'started RUN-88231 · 10:41', 'بدأ RUN-88231 · 10:41'], ['exp', 'requested approval for claims.update_status · 10:47', 'طلب اعتماد claims.update_status · 10:47']] },
  'TSK-2311': { rt: ['Purchase Request', 'طلب شراء'], org: ['SES-1041', 'session'], rev: 'u2', sch: 'Purchase Request v1', at: [['item', 'Laptops (14")'], ['quantity', '40'], ['budget_line', 'IT-OPS'], ['quotes', '3']], subs: [['TSK-2312', 'Collect vendor quotes', 'جمع عروض الموردين', 'prc', 1], ['TSK-2313', 'Score quotes against criteria', 'تقييم العروض وفق المعايير', 'prc', 1]], act: [['prc', 'attached vendor-comparison-laptops.pdf · Yesterday', 'أرفق vendor-comparison-laptops.pdf · أمس'], ['prc', 'moved to In review · 08:50', 'نقل إلى قيد المراجعة · 08:50']] },
  'BUG-311': { rt: ['Bug Report', 'بلاغ خطأ'], org: ['REQ-9009', 'requests'], rev: 'u4', sch: 'Bug v4', at: [['severity', 'S2'], ['component', 'receipt-extraction'], ['expected', 'All Arabic line items extracted'], ['actual', 'Arabic lines dropped on mixed-script receipts']], subs: [['BUG-311-1', 'Reproduce in sandbox', 'إعادة الإنتاج في بيئة معزولة', 'bug'], ['BUG-311-2', 'Patch Arabic normalisation step', 'إصلاح خطوة توحيد النص العربي', 'u4']], act: [['bug', 'run RUN-88210 failed: cards/block circuit open · 10:40', 'فشلت RUN-88210: دائرة cards/block مفتوحة · 10:40'], ['u4', 'marked Blocked · 10:42', 'وضع حالة معطّل · 10:42']] },
  'TSK-2324': { rt: ['Policy change', 'تغيير سياسة'], org: ['SES-1042', 'session'], rev: 'u3', sch: 'Policy change v3', parent: 'TSK-2318', at: [['audience', 'All staff'], ['channel', 'Email + Teams']], subs: [], act: [['u3', 'created from TSK-2318 · 09:30', 'أُنشئ من TSK-2318 · 09:30']] },
  'TSK-2325': { rt: ['Policy change', 'تغيير سياسة'], org: ['SES-1042', 'session'], rev: 'u3', sch: 'Policy change v3', parent: 'TSK-2318', at: [['article', 'KB-118 Travel per-diem'], ['collection', 'Policies']], subs: [], act: [['u3', 'created from TSK-2318 · 09:30', 'أُنشئ من TSK-2318 · 09:30']] },
  'TSK-2301': { rt: ['Routine', 'روتين'], org: ['SCH-01', 'routines'], rev: 'u3', sch: 'Reconciliation v2', at: [['period', '2026-09'], ['matched', '1,204'], ['exceptions', '3']], subs: [['TSK-2302', 'Import bank statement', 'استيراد كشف الحساب', 'rec', 1], ['TSK-2303', 'Match transactions', 'مطابقة المعاملات', 'rec', 1], ['TSK-2304', 'Resolve 3 exceptions', 'معالجة 3 استثناءات', 'u3', 1], ['TSK-2305', 'Publish report', 'نشر التقرير', 'rec', 1]], act: [['rec', 'completed · 5 Oct 03:12', 'اكتمل · 5 أكتوبر 03:12']] },
  'TSK-2328': { rt: ['Vendor Onboarding', 'تسجيل مورد'], org: ['REQ-9003', 'requests'], rev: 'u2', sch: 'Vendor Onboarding v2', at: [['vendor', 'Gulf IT LLC'], ['trade_licence', 'pending']], subs: [], act: [['u2', 'created · 7 Oct', 'أُنشئ · 7 أكتوبر']] },
  'BUG-314': { rt: ['Bug Report', 'بلاغ خطأ'], org: ['SES-1037', 'session'], rev: 'u4', sch: 'Bug v4', at: [['severity', 'S3'], ['component', 'web widget'], ['expected', 'Language switches on request'], ['actual', 'Stays in English']], subs: [], act: [['sup', 'reported from widget conversation · 8 Oct', 'أُبلغ من محادثة الويدجت · 8 أكتوبر']] },
};
