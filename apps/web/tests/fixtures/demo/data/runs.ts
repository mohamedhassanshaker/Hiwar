/** The prototype's run history, run steps and the card-replacement storyline. */
type RunSeed = { id: string; st: string; goal: string; goalAr: string; at: string; dur: string; cost: number; by: string };
type RunStepSeed = { k: string; t: string; tAr: string; d: string; ms: number | null; tok: number; cost: number; ic: string; live?: boolean };
type StorylineStepSeed = {
  id: string;
  type: string;
  t: string;
  tAr: string;
  exact?: boolean;
  slot?: string;
  branch?: boolean;
  agent: string;
  tools: string[];
  skills: string[];
  /** What the storyline engine reads: quick replies, branches and targets. */
  config?: Record<string, unknown>;
};

export const RUNS: RunSeed[] = [
  { id: 'RUN-88231', st: 'Waiting', goal: 'Review claim EXP-4471 against T&E policy', goalAr: 'مراجعة المطالبة EXP-4471 وفق سياسة السفر', at: '2026-10-09 10:41', dur: '13.7s', cost: 0.30, by: 'TSK-2320' },
  { id: 'RUN-88218', st: 'Running', goal: 'Review claim EXP-4468', goalAr: 'مراجعة المطالبة EXP-4468', at: '2026-10-09 10:36', dur: '—', cost: 0.12, by: 'TSK-2316' },
  { id: 'RUN-88190', st: 'Completed', goal: 'Review claim EXP-4466', goalAr: 'مراجعة المطالبة EXP-4466', at: '2026-10-09 09:58', dur: '11.2s', cost: 0.27, by: 'TSK-2313' },
  { id: 'RUN-88164', st: 'Completed', goal: 'Per-diem impact analysis for September', goalAr: 'تحليل أثر البدل اليومي لشهر سبتمبر', at: '2026-10-09 09:14', dur: '48.0s', cost: 0.38, by: 'SES-1042' },
  { id: 'RUN-88102', st: 'Failed', goal: 'Review claim EXP-4459', goalAr: 'مراجعة المطالبة EXP-4459', at: '2026-10-08 16:20', dur: '6.1s', cost: 0.05, by: 'TSK-2301' },
  { id: 'RUN-88077', st: 'Cancelled', goal: 'Review claim EXP-4455', goalAr: 'مراجعة المطالبة EXP-4455', at: '2026-10-08 14:02', dur: '3.4s', cost: 0.02, by: 'TSK-2298' },
  { id: 'RUN-88031', st: 'Completed', goal: 'Review claim EXP-4451', goalAr: 'مراجعة المطالبة EXP-4451', at: '2026-10-08 11:47', dur: '10.9s', cost: 0.26, by: 'TSK-2295' },
  { id: 'RUN-87990', st: 'Idle', goal: 'Weekly cost report draft', goalAr: 'مسودة تقرير التكلفة الأسبوعي', at: '2026-10-07 08:00', dur: '—', cost: 0, by: 'SCH-03' },
];

export const STEPS: RunStepSeed[] = [
  { k: 'run_start', t: 'Run started', tAr: 'بدء العملية', d: 'Expense Reviewer v7 · task profile', ms: 0, tok: 0, cost: 0, ic: 'TouchInteraction02' },
  { k: 'model', t: 'Plan', tAr: 'التخطيط', d: 'gpt-4.1-mini · 4 step plan', ms: 1840, tok: 6120, cost: 0.03, ic: 'Notebook' },
  { k: 'tool', t: 'erp/claims.read', tAr: 'erp/claims.read', d: 'EXP-4471 · 6 lines · 4 receipts', ms: 420, tok: 0, cost: 0, ic: 'Invoice01' },
  { k: 'skill', t: 'Skill: receipt-extraction', tAr: 'مهارة: receipt-extraction', d: '4 receipts parsed in sandbox', ms: 5210, tok: 11840, cost: 0.11, ic: 'File01' },
  { k: 'model', t: 'Policy check', tAr: 'فحص السياسة', d: '2 lines exceed per-diem', ms: 2960, tok: 14210, cost: 0.12, ic: 'Notebook' },
  { k: 'verify', t: 'Verifier', tAr: 'المُحقق', d: 'policy-compliance: pass · evidence complete', ms: 1310, tok: 3900, cost: 0.04, ic: 'TickCircle' },
  { k: 'approval', t: 'Waiting for approval', tAr: 'بانتظار الاعتماد', d: 'erp/claims.update_status → Fatima Noor', ms: null, tok: 0, cost: 0, ic: 'SecurityPassword', live: true },
];

export const CTX: [string, string, number, string][] = [['System + instructions', 'النظام والتعليمات', 18, 'var(--chart-series-1)'], ['Skills', 'المهارات', 14, 'var(--chart-series-2)'], ['Tools', 'الأدوات', 9, 'var(--chart-series-3)'], ['Work item', 'بند العمل', 22, 'var(--chart-series-4)'], ['Memory', 'الذاكرة', 7, 'var(--chart-series-5)'], ['Conversation', 'المحادثة', 30, 'var(--chart-series-6)']];

export const STEP_TYPES: [string, string, string][] = [['say', 'Message', 'رسالة'], ['ask', 'Ask', 'سؤال'], ['confirm', 'Confirm', 'تأكيد'], ['decide', 'Decide', 'قرار'], ['classify', 'Classify', 'تصنيف'], ['tool', 'Tool', 'أداة'], ['skill', 'Skill', 'مهارة'], ['verify', 'Verify', 'تحقق'], ['create_work', 'Create work', 'إنشاء عمل'], ['handoff', 'Handoff', 'تحويل'], ['wait', 'Wait', 'انتظار'], ['subflow', 'Subflow', 'تدفق فرعي'], ['goto', 'Go to', 'انتقال'], ['end', 'End', 'نهاية']];

export const ALL_TOOLS = ['cards/block', 'cards/replace', 'cards/get_status', 'crm/contact.lookup', 'knowledge/search', 'm365/mail.send'];

export const ALL_SKILLS = ['card-replacement-policy', 'address-validation', 'policy-lookup', 'receipt-extraction'];

export const SL0: StorylineStepSeed[] = [
  { id: 'greet', type: 'say', t: 'Welcome. I can help you replace your card.', tAr: 'مرحباً. يمكنني مساعدتك في استبدال بطاقتك.', exact: true, agent: 'default', tools: [], skills: [] },
  { id: 'verify_user', type: 'verify', t: 'OTP · assurance L2', tAr: 'رمز تحقق · مستوى L2', agent: 'default', tools: ['crm/contact.lookup'], skills: [] },
  {
    id: 'ask_reason',
    type: 'ask',
    t: 'Why do you need a replacement: lost, stolen or damaged?',
    tAr: 'لماذا تحتاج إلى بديل: مفقودة أم مسروقة أم تالفة؟',
    slot: 'reason',
    agent: 'default',
    tools: [],
    skills: ['card-replacement-policy'],
    config: {
      choices: [
        { value: 'lost', en: 'Lost', ar: 'مفقودة' },
        { value: 'stolen', en: 'Stolen', ar: 'مسروقة' },
        { value: 'damaged', en: 'Damaged', ar: 'تالفة' },
      ],
    },
  },
  {
    id: 'route',
    type: 'decide',
    t: 'reason == stolen → block_card · else → ask_address',
    tAr: 'السبب == مسروقة ← إيقاف البطاقة · غير ذلك ← طلب العنوان',
    agent: 'default',
    tools: [],
    skills: [],
    config: { branches: [{ slot: 'reason', equals: 'stolen', goto: 'block_card' }], otherwise: 'ask_address' },
  },
  { id: 'block_card', type: 'tool', t: 'cards/block · approval tier: none', tAr: 'cards/block · مستوى الاعتماد: لا يوجد', branch: true, agent: 'sup', tools: ['cards/block'], skills: [] },
  { id: 'ask_address', type: 'ask', t: 'Please confirm your delivery address.', tAr: 'يرجى تأكيد عنوان التوصيل.', slot: 'delivery_addr', agent: 'default', tools: ['crm/contact.lookup'], skills: ['address-validation'] },
  { id: 'confirm', type: 'confirm', t: 'Replace card ending {{last4}} ({{reason}}), deliver to {{delivery_addr}}?', tAr: 'استبدال البطاقة المنتهية بـ {{last4}} ({{reason}}) والتوصيل إلى {{delivery_addr}}؟', agent: 'default', tools: [], skills: [] },
  { id: 'create', type: 'create_work', t: 'Request type: Card Replacement', tAr: 'نوع الطلب: استبدال بطاقة', agent: 'default', tools: ['cards/replace'], skills: [], config: { requestTypeCode: 'CRD' } },
  { id: 'done', type: 'end', t: 'outcome: completed', tAr: 'النتيجة: مكتمل', agent: 'default', tools: [], skills: [] },
];
