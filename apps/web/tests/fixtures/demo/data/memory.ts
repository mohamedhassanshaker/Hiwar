/** The prototype's memory tree, entries and version history. */
type MemoryGroupSeed = { id: string; n: [string, string]; ic?: string; agent?: string; kids: { id: string; n: [string, string] }[] };
type MemoryItemSeed = [[string, string], [string, string], [string, string]];
type MemoryEntrySeed = {
  title: [string, string];
  path: [string, string];
  scope: string;
  st: string;
  v: number;
  owner: [string, string];
  rev: string;
  access: [string, string];
  items: MemoryItemSeed[];
  warn?: [string, string];
};

export const MEM_TREE: MemoryGroupSeed[] = [
  { id: 'org', n: ['Organisation', 'الجهة'], ic: 'Bank', kids: [{ id: 'glossary', n: ['Glossary', 'المسرد'] }, { id: 'oprules', n: ['Operating rules', 'قواعد التشغيل'] }] },
  { id: 'fin', n: ['Finance', 'المالية'], ic: 'Invoice01', kids: [{ id: 'monthend', n: ['Month-end', 'نهاية الشهر'] }] },
  { id: 'exp', n: ['Expense Reviewer', 'مراجع المصروفات'], agent: 'exp', kids: [{ id: 'procedures', n: ['Procedures.md', 'Procedures.md'] }, { id: 'prefs', n: ['Preferences.md', 'Preferences.md'] }] },
  { id: 'ses', n: ['Sessions', 'الجلسات'], ic: 'Chat', kids: [{ id: 'handoff', n: ['SES-1042 handoff', 'تسليم SES-1042'] }] },
];

export const MEM: Record<string, MemoryEntrySeed> = {
  procedures: { title: ['Expense Reviewer', 'مراجع المصروفات'], path: ['Agent memory / Procedures', 'ذاكرة الوكيل / الإجراءات'], scope: 'Agent', st: 'Active', v: 14, owner: ['Finance Operations', 'العمليات المالية'], rev: '8 Oct 2026', access: ['Authorised agents', 'الوكلاء المصرح لهم'],
    items: [[['Learned procedures', 'الإجراءات المكتسبة'], ['Hotel per-diem rule: Riyadh AED 900 per night from 1 Oct 2026.', 'قاعدة البدل الفندقي: الرياض 900 د.إ لليلة من 1 أكتوبر 2026.'], ['Finance policy FIN-POL-007', 'السياسة المالية FIN-POL-007']], [['Receipt validation', 'التحقق من الإيصالات'], ['Validate VAT details and apply the approved exception rules. Taxi receipts without a VAT number are accepted up to AED 50.', 'التحقق من بيانات ضريبة القيمة المضافة وتطبيق قواعد الاستثناء المعتمدة. تُقبل إيصالات التاكسي بلا رقم ضريبي حتى 50 د.إ.'], ['Approved procedure · Fatima Noor, 8 Oct', 'إجراء معتمد · فاطمة نور، 8 أكتوبر']], [['Escalation', 'التصعيد'], ['Claims older than 90 days go to the Finance Approvers queue.', 'المطالبات الأقدم من 90 يوماً تذهب إلى طابور معتمدي المالية.'], ['Operating rules', 'قواعد التشغيل']]] },
  prefs: { title: ['Expense Reviewer', 'مراجع المصروفات'], path: ['Agent memory / Preferences', 'ذاكرة الوكيل / التفضيلات'], scope: 'Agent', st: 'Pending review', v: 3, owner: ['Finance Operations', 'العمليات المالية'], rev: '2 Oct 2026', access: ['Authorised agents', 'الوكلاء المصرح لهم'],
    items: [[['Reply style', 'أسلوب الرد'], ['Cite FIN-POL-007 clause numbers in every return reason.', 'ذكر أرقام بنود FIN-POL-007 في كل سبب إرجاع.'], ['Learned from RUN-88231', 'مكتسب من RUN-88231']]] },
  glossary: { title: ['Glossary', 'المسرد'], path: ['Organisation memory / Glossary', 'ذاكرة الجهة / المسرد'], scope: 'Organisation', st: 'Active', v: 22, owner: ['Platform team', 'فريق المنصة'], rev: '1 Oct 2026', access: ['All agents', 'كل الوكلاء'],
    items: [[['Terms', 'المصطلحات'], ['Tahseel card: prepaid government payment card. Per-diem: daily allowance under FIN-POL-007.', 'بطاقة تحصيل: بطاقة دفع حكومية مسبقة الدفع. البدل اليومي: حسب FIN-POL-007.'], ['Organisation glossary', 'مسرد الجهة']]] },
  oprules: { title: ['Operating rules', 'قواعد التشغيل'], path: ['Organisation memory / Rules', 'ذاكرة الجهة / القواعد'], scope: 'Organisation', st: 'Needs attention', v: 9, owner: ['Platform team', 'فريق المنصة'], rev: '12 Jul 2026', access: ['All agents', 'كل الوكلاء'],
    items: [[['Working hours', 'ساعات العمل'], ['Human approvals are routed only between 08:00 and 17:00 GST, Monday to Friday.', 'تُوجَّه الاعتمادات البشرية فقط بين 08:00 و17:00، من الاثنين إلى الجمعة.'], ['HR policy', 'سياسة الموارد البشرية']]], warn: ['Not reviewed for 89 days. Review cycle is 90 days.', 'لم تُراجع منذ 89 يوماً. دورة المراجعة 90 يوماً.'] },
  monthend: { title: ['Month-end', 'نهاية الشهر'], path: ['Business unit memory / Finance', 'ذاكرة وحدة العمل / المالية'], scope: 'Business unit', st: 'Active', v: 6, owner: ['Finance Operations', 'العمليات المالية'], rev: '5 Oct 2026', access: ['Finance agents', 'وكلاء المالية'],
    items: [[['Close calendar', 'تقويم الإقفال'], ['Bank reconciliation runs on day 1; exceptions must be cleared by day 3.', 'تجري المطابقة البنكية في اليوم 1؛ ويجب معالجة الاستثناءات بحلول اليوم 3.'], ['Reconciler routine', 'روتين المطابقة']]] },
  handoff: { title: ['SES-1042 handoff', 'تسليم SES-1042'], path: ['Session memory', 'ذاكرة الجلسة'], scope: 'Session', st: 'Active', v: 2, owner: ['Expense Reviewer', 'مراجع المصروفات'], rev: '9 Oct 2026', access: ['Room members', 'أعضاء الاجتماع'],
    items: [[['Context', 'السياق'], ['Q4 T&E policy change; EXP-4480 awaiting approval.', 'تغيير سياسة السفر للربع الرابع؛ EXP-4480 بانتظار الاعتماد.'], ['Discussion room', 'اجتماع العمل']]] },
};

export const MEM_VER: [number, string, string, [string, string]][] = [[14, '8 Oct 2026', 'exp', ['Added taxi VAT exception (approved by Fatima Noor)', 'أُضيف استثناء ضريبة التاكسي (اعتمدته فاطمة نور)']], [13, '1 Oct 2026', 'u3', ['Updated Riyadh per-diem to AED 900', 'تحديث بدل الرياض إلى 900 د.إ']], [12, '14 Sep 2026', 'exp', ['Added 90-day escalation rule', 'إضافة قاعدة تصعيد 90 يوماً']]];
