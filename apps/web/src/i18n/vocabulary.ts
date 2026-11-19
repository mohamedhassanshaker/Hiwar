/**
 * The status, sensitivity and priority words the screens share. The database stores the
 * English token (data model section 21); the Arabic label and the tag tone belong to the
 * presentation layer and live here, so one token reads the same wherever it is shown.
 */

export const stAr: Record<string, string> = { 'In Progress': 'قيد التنفيذ', Planned: 'مخطط', Paused: 'متوقف', Done: 'منجز', Backlog: 'قائمة الانتظار', Archived: 'مؤرشف', Confidential: 'سري', Internal: 'داخلي', Restricted: 'مقيد', Public: 'عام', Published: 'منشور', Draft: 'مسودة', Retired: 'متقاعد', Enabled: 'مفعّل', Disabled: 'معطّل', Degraded: 'أداء منخفض', Error: 'خطأ', Healthy: 'سليم', Active: 'نشط', Inactive: 'معطّل', Submitted: 'مقدم', 'In review': 'قيد المراجعة', InReview: 'قيد المراجعة', InProgress: 'قيد التنفيذ', ToDo: 'للتنفيذ', Blocked: 'معطّل', Approved: 'معتمد', Rejected: 'مرفوض', Completed: 'مكتمل', Triage: 'فرز' };

export const stTone: Record<string, string> = { 'In Progress': 'info', Planned: 'neutral', Paused: 'warning', Done: 'success', Published: 'success', Draft: 'neutral', Retired: 'neutral', Enabled: 'success', Disabled: 'neutral', Degraded: 'warning', Error: 'danger', Healthy: 'success', Restricted: 'danger', Confidential: 'warning', Internal: 'neutral', Public: 'neutral', Active: 'success', Inactive: 'neutral', Submitted: 'info', 'In review': 'warning', InReview: 'warning', InProgress: 'info', ToDo: 'neutral', Blocked: 'danger', Approved: 'success', Rejected: 'danger', Completed: 'success', Triage: 'warning' };

export const priTone: Record<string, string> = { High: 'danger', Medium: 'warning', Low: 'neutral' };

export const priAr: Record<string, string> = { High: 'عالية', Medium: 'متوسطة', Low: 'منخفضة', Task: 'مهمة', Bug: 'خطأ', Subtask: 'بند فرعي' };

export const stTone2: Record<string, string> = { Backlog: 'neutral', Todo: 'neutral', ToDo: 'neutral', InProgress: 'info', InReview: 'warning', Blocked: 'danger', Done: 'success', Cancelled: 'neutral' };

/** `work.work_item.status` tokens, as the board columns and the lists write them. */
export const workItemStatus: Record<string, [string, string]> = {
  Backlog: ['Backlog', 'قائمة الانتظار'],
  ToDo: ['To do', 'للتنفيذ'],
  Todo: ['To do', 'للتنفيذ'],
  InProgress: ['In progress', 'قيد التنفيذ'],
  InReview: ['In review', 'قيد المراجعة'],
  Blocked: ['Blocked', 'معطّل'],
  Done: ['Done', 'منجز'],
  Cancelled: ['Cancelled', 'ملغى'],
};

/** `work.request.status` tokens. */
export const requestStatus: Record<string, [string, string]> = {
  Triage: ['Triage', 'فرز'],
  Submitted: ['Submitted', 'مقدم'],
  InReview: ['In review', 'قيد المراجعة'],
  Approved: ['Approved', 'معتمد'],
  Rejected: ['Rejected', 'مرفوض'],
  Completed: ['Completed', 'مكتمل'],
};

/** `ai.run.status` tokens. */
export const runStatus: Record<string, [string, string, string]> = {
  Queued: ['neutral', 'Queued', 'في الطابور'],
  Running: ['info', 'Running', 'قيد التشغيل'],
  // What a Waiting run is blocked on is decided per run (`Run.waitingOn`), not by the
  // status: it is set both for an approval and for a question to a person.
  Waiting: ['warning', 'Waiting', 'بانتظار'],
  Succeeded: ['success', 'Completed', 'مكتملة'],
  Failed: ['danger', 'Failed', 'فشلت'],
  Cancelled: ['neutral', 'Cancelled', 'ملغاة'],
  BudgetExceeded: ['danger', 'Budget exceeded', 'تجاوز الميزانية'],
};

/** The Arabic label and tag tone of an agent's run status. */
export const agentStatus = (s: string) =>
  ({
    Running: { tone: 'info', en: 'Running', ar: 'قيد التشغيل' },
    Idle: { tone: 'neutral', en: 'Idle', ar: 'خامل' },
    Waiting: { tone: 'warning', en: 'Waiting', ar: 'بانتظار' },
    Error: { tone: 'danger', en: 'Error', ar: 'خطأ' },
    Paused: { tone: 'neutral', en: 'Paused', ar: 'متوقف مؤقتاً' },
    Draft: { tone: 'neutral', en: 'Draft', ar: 'مسودة' },
  } as const)[s as 'Running'] ?? { tone: 'neutral', en: s, ar: s };

/** Discussion rooms (S-22): status, type and source. CHANGELOG section 16 made the statuses masculine. */
export const sesTone: Record<string, string> = { Active: 'success', Idle: 'neutral', Paused: 'warning', Closed: 'neutral', Archived: 'neutral' };

export const sesAr: Record<string, string> = { Active: 'نشط', Idle: 'خامل', Paused: 'متوقف', Closed: 'مغلق', Archived: 'مؤرشف', Review: 'مراجعة', Chat: 'محادثة', 'War-room': 'غرفة طوارئ', Support: 'دعم', Automation: 'أتمتة', Console: 'الوحدة', Teams: 'Teams', Slack: 'Slack', Widget: 'ويدجت', Routine: 'روتين' };

/** Inbox (S-12): `[english, arabic, tone]` per item kind. */
export const kindLbl: Record<string, [string, string, string]> = { approval: ['Approval', 'اعتماد', 'warning'], question: ['Agent question', 'سؤال من وكيل', 'info'], mention: ['Mention', 'إشارة', 'neutral'], sla: ['SLA warning', 'تنبيه اتفاقية خدمة', 'danger'], review: ['Review', 'مراجعة', 'brand'], update: ['Update', 'تحديث', 'info'] };

/** Runs (S-52): `[tone, english, arabic]` per run status. */
export const runSt: Record<string, [string, string, string]> = { Waiting: ['warning', 'Waiting', 'بانتظار'], Running: ['info', 'Running', 'قيد التشغيل'], Completed: ['success', 'Completed', 'مكتملة'], Failed: ['danger', 'Failed', 'فشلت'], Cancelled: ['neutral', 'Cancelled', 'ملغاة'], Idle: ['neutral', 'Idle', 'خامل'] };

/** Storylines (S-62): the tag tone of each step type. */
export const stepTone: Record<string, string> = { say: 'neutral', verify: 'warning', ask: 'brand', form: 'brand', decide: 'info', classify: 'info', tool: 'success', skill: 'success', confirm: 'brand', create_work: 'success', handoff: 'warning', wait: 'neutral', subflow: 'neutral', goto: 'neutral', end: 'neutral' };

/** Skills (S-53): the badge on a skill. */
export const bTone: Record<string, string> = { Installed: 'success', Bundled: 'brand', 'Pending scan': 'warning', Required: 'info', Deprecated: 'neutral' };

export const bAr: Record<string, string> = { Installed: 'مثبتة', Bundled: 'مضمّنة', 'Pending scan': 'بانتظار الفحص', Required: 'إلزامية', Deprecated: 'مهملة' };

/** Memory (S-55). */
export const memTone: Record<string, string> = { Active: 'success', 'Pending review': 'warning', 'Needs attention': 'danger' };

export const memAr: Record<string, string> = { Active: 'نشط', 'Pending review': 'بانتظار المراجعة', 'Needs attention': 'تحتاج انتباهاً', Organisation: 'الجهة', 'Business unit': 'وحدة العمل', Agent: 'وكيل', Session: 'جلسة' };

/** Knowledge sources (S-56). */
export const srcTone: Record<string, string> = { Indexed: 'success', Failed: 'danger', Queued: 'info' };

export const srcAr: Record<string, string> = { Indexed: 'مفهرس', Failed: 'فشل', Queued: 'في الطابور' };

/** Budgets (S-71, S-72). */
export const bTone2: Record<string, string> = { Active: 'success', Planned: 'info', Expired: 'neutral' };

export const bLbl: Record<string, [string, string]> = { Active: ['Active', 'نشط'], Planned: ['Scheduled', 'مجدولة'], Expired: ['Expired', 'منتهية'] };

export const perAr: Record<string, string> = { Monthly: 'شهري', Daily: 'يومي', Weekly: 'أسبوعي', Quarterly: 'فصلي' };

export const hardAr: Record<string, string> = { 'Notify only': 'إشعار فقط', 'Switch to cheaper alias': 'مسار أرخص', 'Pause agent': 'إيقاف الوكيل' };

/** What a `Waiting` run is blocked on (`Run.waitingOn`), as the run list writes it. */
export const runWaitingOn: Record<string, [string, string]> = {
  Approval: ['Waiting · approval', 'بانتظار · اعتماد'],
  Question: ['Waiting · your answer', 'بانتظار · إجابتك'],
  Unknown: ['Waiting · nothing to decide', 'بانتظار · لا قرار معلّق'],
};
