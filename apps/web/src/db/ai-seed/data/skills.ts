/** The prototype's skill packages. */
type SkillSeed = {
  n: string;
  src: string;
  v: string;
  d: string;
  dAr: string;
  tags: string[];
  agents: number;
  b: string;
  /** `allowed-tools` from the skill's frontmatter: what it needs to do its job. */
  tools: string[];
};

export const SKILLS: SkillSeed[] = [
  { n: 'expense-claim-review', src: 'Console', v: '2.1.0', d: 'Review an employee expense claim against the travel and expense policy and produce an approve/return recommendation with reasons.', dAr: 'مراجعة مطالبة مصروفات وفق سياسة السفر وإصدار توصية بالاعتماد أو الإرجاع مع الأسباب.', tags: ['finance', 'policy'], agents: 2, b: 'Installed', tools: ['erp/claims.read', 'knowledge_search'] },
  { n: 'receipt-extraction', src: 'Bundled', v: '1.4.2', d: 'Extract merchant, date, amount and VAT from receipt images and PDFs.', dAr: 'استخراج التاجر والتاريخ والمبلغ والضريبة من صور الإيصالات وملفات PDF.', tags: ['ocr'], agents: 3, b: 'Bundled', tools: [] },
  { n: 'quote-comparison', src: 'Console', v: '0.1.0', d: 'Compare vendor quotes on price, delivery and terms and recommend one.', dAr: 'مقارنة عروض الموردين من حيث السعر والتسليم والشروط والتوصية بأحدها.', tags: ['procurement'], agents: 0, b: 'Pending scan', tools: ['erp/vendors.search'] },
  { n: 'task-planning', src: 'Bundled', v: '3.0.1', d: 'Decompose a task into sub items with dependencies, assignees and estimates.', dAr: 'تجزئة مهمة إلى بنود فرعية مع التبعيات والمسؤولين والتقديرات.', tags: ['planning', 'required'], agents: 7, b: 'Required', tools: [] },
  { n: 'defect-report', src: 'Git', v: '1.2.0', d: 'Fill a bug with severity, steps to reproduce, expected vs actual and evidence.', dAr: 'تعبئة بلاغ خطأ بالخطورة وخطوات الإعادة والمتوقع مقابل الفعلي والأدلة.', tags: ['qa'], agents: 1, b: 'Installed', tools: ['sandbox-fs/read_file'] },
  { n: 'policy-lookup', src: 'Registry', v: '0.9.0', d: 'Find and quote the relevant clause from organisation policies with citation.', dAr: 'إيجاد البند ذي الصلة من سياسات الجهة واقتباسه مع الإسناد.', tags: ['knowledge'], agents: 2, b: 'Deprecated', tools: ['knowledge_search'] },
  { n: 'request-triage', src: 'Bundled', v: '1.0.0', d: 'Classify an incoming request — its type, its priority and its owner — and ask for the one fact that settles it when the description is too thin.', dAr: 'تصنيف الطلب الوارد — نوعه وأولويته ومالكه — وطلب الحقيقة الوحيدة التي تحسمه عندما يكون الوصف ناقصاً.', tags: ['requests'], agents: 1, b: 'Bundled', tools: [] },
  { n: 'work-item-execution', src: 'Bundled', v: '1.0.0', d: 'Complete a work item assigned to an agent — read the frame, work the plan, produce the output its acceptance criteria describe, and leave a handoff.', dAr: 'إنجاز بند عمل مسند إلى وكيل — قراءة الإطار وتنفيذ الخطة وإنتاج المخرج الذي تصفه معايير القبول وترك تسليم للسياق.', tags: ['work'], agents: 2, b: 'Bundled', tools: [] },
  { n: 'bilingual-writing', src: 'Bundled', v: '1.0.0', d: "Write every message, title and summary in the reader's language, with the Arabic terminology Hiwar uses and the right handling of numbers, dates and names.", dAr: 'كتابة كل رسالة وعنوان وملخص بلغة القارئ، بالمصطلحات العربية التي يستخدمها حوار والتعامل الصحيح مع الأرقام والتواريخ والأسماء.', tags: ['localisation'], agents: 3, b: 'Bundled', tools: [] },
  { n: 'platform-operations', src: 'Bundled', v: '1.0.0', d: 'Carry out work on the platform that takes one or many consecutive actions through the Platform connector, with the authority of the person asking.', dAr: 'تنفيذ عمل على المنصة يتطلب إجراءً واحداً أو عدة إجراءات متتالية عبر موصل المنصة، بصلاحيات الشخص الطالب.', tags: ['platform', 'built-in'], agents: 2, b: 'Bundled', tools: ['project_list', 'request_list', 'request_read', 'work_item_search', 'work_item_read', 'person_list', 'role_list'] },
  { n: 'guided-platform-creation', src: 'Bundled', v: '1.0.0', d: 'Create or configure any platform object — request type, project, agent, skill, knowledge collection — by discovering available options from live data and asking step-by-step questions.', dAr: 'إنشاء أو تكوين أي كائن منصة — نوع طلب أو مشروع أو وكيل أو مهارة أو مجموعة معرفة — من خلال اكتشاف الخيارات المتاحة من البيانات الحية وطرح أسئلة خطوة بخطوة.', tags: ['setup', 'platform'], agents: 1, b: 'Bundled', tools: ['project_list', 'role_list', 'request_type_create', 'request_type_attribute_create'] },
];
