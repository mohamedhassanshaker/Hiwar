import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db, schema, type Tx } from "@/db";
import type { Role } from "./authz";
import { publish } from "./live";

/**
 * PLT-008: notifications go to the roles that can act on them (FR-002). A handled item is
 * marked done and stops counting (FR-003).
 */
export const NOTICE_ROLES = {
  waiting: ["owner", "admin", "support_agent"],
  approval: ["owner", "admin", "support_agent"],
  usage: ["owner", "billing"],
  source_failed: ["owner", "admin", "builder"],
  invitation_accepted: ["owner", "admin"],
  operator: ["owner", "billing"],
} satisfies Record<string, Role[]>;

export async function notify(
  orgId: string,
  kind: keyof typeof NOTICE_ROLES,
  title: string,
  link: string,
  subjectId?: string,
  tx?: Tx,
): Promise<void> {
  await (tx ?? db).insert(schema.notifications).values({ orgId, roles: NOTICE_ROLES[kind], kind, title, link, subjectId });
  await publish(`org:${orgId}`, { type: "notification" });
}

/** Marks the notifications about a subject as done (for example a claimed conversation). */
export async function resolveNotices(orgId: string, subjectId: string, tx?: Tx): Promise<void> {
  await (tx ?? db)
    .update(schema.notifications)
    .set({ doneAt: new Date() })
    .where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.subjectId, subjectId), isNull(schema.notifications.doneAt)));
}

const forMember = (orgId: string, userId: string, role: Role) =>
  and(
    eq(schema.notifications.orgId, orgId),
    or(eq(schema.notifications.userId, userId), sql`${role} = ANY(${schema.notifications.roles})`),
  );

export async function listNotices(orgId: string, userId: string, role: Role) {
  const rows = await db
    .select({
      id: schema.notifications.id,
      title: schema.notifications.title,
      link: schema.notifications.link,
      doneAt: schema.notifications.doneAt,
      createdAt: schema.notifications.createdAt,
      readAt: schema.notificationReads.readAt,
    })
    .from(schema.notifications)
    .leftJoin(
      schema.notificationReads,
      and(eq(schema.notificationReads.notificationId, schema.notifications.id), eq(schema.notificationReads.userId, userId)),
    )
    .where(forMember(orgId, userId, role))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(20);
  const notices = rows.map((r) => ({
    id: r.id,
    title: r.title,
    link: r.link,
    read: Boolean(r.readAt),
    done: Boolean(r.doneAt),
    createdAt: r.createdAt.toISOString(),
  }));
  return { notices, unread: notices.filter((n) => !n.read && !n.done).length };
}

/** FR-004: Mark all as read. */
export async function markAllRead(orgId: string, userId: string, role: Role): Promise<void> {
  const ids = await db.select({ id: schema.notifications.id }).from(schema.notifications).where(forMember(orgId, userId, role));
  if (ids.length === 0) return;
  await db
    .insert(schema.notificationReads)
    .values(ids.map(({ id }) => ({ notificationId: id, userId })))
    .onConflictDoNothing();
}
