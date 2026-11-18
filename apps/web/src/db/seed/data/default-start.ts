/**
 * The clean default a fresh install starts from: one project, the organisation's seven
 * request types, one knowledge collection and the one agent that reaches it — nothing a
 * real deployment would have to delete before it means anything.
 */

export const DEFAULT_PROJECT = { k: "GEN", n: "General", nAr: "عام" };

type RequestTypeSeed = { c: string; n: string; nAr: string; cat: string; dec: string };

/** Every type decomposes as a plain template form: the simplest, always-available shape. */
export const DEFAULT_REQUEST_TYPES: RequestTypeSeed[] = [
  { c: "CHG", n: "Change Request", nAr: "طلب تغيير", cat: "General", dec: "none" },
  { c: "FEA", n: "New Feature Development", nAr: "تطوير ميزة جديدة", cat: "General", dec: "none" },
  { c: "TSK", n: "Task", nAr: "مهمة", cat: "General", dec: "none" },
  { c: "BUG", n: "Bug", nAr: "خطأ", cat: "General", dec: "none" },
  { c: "DEP", n: "Deployment", nAr: "نشر", cat: "General", dec: "none" },
  { c: "ENR", n: "Entity Enrolment", nAr: "تسجيل كيان", cat: "General", dec: "none" },
  { c: "MER", n: "Merchant Enrolment", nAr: "تسجيل تاجر", cat: "General", dec: "none" },
];

export const DEFAULT_COLLECTION = { code: "default-kb", nameEn: "Default knowledge base", nameAr: "قاعدة المعرفة الافتراضية" };

/** The one agent every fresh install can put to work immediately. */
export const DEFAULT_AGENT = { id: "def", name: "Default Agent", nameAr: "الوكيل الافتراضي", ini: "DA", unit: "Platform", unitAr: "المنصة" };

/** Domain-agnostic skills — none of them name a department's own policy or system. */
export const DEFAULT_SKILLS = [
  "task-planning",
  "work-item-execution",
  "bilingual-writing",
  "request-triage",
  "guided-platform-creation",
  "platform-operations",
];

/** Connectors every install can reach without a department-specific credential first. */
export const DEFAULT_CONNECTORS = ["platform"];
