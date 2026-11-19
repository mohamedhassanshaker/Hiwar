/** A node of the module's org chart sample, which the agent seed reads for reporting lines. */
type OrgNode = { id: string; sub: [string, string]; unit: string; parent: string | null };
import type { Agent, Person } from "@/types/directory";

export const AGENTS: Agent[] = [
  { id: 'exp', ini: 'ER', name: 'Expense Reviewer', nameAr: 'مراجع المصروفات', unit: 'Finance', unitAr: 'المالية', ver: 'v7', model: 'gpt-4.1-mini', status: 'Running', profile: 'task', runs: 1204, cost: 186.4 },
  { id: 'sup', ini: 'CA', name: 'Customer Assistant', nameAr: 'مساعد المتعاملين', unit: 'Customer Service', unitAr: 'خدمة المتعاملين', ver: 'v12', model: 'claude-haiku-4.5', status: 'Running', profile: 'conversational', runs: 8932, cost: 412.9 },
  { id: 'prc', ini: 'PP', name: 'Procurement Planner', nameAr: 'مخطط المشتريات', unit: 'Procurement', unitAr: 'المشتريات', ver: 'v2', model: 'gpt-4.1', status: 'Waiting', profile: 'task', runs: 96, cost: 58.7 },
  { id: 'bug', ini: 'BT', name: 'Bug Triage', nameAr: 'فرز الأخطاء', unit: 'IT', unitAr: 'تقنية المعلومات', ver: 'v5', model: 'claude-sonnet-4.5', status: 'Error', profile: 'workbench', runs: 311, cost: 97.3 },
  { id: 'rec', ini: 'RC', name: 'Reconciliation Agent', nameAr: 'وكيل التسويات', unit: 'Finance', unitAr: 'المالية', ver: 'v3', model: 'gpt-4.1-mini', status: 'Idle', profile: 'task', runs: 452, cost: 63.1 },
  { id: 'kb', ini: 'KC', name: 'Knowledge Curator', nameAr: 'منسق المعرفة', unit: 'Platform', unitAr: 'المنصة', ver: 'v1', model: 'claude-haiku-4.5', status: 'Paused', profile: 'task', runs: 77, cost: 12.4 },
  // S-03: the assistant every console screen opens. A platform agent, not a department's,
  // and it answers only about the screen it is bound to.
  { id: 'pa', ini: 'PA', name: 'Platform Assistant', nameAr: 'مساعد المنصة', unit: 'Platform', unitAr: 'المنصة', ver: 'v1', model: 'claude-haiku-4.5', status: 'Idle', profile: 'conversational', runs: 0, cost: 0 },
  // The one agent a fresh install can put to work immediately: the default knowledge base,
  // and the skills and connectors no department owns.
  { id: 'def', ini: 'DA', name: 'Default Agent', nameAr: 'الوكيل الافتراضي', unit: 'Platform', unitAr: 'المنصة', ver: 'v1', model: 'claude-haiku-4.5', status: 'Idle', profile: 'conversational', runs: 0, cost: 0 },
];

export const PEOPLE: Person[] = [
  { id: 'u1', ini: 'MA', photo: null, name: 'Mariam Al Suwaidi', nameAr: 'مريم السويدي', role: 'Platform Owner', roleAr: 'مالكة المنصة', email: 'mariam@hiwar.example' },
  { id: 'u2', ini: 'KH', photo: null, name: 'Khalid Hassan', nameAr: 'خالد حسن', role: 'Work Lead', roleAr: 'قائد العمل', email: 'khalid@hiwar.example' },
  { id: 'u3', ini: 'FN', photo: null, name: 'Fatima Noor', nameAr: 'فاطمة نور', role: 'Approver', roleAr: 'معتمدة', email: 'fatima@hiwar.example' },
  { id: 'u4', ini: 'OR', photo: null, name: 'Omar Rashid', nameAr: 'عمر راشد', role: 'Agent Designer', roleAr: 'مصمم الوكلاء', email: 'omar@hiwar.example' },
  { id: 'u5', ini: 'LA', photo: null, name: 'Layla Ahmed', nameAr: 'ليلى أحمد', role: 'Member', roleAr: 'عضو', email: 'layla@hiwar.example' },
  // A second person who may administer, so that separation of duty is demonstrable: a
  // memory or an approval nobody else can decide is a rule the organisation cannot show.
  { id: 'u6', ini: 'NM', photo: null, name: 'Noura Al Marri', nameAr: 'نورة المري', role: 'Administrator', roleAr: 'مسؤولة', email: 'noura@hiwar.example' },
  // Read everything, change nothing: what an auditor may do is a rule of its own.
  { id: 'u7', ini: 'HM', photo: null, name: 'Hessa Al Mansoori', nameAr: 'حصة المنصوري', role: 'Auditor', roleAr: 'مدققة', email: 'hessa@hiwar.example' },
];

/** The system roles. The screens count the people who hold one rather than being told. */
export const ROLES: [en: string, ar: string][] = [
  ['Platform Owner', 'مالك المنصة'], ['Administrator', 'مسؤول'], ['Agent Designer', 'مصمم الوكلاء'], ['Publisher', 'ناشر'], ['Work Lead', 'قائد العمل'], ['Member', 'عضو'], ['Approver', 'معتمد'], ['Auditor', 'مدقق'], ['Guest', 'ضيف'], ['Widget visitor', 'زائر الويدجت'],
];

export const ORG: OrgNode[] = [
  { id: 'u1', sub: ['Platform Owner', 'مالكة المنصة'], unit: 'Platform', parent: null },
  { id: 'u3', sub: ['Finance', 'المالية'], unit: 'Finance', parent: 'u1' },
  { id: 'exp', sub: ['v7', 'v7'], unit: 'Finance', parent: 'u3' },
  { id: 'rec', sub: ['v3', 'v3'], unit: 'Finance', parent: 'u3' },
  { id: 'u2', sub: ['Procurement · Service', 'المشتريات · الخدمة'], unit: 'Procurement', parent: 'u1' },
  { id: 'prc', sub: ['v2', 'v2'], unit: 'Procurement', parent: 'u2' },
  { id: 'sup', sub: ['v12', 'v12'], unit: 'Customer Service', parent: 'u2' },
  { id: 'u4', sub: ['IT', 'تقنية المعلومات'], unit: 'IT', parent: 'u1' },
  { id: 'bug', sub: ['v5', 'v5'], unit: 'IT', parent: 'u4' },
  { id: 'u5', sub: ['Member', 'عضو'], unit: 'Finance', parent: 'u4' },
  { id: 'u6', sub: ['Administrator', 'مسؤولة'], unit: 'Platform', parent: 'u1' },
  { id: 'u7', sub: ['Auditor', 'مدققة'], unit: 'Platform', parent: 'u1' },
  { id: 'kb', sub: ['v1', 'v1'], unit: 'Platform', parent: 'u1' },
  { id: 'def', sub: ['v1', 'v1'], unit: 'Platform', parent: 'u1' },
];

export const ORG_UNITS: [string, string, string, number, number, number][] = [
  ['Platform', 'المنصة', 'u1', 2, 2, 0], ['Finance', 'المالية', 'u3', 14, 2, 1], ['Procurement', 'المشتريات', 'u2', 4, 1, 2], ['Customer Service', 'خدمة المتعاملين', 'u2', 22, 1, 0], ['IT', 'تقنية المعلومات', 'u4', 9, 1, 1],
];

export const PEOPLE_UNITS: Record<string, string> = { u1: 'Platform', u2: 'Procurement', u3: 'Finance', u4: 'IT', u5: 'Finance', u6: 'Platform', u7: 'Platform' };
