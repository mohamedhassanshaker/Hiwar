import type { Project } from "@/types/directory";

export const PROJECTS: Project[] = [
  { k: 'FIN', n: 'Finance Operations', nAr: 'العمليات المالية', st: 'In Progress', own: 'u3', unit: 'Finance', sens: 'Confidential', items: 64, prog: 58 },
  { k: 'PRC', n: 'Procurement Setup', nAr: 'إعداد المشتريات', st: 'Planned', own: 'u2', unit: 'Procurement', sens: 'Internal', items: 12, prog: 8 },
  { k: 'CS', n: 'Customer Service', nAr: 'خدمة المتعاملين', st: 'In Progress', own: 'u2', unit: 'Customer Service', sens: 'Restricted', items: 211, prog: 71 },
  { k: 'IT', n: 'Platform Reliability', nAr: 'موثوقية المنصة', st: 'In Progress', own: 'u4', unit: 'IT', sens: 'Internal', items: 39, prog: 44 },
  { k: 'KB', n: 'Knowledge Refresh 2026', nAr: 'تحديث المعرفة 2026', st: 'Paused', own: 'u5', unit: 'Platform', sens: 'Internal', items: 18, prog: 33 },
];

