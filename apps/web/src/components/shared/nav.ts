import { can, type Principal } from "@/authz/evaluate";
import { SCREEN_PERMISSION } from "@/authz/screens";
import type { ScreenId } from "@/lib/routes";

/**
 * The navigation groups the shell draws, in order (specification section 6):
 * `[screen id, english, arabic, icon]`.
 */
export type NavItem = [ScreenId, string, string, string];

export type NavGroup = { h: [string, string] | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  { h: null, items: [['dashboard', 'Dashboard', 'لوحة المعلومات', 'DashboardDS'], ['inbox', 'Inbox', 'صندوق الوارد', 'InboxDS']] },
  { h: ['Work', 'إدارة الأعمال'], items: [['projects', 'Projects', 'المشاريع', 'Folder2'], ['sessions', 'Discussion Rooms', 'اجتماعات العمل', 'Chat'], ['tasks', 'Work Items', 'بنود العمل', 'Ticket03'], ['requests', 'Requests', 'الطلبات', 'Invoice01'], ['requestTypes', 'Request types', 'أنواع الطلبات', 'Notebook'], ['routines', 'Scheduled Work Items', 'بنود العمل المجدولة', 'Calendar03'], ['artifacts', 'Artifacts', 'المخرجات', 'File01'], ['files', 'Files', 'الملفات', 'Download04']] },
  // D388: inquiries over requests and work items, with a PDF of what matches.
  { h: ["Reports", "التقارير"], items: [["requestsReport", "Requests report", "تقرير الطلبات", "Invoice01"], ["workItemsReport", "Work items report", "تقرير بنود العمل", "Ticket03"]] },
  // `orgchart` has no nav entry (owner, 2026-11-01: not needed for now): the screen stays
  // reachable by address.
  { h: ['Organisation', 'الجهة'], items: [['people', 'People & roles', 'الأشخاص والأدوار', 'Profile02'], ['units', 'Org units', 'الوحدات التنظيمية', 'Bank']] },
  { h: ['AI Capabilities', 'قدرات الذكاء الاصطناعي'], items: [['agents', 'Agents', 'الوكلاء', 'User'], ['skills', 'Skills', 'المهارات', 'SkillsDS'], ['connectors', 'Connectors', 'التكامل', 'PlugDS'], ['memory', 'Memory', 'الذاكرة', 'SquareLock02'], ['knowledge', 'Knowledge', 'قاعدة المعرفة', 'InformationDiamond'], ['models', 'Models & routes', 'النماذج والمسارات', 'Sorting02'], ['channels', 'Channels', 'القنوات', 'Mail01'], ['deployments', 'Embedded Deployment', 'النشر المضمّن', 'EmbedDS'], ['conversations', 'Conversations', 'المحادثات', 'Chat']] },
  // `integrations`, `guide` and `docs` have no nav entry (D226): the screens stay reachable
  // by address, but they are not offered as standing destinations.
  // `budgets` has no nav entry: the screen stays reachable from the dashboard cost card
  // and from an Inbox budget crossing, but it is not offered as a standing destination.
  // D383: Runs lists every agent's runs, filtered by agent and period.
  { h: ['Govern', 'الحوكمة'], items: [['runs', 'Runs', 'العمليات', 'TickCircleL'], ['audit', 'Audit', 'التدقيق', 'Eye'], ['logs', 'Logs', 'السجلات', 'LogsDS'], ['settings', 'Settings', 'الإعدادات', 'PencilEdit01'], ['system', 'System', 'النظام', 'TouchInteraction02']] },
];

/**
 * `COM-07`: the navigation a person may use. The console layout computes it on the server
 * from their grants and hands the result to `Shell`, which renders what it is given. A
 * group whose items are all hidden disappears with them.
 */
export function navFor(principal: Principal): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(([id]) => {
      const permission = SCREEN_PERMISSION[id];
      return permission === null || can(principal, permission);
    }),
  })).filter((group) => group.items.length > 0);
}
