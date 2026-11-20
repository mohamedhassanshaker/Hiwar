import { can } from "@/server/authz";
import { STATE_LABEL } from "@/server/inbox";
import { deploymentsOf, inboxList, thread, type InboxTab } from "@/server/inbox-queries";
import { requireMember } from "@/server/session";
import { InboxClient, type ThreadView } from "./inbox-client";

export const metadata = { title: "Conversations" };

function time(d: Date): string {
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

function waited(since: Date | null): string {
  if (!since) return "";
  const s = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function label(state: keyof typeof STATE_LABEL, owner: string | null): string {
  return state === "HUMAN_ACTIVE" ? `With ${owner?.split(" ")[0] ?? "a person"}` : STATE_LABEL[state];
}
const TONE = { AI_ACTIVE: "ai", HANDOVER_PENDING: "warn", HUMAN_ACTIVE: "ok", CLOSED: "mut" } as const;

/** C-Inbox (INB-001 to INB-003). */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; dep?: string; period?: string; q?: string; c?: string; denied?: string }>;
}) {
  const member = await requireMember("conversations");
  const sp = await searchParams;
  if (member.support && !member.support.includeConversations) {
    return <p className="note-p">This support access does not include conversation content.</p>;
  }
  const tab = (["all", "pending", "ai", "human"].includes(sp.tab ?? "") ? sp.tab : "all") as InboxTab;
  const period = (["today", "7", "30"].includes(sp.period ?? "") ? sp.period : "7") as "today" | "7" | "30";
  const { tabs, rows } = await inboxList(member.org.id, { tab, deployment: sp.dep || undefined, period, q: sp.q });
  const selectedId = sp.c ?? rows[0]?.c.id;
  const t = selectedId ? await thread(member.org.id, selectedId) : null;

  let view: ThreadView | null = null;
  if (t) {
    const c = t.c;
    const mine = c.state === "HUMAN_ACTIVE" && c.ownerUserId === member.user.id;
    const other = c.state === "HUMAN_ACTIVE" && !mine;
    view = {
      id: c.id,
      version: c.version,
      state: c.state,
      stateLabel: label(c.state, t.ownerName),
      tone: TONE[c.state],
      visitorName: c.visitor.name ?? "Visitor",
      site: t.site,
      language: c.visitor.language === "ar" ? "Arabic" : "English",
      waited: c.state === "HANDOVER_PENDING" ? waited(c.waitingSince) : "",
      reason: t.reason,
      ownerName: t.ownerName,
      mine,
      otherOwns: other,
      canTake: can(member.role, "take_over") && (c.state === "AI_ACTIVE" || (other && can(member.role, "supervisor_takeover"))),
      canClaim: can(member.role, "take_over") && c.state === "HANDOVER_PENDING",
      typing: t.typing && c.state === "AI_ACTIVE",
      agentName: t.agentName,
      messages: t.messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        who:
          m.kind === "visitor" ? (c.visitor.name ?? "Visitor") : m.kind === "ai" ? `${t.agentName} (AI assistant)` : m.kind === "note" ? `Internal note · ${m.authorName ?? ""}` : (m.authorName ?? "Team"),
        text: m.text,
        time: time(m.createdAt) + (m.kind === "note" ? " · only staff see this" : ""),
        cite: m.meta.citations?.map((x) => x.name).join(", ") ?? "",
      })),
      details: [
        ["Name", c.visitor.name ?? "Not given"],
        ["Language", c.visitor.language === "ar" ? "Arabic" : "English"],
        ["Page", c.visitor.page ?? "Unknown"],
        ["Deployment", t.site],
        ["Started", time(c.startedAt)],
        ["Device and country", [c.visitor.device, c.visitor.country].filter(Boolean).join(" · ") || "Unknown"],
        ["Earlier chats", String(c.priorChats)],
        ...(c.visitor.email ? [["Email", c.visitor.email] as [string, string]] : []),
        ...(c.visitor.phone ? [["Phone", c.visitor.phone] as [string, string]] : []),
      ],
      // INB-002 FR-011: the reason includes its note, such as "Released by {name}".
      history: t.history.map((h) => ({ t: h.event, d: `${time(h.createdAt)} · ${h.reasonCode}${h.note ? ` · ${h.note}` : ""} · v${h.version}` })),
      used: [
        ...t.messages.flatMap((m) => (m.meta.citations ?? []).map((x) => ({ t: x.name, d: `Chunk ${x.chunk} · confidence ${x.confidence}` }))),
        ...t.tools.map((tc) => ({
          id: tc.id,
          t: tc.toolKey,
          d: `${tc.access === "write" ? "Write" : "Read"} tool · ${
            tc.status === "waiting_approval" ? "needs human approval · not run" : tc.status === "waiting_visitor" ? "waiting for the visitor" : tc.status
          }${tc.durationMs ? ` · ${tc.durationMs} ms` : ""}${tc.reason ? ` · ${tc.reason}` : ""}`,
          inputs: JSON.stringify(tc.inputs),
          waiting: tc.status === "waiting_approval",
        })),
      ],
    };
  }

  return (
    <InboxClient
      readOnly={Boolean(member.support)}
      tabs={tabs}
      filters={{ tab, dep: sp.dep ?? "", period, q: sp.q ?? "" }}
      deployments={await deploymentsOf(member.org.id)}
      list={rows.map((r) => ({
        id: r.c.id,
        name: r.c.visitor.name ?? "Visitor",
        time: time(r.c.lastMessageAt),
        preview: r.last ?? "",
        site: r.site,
        label: label(r.c.state, r.owner),
        tone: TONE[r.c.state],
      }))}
      selected={view}
      canApprove={can(member.role, "approve_tools")}
    />
  );
}
