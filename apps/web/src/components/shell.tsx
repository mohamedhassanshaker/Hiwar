"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { switchOrganizationAction } from "@/app/profile-actions";
import { Brand } from "./brand";
import { Dialog } from "./dialog";
import { toast } from "./toast";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** PanelNav (PLT-003 FR-001 to FR-008, FR-016). */
export function Sidebar(props: {
  groups: NavGroup[];
  orgName: string;
  planLabel: string;
  userName: string;
  roleLabel: string;
  waiting: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener = (e: Event) => setOpen((e as CustomEvent).detail !== false);
    window.addEventListener("hiwar-nav", listener);
    return () => window.removeEventListener("hiwar-nav", listener);
  }, []);

  return (
    <>
      {open && <button className="nav-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <nav aria-label="Main navigation" className={open ? "side-nav open" : "side-nav"}>
        <button className="btn ghost sm nav-close" aria-label="Close menu" onClick={() => setOpen(false)}>
          <i className="i i-x" />
        </button>
        <Brand href="/conversations" light />
        <div className="org-chip">
          <span className="avatar sm">{props.orgName.slice(0, 2).toUpperCase()}</span>
          <div className="col gap-0" style={{ minWidth: 0 }}>
            <span className="b trunc">{props.orgName}</span>
            <span className="xs nav-sub">{props.planLabel}</span>
          </div>
        </div>
        {props.groups.map((group) => (
          <div key={group.label} className="col gap-2">
            <div className="nav-group">{group.label}</div>
            {group.items.map((item) => {
              const active = path === item.href || path.startsWith(item.href + "/");
              const count = item.href === "/conversations" ? props.waiting : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "nav-item on" : "nav-item"}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <i className={`i ${item.icon}`} aria-hidden="true" />
                  <span className="grow">{item.label}</span>
                  {count > 0 && <span className="nav-count">{count}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        <div style={{ flex: 1, minHeight: 12 }} />
        <button className="nav-item" onClick={() => window.dispatchEvent(new CustomEvent("hiwar-help"))}>
          <i className="i i-help" aria-hidden="true" />
          Help and support
        </button>
        <div className="user-chip">
          <Link href="/profile" className="row nw gap-8 grow" style={{ minWidth: 0, color: "inherit", textDecoration: "none" }} aria-label={`My profile: ${props.userName}`}>
            <span className="avatar sm">{initialsOf(props.userName)}</span>
            <span className="col gap-0 grow" style={{ minWidth: 0 }}>
              <span className="b trunc">{props.userName}</span>
              <span className="xs nav-sub">{props.roleLabel}</span>
            </span>
          </Link>
          <form action="/api/auth/sign-out" method="post">
            <button className="btn ghost sm nav-icon" aria-label="Sign out">
              <i className="i i-logout" />
            </button>
          </form>
        </div>
      </nav>
    </>
  );
}

const CRUMBS: Record<string, string> = {
  conversations: "Conversations",
  agents: "Agents",
  knowledge: "Knowledge",
  deployments: "Deployments",
  analytics: "Analytics",
  billing: "Plan and usage",
  team: "Team and roles",
  audit: "Audit log",
  search: "Search",
  profile: "My profile",
};

export interface Notice {
  id: string;
  title: string;
  link: string;
  read: boolean;
  done: boolean;
  createdAt: string;
}

function noticeTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/** PanelTop (PLT-003 FR-009 to FR-015) and the bell of PLT-008. */
export function TopBar({
  orgShort,
  unread,
  notices,
  userName,
  email,
  orgs,
  owner,
}: {
  orgShort: string;
  unread: number;
  notices: Notice[];
  userName: string;
  email: string;
  orgs: { id: string; name: string; role: string; current: boolean; suspended: boolean }[];
  owner: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [bell, setBell] = useState(false);
  const [menu, setMenu] = useState<"org" | "account" | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const open = () => setHelp(true);
    window.addEventListener("hiwar-help", open);
    return () => window.removeEventListener("hiwar-help", open);
  }, []);
  const switchTo = async (id: string) => {
    setMenu(null);
    const r = await switchOrganizationAction(id);
    if (!r.ok) return toast(r.error);
    router.push("/conversations");
    router.refresh();
  };
  const crumb = CRUMBS[path.split("/")[1] ?? ""] ?? "";

  const markAll = async () => {
    await fetch("/api/notifications/read", { method: "POST" });
    router.refresh();
  };
  const arabic = () =>
    toast("The Arabic control panel is planned for the full design. Arabic and right-to-left are shown in the widget preview.");

  return (
    <header className="top-bar">
      <button
        className="btn ghost sm menu-btn"
        aria-label="Open menu"
        onClick={() => window.dispatchEvent(new CustomEvent("hiwar-nav"))}
      >
        <i className="i i-menu" />
      </button>
      <nav aria-label="Breadcrumb" className="row gap-6 sm">
        <span className="muted">{orgShort}</span>
        <span aria-hidden="true" className="muted">
          ›
        </span>
        <b aria-current="page">{crumb}</b>
      </nav>
      <div style={{ flex: 1 }} />
      <form action="/search" className="top-search">
        <label className="sr-only" htmlFor="top-q">
          Search
        </label>
        <input
          id="top-q"
          name="q"
          type="search"
          className="input"
          aria-label="Search conversations, agents, sources"
          placeholder="Search conversations, agents…"
        />
      </form>
      {orgs.length > 1 && (
        <div className="relative">
          <button className="btn outline sm" aria-haspopup="menu" aria-expanded={menu === "org"} onClick={() => { setMenu(menu === "org" ? null : "org"); setBell(false); }}>
            <span className="avatar sm">{orgShort.slice(0, 2).toUpperCase()}</span>
            <span className="trunc" style={{ maxWidth: 140 }}>{orgShort}</span>
            <i className="i i-chev-d" aria-hidden="true" />
          </button>
          {menu === "org" && (
            <div role="menu" aria-label="Switch organization" className="menu">
              <div className="xs muted p-12">Your organizations</div>
              {orgs.map((o) => (
                <button key={o.id} role="menuitemradio" aria-checked={o.current} disabled={o.suspended} className="mi" onClick={() => !o.current && switchTo(o.id)}>
                  <span className="avatar sm">{o.name.slice(0, 2).toUpperCase()}</span>
                  <span className="col gap-0 grow">
                    <span className="sm">{o.name}</span>
                    <span className="xs muted">{o.suspended ? "Suspended" : o.role}</span>
                  </span>
                  {o.current && <i className="i i-check" aria-hidden="true" />}
                </button>
              ))}
              <p className="xs muted p-12">Agents, knowledge, conversations and billing change with the organization. Data is never shared between organizations.</p>
            </div>
          )}
        </div>
      )}
      <div role="group" aria-label="Interface language" className="seg">
        <button type="button" aria-pressed="true" lang="en" className="on">
          EN
        </button>
        <button type="button" aria-pressed="false" lang="ar" onClick={arabic}>
          عربي
        </button>
      </div>
      <div className="relative">
        <button
          className="btn ghost sm"
          aria-label={`Notifications, ${unread} new`}
          aria-expanded={bell}
          onClick={() => {
            setBell(!bell);
            setMenu(null);
          }}
        >
          <i className="i i-bell" />
          {unread > 0 && <span className="nav-count bell-count">{unread}</span>}
        </button>
        {bell && (
          <div className="menu bell-menu" role="dialog" aria-label="Notifications">
            <div className="row between p-12">
              <b>Notifications</b>
              <button className="btn link sm" onClick={markAll}>
                Mark all as read
              </button>
            </div>
            {notices.length === 0 && <p className="muted sm p-12">Nothing needs you right now.</p>}
            {notices.map((n) => (
              <Link key={n.id} href={n.link} className={n.read || n.done ? "notice" : "notice unread"} onClick={() => setBell(false)}>
                <span className="sm">{n.title}</span>
                <span className="xs muted">{n.done ? "Done" : noticeTime(n.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <button className="btn ghost sm" aria-label="Account" aria-haspopup="menu" aria-expanded={menu === "account"} onClick={() => { setMenu(menu === "account" ? null : "account"); setBell(false); }}>
          <span className="avatar sm">{initialsOf(userName)}</span>
        </button>
        {menu === "account" && (
          <div role="menu" aria-label="Account" className="menu">
            <div className="col gap-0 p-12">
              <span className="b sm">{userName}</span>
              <span className="xs muted">{email}</span>
            </div>
            <Link role="menuitem" className="mi" href="/profile" onClick={() => setMenu(null)}><i className="i i-user" aria-hidden="true" /> My profile</Link>
            {owner && <Link role="menuitem" className="mi" href="/billing" onClick={() => setMenu(null)}><i className="i i-card" aria-hidden="true" /> Plan and usage</Link>}
            <button role="menuitem" className="mi" onClick={() => { setMenu(null); setHelp(true); }}><i className="i i-help" aria-hidden="true" /> Help and support</button>
            <form action="/api/auth/sign-out" method="post">
              <button role="menuitem" className="mi"><i className="i i-logout" aria-hidden="true" /> Sign out</button>
            </form>
          </div>
        )}
      </div>
      <Dialog open={help} title="Help and support" description="Guides, contact and service status" onClose={() => setHelp(false)} footer={<button className="btn" onClick={() => setHelp(false)}>Close</button>}>
        <div className="col gap-8 sm">
          <Link href="/pricing" className="row gap-8" onClick={() => setHelp(false)}><i className="i i-book" aria-hidden="true" /> <span className="col gap-0"><b>Plans and what they include</b><span className="muted">The public Pricing page</span></span></Link>
          <a href="mailto:support@hiwar.app" className="row gap-8"><i className="i i-headset" aria-hidden="true" /> <span className="col gap-0"><b>Contact support</b><span className="muted">Replies by email in working hours</span></span></a>
          <span className="row gap-8"><i className="i i-activity" aria-hidden="true" /> <span className="col gap-0"><b>Service status</b><span className="muted">All systems working</span></span></span>
        </div>
      </Dialog>
    </header>
  );
}
