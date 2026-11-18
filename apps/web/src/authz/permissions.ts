/**
 * The permission catalogue (data model section 3, `Permission`).
 *
 * Specification section 9: "Permission sets, not role names; explicit deny wins." Every
 * server action, route handler and MCP tool names one of these codes; no caller ever tests
 * a role name. The seed writes the catalogue into `core.permission` and the nine system
 * roles into `core.role` and `core.role_permission`.
 */

export const PERMISSIONS = {
  // Work
  "projects:read": { en: "See projects and their members", ar: "عرض المشاريع وأعضائها" },
  "projects:write": { en: "Create and change projects", ar: "إنشاء المشاريع وتعديلها" },
  "rooms:read": { en: "See discussion rooms and their messages", ar: "عرض اجتماعات العمل ورسائلها" },
  "rooms:write": { en: "Take part in a discussion room", ar: "المشاركة في اجتماع العمل" },
  "rooms:moderate": { en: "Close, fork and set turn-taking in a room", ar: "إغلاق الاجتماع وتفريعه وضبط تبادل الأدوار" },
  "work_items:read": { en: "See work items", ar: "عرض بنود العمل" },
  "work_items:write": { en: "Create and change work items", ar: "إنشاء بنود العمل وتعديلها" },
  "work_items:review": { en: "Review and approve work", ar: "مراجعة العمل واعتماده" },
  "requests:read": { en: "See requests", ar: "عرض الطلبات" },
  "requests:write": { en: "Submit and act on requests", ar: "تقديم الطلبات والتصرف فيها" },
  "request_types:write": { en: "Design request types", ar: "تصميم أنواع الطلبات" },
  // `UC-30.4-02`: publishing is separate from designing, because a published version is
  // what every request of that type then follows and is immutable from then on.
  "request_types:publish": { en: "Publish a request type version", ar: "نشر إصدار نوع طلب" },
  "schedules:read": { en: "See scheduled work items", ar: "عرض بنود العمل المجدولة" },
  "schedules:write": { en: "Create and change scheduled work items", ar: "إنشاء بنود العمل المجدولة وتعديلها" },
  "files:read": { en: "See artifacts and files", ar: "عرض المخرجات والملفات" },
  "files:write": { en: "Upload and change artifacts and files", ar: "رفع المخرجات والملفات وتعديلها" },

  // Organisation and identity
  "organisation:read": { en: "See the organisation, its units and people", ar: "عرض الجهة ووحداتها وموظفيها" },
  "organisation:write": { en: "Change org units, people and reporting lines", ar: "تعديل الوحدات التنظيمية والموظفين والتسلسل" },
  "permissions:write": { en: "Change roles and permissions", ar: "تعديل الأدوار والصلاحيات" },
  "registrations:approve": { en: "Approve or decline new registrations", ar: "اعتماد طلبات التسجيل الجديدة أو رفضها" },

  // AI capabilities
  "agents:read": { en: "See agents and their runs", ar: "عرض الوكلاء وعملياتهم" },
  "agents:write": { en: "Design agents and their versions", ar: "تصميم الوكلاء وإصداراتهم" },
  "agents:publish": { en: "Publish and roll back an agent version", ar: "نشر إصدار الوكيل والتراجع عنه" },
  "agents:invoke": { en: "Start an agent run", ar: "بدء عملية وكيل" },
  // Separate from `agents:write` because it governs the one agent the platform itself
  // depends on: changing the built-in Assistant's configuration, and resetting it to the
  // defaults it shipped with (D65, decision (h)). Administrators hold it.
  "agents:configure": {
    en: "Configure the built-in assistant",
    ar: "ضبط إعدادات المساعد المدمج",
  },
  "skills:read": { en: "See skills", ar: "عرض المهارات" },
  "skills:write": { en: "Import, author and publish skills", ar: "استيراد المهارات وتأليفها ونشرها" },
  "connectors:read": { en: "See connectors and their tools", ar: "عرض التكاملات وأدواتها" },
  "connectors:write": { en: "Register connectors and set tool tiers", ar: "تسجيل التكاملات وضبط مستويات الأدوات" },
  "memory:read": { en: "See memory scopes and their content", ar: "عرض نطاقات الذاكرة ومحتواها" },
  "memory:write": { en: "Write and review memory", ar: "الكتابة في الذاكرة ومراجعتها" },
  "knowledge:read": { en: "See knowledge collections", ar: "عرض مجموعات قاعدة المعرفة" },
  "knowledge:search": { en: "Search and test retrieval", ar: "البحث واختبار الاسترجاع" },
  "knowledge:write": { en: "Create collections and run ingestion", ar: "إنشاء المجموعات وتشغيل الاستيعاب" },
  "models:read": { en: "See model providers and routes", ar: "عرض مزوّدي النماذج والمسارات" },
  "models:write": { en: "Change providers, connections and routes", ar: "تعديل المزوّدين والاتصالات والمسارات" },
  "channels:read": { en: "See channels and deployments", ar: "عرض القنوات وعمليات النشر" },
  "channels:write": { en: "Configure channels, deployments and storylines", ar: "إعداد القنوات وعمليات النشر والقصص" },
  // D343: what visitors said is customer data, apart from configuring where they say it.
  "conversations:read": { en: "See visitor conversations and their messages", ar: "عرض محادثات الزوار ورسائلها" },
  "conversations:answer": { en: "Take over and answer visitor conversations", ar: "تولّي محادثات الزوار والرد عليها" },

  // Human in the loop
  "inbox:read": { en: "See your inbox", ar: "عرض صندوق الوارد" },
  "approvals:decide": { en: "Approve, reject or request changes", ar: "الاعتماد أو الرفض أو طلب التعديل" },

  // Governance
  "budgets:read": { en: "See budgets and estimated costs", ar: "عرض تكاليف تشغيل الذكاء الاصطناعي" },
  "budgets:write": { en: "Set budgets and their actions", ar: "ضبط حدود الإنفاق وإجراءاتها" },
  "audit:read": { en: "Read the audit log", ar: "قراءة سجل الإجراءات" },
  "logs:read": { en: "Read the service logs", ar: "قراءة سجلات الخدمات" },
  "settings:read": { en: "See platform settings", ar: "عرض إعدادات المنصة" },
  "settings:write": { en: "Change platform settings and branding", ar: "تعديل إعدادات المنصة والهوية" },
  "integrations:read": { en: "See integration clients", ar: "عرض عملاء التكامل" },
  "integrations:write": { en: "Create clients, keys and exposures", ar: "إنشاء العملاء والمفاتيح وواجهات الكشف" },
  "system:read": { en: "See system health", ar: "عرض حالة النظام" },
  "system:operate": { en: "Pause and resume all agents", ar: "إيقاف جميع الوكلاء واستئنافهم" },
  "exports:create": { en: "Export a list or a report", ar: "تصدير قائمة أو تقرير" },
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

/**
 * The nine system roles of specification 7.3.2, as permission sets. A role is only ever a
 * convenient way to assign a set; the evaluator never sees a role name.
 */
/**
 * The nine system roles and what each may do.
 *
 * Every role but Guest carries `organisation:read`. The Org chart, People & roles and Org
 * units sit in the Organisation navigation group, not in Govern, and `UC-01.1-05` lists
 * what an ordinary Member is refused — those three are not in it, and `UC-40.2-03` has a
 * Member open the chart and select someone. Knowing who works here, and who they report
 * to, is ordinary staff information; what an admin has that they do not is
 * `organisation:write`. Guest is excluded: an external participant is limited to the
 * projects and rooms they were added to.
 */
export const SYSTEM_ROLES: Record<string, { en: string; ar: string; allow: readonly PermissionCode[] }> = {
  PlatformOwner: {
    en: "Platform Owner",
    ar: "مالك المنصة",
    allow: PERMISSION_CODES,
  },
  Administrator: {
    en: "Administrator",
    ar: "مدير النظام",
    // Everything the platform does, except granting permissions: that stays with the owner.
    allow: PERMISSION_CODES.filter((code) => code !== "permissions:write"),
  },
  AgentDesigner: {
    en: "Agent Designer",
    ar: "مصمم الوكلاء",
    allow: [
      "agents:read",
      "agents:write",
      "agents:invoke",
      "skills:read",
      "skills:write",
      "connectors:read",
      "memory:read",
      "knowledge:read",
      "knowledge:search",
      "models:read",
      "organisation:read",
      "projects:read",
      "rooms:read",
      "work_items:read",
      "inbox:read",
      "budgets:read",
    ],
  },
  Publisher: {
    en: "Publisher",
    ar: "الناشر",
    allow: [
      "agents:read",
      "agents:publish",
      "skills:read",
      "skills:write",
      "request_types:write",
      "request_types:publish",
      "channels:read",
      "channels:write",
      "inbox:read",
      "organisation:read",
    ],
  },
  WorkLead: {
    en: "Work Lead",
    ar: "قائد العمل",
    allow: [
      "projects:read",
      "projects:write",
      "rooms:read",
      "rooms:write",
      "rooms:moderate",
      "work_items:read",
      "work_items:write",
      "work_items:review",
      "requests:read",
      "requests:write",
      "schedules:read",
      "schedules:write",
      "files:read",
      "files:write",
      "agents:read",
      "agents:invoke",
      "inbox:read",
      "approvals:decide",
      "exports:create",
      "organisation:read",
    ],
  },
  Member: {
    en: "Member",
    ar: "عضو",
    allow: [
      "projects:read",
      "rooms:read",
      "rooms:write",
      "work_items:read",
      "work_items:write",
      "requests:read",
      "requests:write",
      "schedules:read",
      "files:read",
      "files:write",
      "agents:read",
      "agents:invoke",
      "knowledge:read",
      "knowledge:search",
      "inbox:read",
      "organisation:read",
    ],
  },
  Approver: {
    en: "Approver",
    ar: "المعتمد",
    allow: ["inbox:read", "approvals:decide", "requests:read", "work_items:read", "rooms:read", "projects:read", "organisation:read"],
  },
  Auditor: {
    en: "Auditor",
    ar: "المدقق",
    allow: [
      "audit:read",
      "logs:read",
      "settings:read",
      "budgets:read",
      "projects:read",
      "rooms:read",
      "work_items:read",
      "requests:read",
      "agents:read",
      "exports:create",
      "organisation:read",
    ],
  },
  Guest: {
    en: "Guest",
    ar: "ضيف",
    allow: ["projects:read", "rooms:read", "work_items:read"],
  },
  /**
   * The service account a widget's agent acts as for an anonymous visitor (D221): it may start
   * the agent and search knowledge, and nothing else, because whatever it may read the visitor
   * may be told.
   */
  WidgetVisitor: {
    en: "Widget visitor",
    ar: "زائر الويدجت",
    allow: ["agents:invoke", "knowledge:read", "knowledge:search"],
  },
};

/**
 * The one permission each system role exists for, which editing may never remove
 * (`UC-41.2-05`).
 *
 * A system role whose defining permission can be taken away stops being that role while
 * keeping its name, and every person holding it loses the ability silently. Platform Owner
 * matters most: `permissions:write` is how permissions are granted at all, so a platform
 * that lost it could not be repaired from inside itself.
 *
 * Everything else a system role carries stays editable — this locks the definition, not the
 * whole set.
 */
export const CORE_PERMISSIONS: Record<string, PermissionCode> = {
  PlatformOwner: "permissions:write",
  Administrator: "organisation:write",
  AgentDesigner: "agents:write",
  Publisher: "agents:publish",
  WorkLead: "work_items:review",
  Member: "work_items:write",
  Approver: "approvals:decide",
  Auditor: "audit:read",
  Guest: "projects:read",
  WidgetVisitor: "agents:invoke",
};
