"use client";

import { Fragment, Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { NavGroup } from "@/components/shared/nav";
import * as D from "@/ds";
import { useModals } from "@/components/shared/modal-host";
import { NAV_OF, screenOfPath, useGo } from "@/lib/routes";
import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { PersonAv } from "@/components/ui/avatar";
import { Seg } from "@/components/ui/tabs";
import { AiOrb } from "@/components/shared/ai-orb";
import { useDirectory } from "@/components/shared/directory";
import { InboxPeek } from "@/components/shared/inbox-peek";
import { BrandLogo } from "@/components/shared/brand-logo";
import { LiveRegion } from "@/components/shared/live-region";
import { PageAssistant } from "@/features/assistant/components/page-assistant";
import { ConversationNotifier } from "@/features/engage/components/conversation-notifier";
import type { CommentThread } from "@/features/comments/types";
import type { InboxSummary } from "@/features/inbox/types";
import { useAwp } from "@/hooks/use-awp";

/** What the signed-in person may start from the top bar (`COM-08`). */
export type ShellCapabilities = { workItems: boolean; requests: boolean; rooms: boolean; settings: boolean };

/** The nav list reads the URL, so it sits in its own Suspense boundary. */
function SidebarNav({ nav, onNavigate, inboxCount }: { nav: NavGroup[]; onNavigate: () => void; inboxCount: number }) {
  const { t } = useAwp();
  const go = useGo();
  const screen = screenOfPath(usePathname());
  const active = screen ? (NAV_OF[screen] !== undefined ? NAV_OF[screen] : screen) : null;
  return (
    <>
      {nav.map((g, gi) => (
        <Fragment key={gi}>
          {g.h && <div className="awp-nav-h">{t(g.h[0], g.h[1])}</div>}
          {g.items.map(([id, en, ar, ic]) => (
            <button
              key={id}
              className={"awp-nav-i" + (active === id ? " on" : "")}
              onClick={() => {
                onNavigate();
                go(id);
              }}
              data-screen-label={en}
            >
              <Ic n={ic} c={active === id ? "var(--icon-brand)" : "var(--icon-secondary)"} />
              <span className="lbl grow">{t(en, ar)}</span>
              {id === "inbox" && inboxCount > 0 && (
                <span className="awp-badge">
                  <D.Badge type="number" text1={String(inboxCount)} />
                </span>
              )}
            </button>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** What Settings → Branding has set, as the shell renders it (`UC-75.2-01`). */
export type Branding = {
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
  brandColour: string | null;
};

/** The three things the "Create new" menu starts, and the permission each needs. */
const CREATE: [key: "workitem" | "room" | "request", en: string, ar: string, icon: string, may: keyof ShellCapabilities][] = [
  ["workitem", "New Work Item", "بند عمل جديد", "File01", "workItems"],
  ["room", "New Discussion Room", "اجتماع عمل جديد", "Chat", "rooms"],
  ["request", "New Request", "طلب جديد", "Invoice01", "requests"],
];

/**
 * The console frame around every screen: the sidebar with the organisation's logo and the
 * permitted navigation, the top bar (Create new, search, language, theme, the Inbox peek and the
 * account menu), the page, and the AI assistant button with its panel. It applies the branding
 * colour to the document root, and a create entry the person may not use is disabled with the
 * reason as its title.
 */
export function Shell({
  children,
  nav,
  branding,
  inbox,
  commentThreads,
  may,
  onSignOut,
}: {
  children: ReactNode;
  /** Already filtered by the console layout from the person's grants (`COM-07`). */
  nav: NavGroup[];
  branding: Branding;
  /** What is waiting for this person, which the badge counts and the peek lists; null without `inbox:read`. */
  inbox: InboxSummary | null;
  /** The card comment threads, for the quick-request half of the same count. */
  commentThreads: CommentThread[];
  may: ShellCapabilities;
  onSignOut: () => Promise<void>;
}) {
  const { t, lang, setLang, theme, setTheme, nm } = useAwp();
  const { me } = useDirectory();

  // `UC-75.2-03`: the chosen colour applies to buttons, links and active navigation.
  //
  // This has to land on `document.documentElement` — the real `:root` — not on an inline
  // style further down the tree. Every semantic token (`--action-primary-bg` and the rest)
  // is declared on `:root` as `var(--color-brand-blue-600)`, and a CSS custom property
  // resolves `var()` once, where it is declared, then inherits that resolved value down.
  // Overriding the primitive on a descendant div is therefore invisible to it: the semantic
  // token already inherited `:root`'s own unmodified primitive before the override exists.
  // The light and dark themes chain through different primitives — light buttons through
  // `-600`, dark ones through `-450`, with `-325` behind the dark theme's icon, text and
  // border tokens — so the override sets all three. The colour passed the WCAG 2.2 AA check
  // before it was stored.
  useEffect(() => {
    const root = document.documentElement.style;
    const names = ["--color-brand-blue-600", "--color-brand-blue-325", "--color-brand-blue-450"];
    if (branding.brandColour) {
      for (const name of names) root.setProperty(name, branding.brandColour);
    } else {
      for (const name of names) root.removeProperty(name);
    }
    return () => {
      for (const name of names) root.removeProperty(name);
    };
  }, [branding.brandColour]);
  const { open } = useModals();
  const go = useGo();
  const [assist, setAssist] = useState(false);
  // D239: once opened, the panel stays mounted and is only hidden, so closing it keeps the
  // conversation and any answer still arriving.
  const [assistUsed, setAssistUsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // `COM-16`: Escape closes an open menu, the same way it closes a modal or a drawer.
  // Each of the three closes on an outside click too; this is the keyboard's way out.
  const anyMenu = menu || newMenu || moreMenu;
  useEffect(() => {
    if (!anyMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      setNewMenu(false);
      setMoreMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyMenu]);
  const navTo = (id: Parameters<typeof go>[0]) => {
    setMenu(false);
    setNavOpen(false);
    go(id);
  };
  const cannot = t(
    "You cannot create in any project. Ask a work lead for access.",
    "لا يمكنك الإنشاء في أي مشروع. اطلب الصلاحية من قائد العمل.",
  );
  const inboxCount =
    Object.values(inbox?.counts.open ?? {}).reduce((sum, n) => sum + n, 0) +
    commentThreads.filter((thread) => thread.unread).length;

  return (
    <div className={"awp-app" + (navOpen ? " nav-open" : "")} key={lang}>
      {/* The badge and the peek are read on the server with the page, so a decision taken
          in another tab reaches them the same way it reaches the Inbox screen itself. */}
      <LiveRegion path="/api/sse/inbox" />
      <ConversationNotifier />
      <div className="awp-scrim" onClick={() => setNavOpen(false)} />
      <aside className="awp-side">
        <div className="awp-brand">
          <BrandLogo logos={branding} theme={theme} lang={lang} alt={t("Organisation logo", "شعار الجهة")} />
        </div>
        <nav className="awp-nav">
          <Suspense>
            <SidebarNav nav={nav} onNavigate={() => setNavOpen(false)} inboxCount={inboxCount} />
          </Suspense>
        </nav>
      </aside>
      <div className="awp-main">
        <header className="awp-top">
          <button className="awp-iconbtn awp-hamb" onClick={() => setNavOpen(true)} aria-label={t("Open menu", "فتح القائمة")}>
            <Ic n="Menu01" />
          </button>
          {/* Handoff v2: one brand-coloured "+" at the start of the bar in place of three
              buttons competing with the search for room. `COM-08` still decides what is in
              it: an item they may not use is disabled and says why. */}
          <div className="awp-top-plus">
            <button
              className="awp-iconbtn"
              onClick={() => setNewMenu(!newMenu)}
              aria-expanded={newMenu}
              aria-haspopup="menu"
              aria-label={t("Create new", "إنشاء جديد")}
              title={t("Create new", "إنشاء جديد")}
            >
              <Ic n="AddCircle" c="var(--icon-brand)" />
            </button>
            {newMenu && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 44 }} onClick={() => setNewMenu(false)} />
                <div className="awp-card awp-menu awp-menu-start" role="menu">
                  <div className="awp-small awp-muted" style={{ padding: "6px 12px 8px", fontWeight: 500 }}>
                    {t("Create new", "إنشاء جديد")}
                  </div>
                  {CREATE.map(([key, en, ar, icon, permission]) => (
                    <button
                      key={key}
                      role="menuitem"
                      className="awp-nav-i"
                      disabled={!may[permission]}
                      title={may[permission] ? undefined : cannot}
                      onClick={() => {
                        setNewMenu(false);
                        open(key);
                      }}
                    >
                      <Ic n={icon} />
                      {t(en, ar)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="awp-search" style={{ cursor: "pointer", textAlign: "start" }} onClick={() => open("search")}>
            <Ic n="Search" s={20} c="var(--icon-tertiary)" />
            <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {t("Search rooms, work items, agents, knowledge", "ابحث في الاجتماعات وبنود العمل والوكلاء والمعرفة")}
            </span>
            <span className="awp-kbd">⌘K</span>
          </button>
          <span style={{ flex: 1 }} />
          {/* The two secondary buttons at full width; below it they fold into "More", so a
              narrow bar never has to choose between the search and them. */}
          <div className="awp-top-acts">
            <span className="awp-top-sec">
              <Btn
                type="secondary"
                label={t("New Discussion Room", "اجتماع عمل جديد")}
                disabled={!may.rooms}
                title={may.rooms ? undefined : cannot}
                onClick={() => open("room")}
              />
              <Btn
                type="secondary"
                label={t("New Request", "طلب جديد")}
                disabled={!may.requests}
                title={may.requests ? undefined : cannot}
                onClick={() => open("request")}
              />
            </span>
            <span className="awp-top-more" style={{ position: "relative" }}>
              <button
                className="awp-iconbtn"
                onClick={() => setMoreMenu(!moreMenu)}
                aria-expanded={moreMenu}
                aria-haspopup="menu"
                aria-label={t("More actions", "إجراءات أخرى")}
                title={t("More actions", "إجراءات أخرى")}
              >
                <Ic n="Menu09" />
              </button>
              {moreMenu && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 44 }} onClick={() => setMoreMenu(false)} />
                  <div className="awp-card awp-menu" role="menu">
                    {CREATE.filter(([key]) => key !== "workitem").map(([key, en, ar, icon, permission]) => (
                      <button
                        key={key}
                        role="menuitem"
                        className="awp-nav-i"
                        disabled={!may[permission]}
                        title={may[permission] ? undefined : cannot}
                        onClick={() => {
                          setMoreMenu(false);
                          open(key);
                        }}
                      >
                        <Ic n={icon} />
                        {t(en, ar)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
          </div>
          <div className="awp-top-utils">
            <span className="awp-hide-xs" style={{ display: "flex" }}>
              <Seg value={lang} onChange={(v) => setLang(v === "ar" ? "ar" : "en")} items={[{ id: "en", label: "EN" }, { id: "ar", label: "ع" }]} />
            </span>
            <button
              className="awp-iconbtn awp-hide-xs"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("Toggle theme", "تبديل السمة")}
              title={t("Toggle theme", "تبديل السمة")}
            >
              <Ic n={theme === "dark" ? "Sun01" : "Moon2"} />
            </button>
            <InboxPeek inbox={inbox} threads={commentThreads} />
          </div>
          <span className="awp-top-sep awp-hide-xs" aria-hidden="true" />
          <div style={{ position: "relative" }}>
            <button
              className="awp-row awp-top-user"
              onClick={() => setMenu(!menu)}
              aria-expanded={menu}
              aria-haspopup="menu"
              aria-label={t("Account menu", "قائمة الحساب")}
            >
              <PersonAv p={me} s={40} />
              <div className="awp-brand-txt awp-user-txt" style={{ lineHeight: 1.25, whiteSpace: "nowrap", textAlign: "start" }}>
                <div style={{ fontWeight: 500 }}>{nm(me)}</div>
                <div className="awp-small awp-muted">{t(me.role, me.roleAr)}</div>
              </div>
              <span className="awp-hide-sm" style={{ display: "flex" }}>
                <Ic n="ChevronDown" s={16} />
              </span>
            </button>
            {menu && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 44 }} onClick={() => setMenu(false)} />
                <div className="awp-card awp-menu" style={{ boxShadow: "0 12px 40px var(--elevation-shadow-md)" }}>
                  <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid var(--border-divider)", marginBottom: 4 }}>
                    <b>{nm(me)}</b>
                    <div className="awp-small awp-muted">{me.email}</div>
                  </div>
                  <button className="awp-nav-i" onClick={() => navTo("profile")}>
                    <Ic n="Profile02" />
                    {t("My profile", "ملفي الشخصي")}
                  </button>
                  {may.settings && (
                    <button className="awp-nav-i" onClick={() => navTo("settings")}>
                      <Ic n="Setting01" />
                      {t("Settings", "الإعدادات")}
                    </button>
                  )}
                  <button
                    className="awp-nav-i awp-show-xs"
                    onClick={() => {
                      setMenu(false);
                      setTheme(theme === "dark" ? "light" : "dark");
                    }}
                  >
                    <Ic n={theme === "dark" ? "Sun01" : "Moon2"} />
                    {theme === "dark" ? t("Light theme", "السمة الفاتحة") : t("Dark theme", "السمة الداكنة")}
                  </button>
                  <button
                    className="awp-nav-i awp-show-xs"
                    onClick={() => {
                      setMenu(false);
                      setLang(lang === "ar" ? "en" : "ar");
                    }}
                  >
                    <Ic n="Chat" />
                    {lang === "ar" ? "English" : "العربية"}
                  </button>
                  <form action={onSignOut}>
                    <button type="submit" className="awp-nav-i" style={{ color: "var(--text-danger)", width: "100%" }}>
                      <Ic n="Login02" c="var(--icon-danger)" />
                      {t("Log out", "تسجيل الخروج")}
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="awp-content">{children}</main>
      </div>
      {/*
        The AI assistant's one entry point: a fixed sphere in the corner of every screen,
        the way an assistant widget is found elsewhere, rather than a small icon lost among
        the top bar's own controls. It stays while the panel is open — with an X over it —
        so closing the panel is in the same place as opening it.
      */}
      <button
        className={"awp-fab" + (assist ? " on" : "")}
        onClick={() => {
          setAssist(!assist);
          setAssistUsed(true);
        }}
        aria-expanded={assist}
        aria-label={t("AI assistant", "المساعد الذكي")}
      >
        <span className="awp-fab-orb" aria-hidden="true">
          <AiOrb active={assist} size={60} />
          {assist && (
            <span className="awp-orb-x">
              <Ic n="X" s={18} c="var(--color-brand-blue-600)" />
            </span>
          )}
        </span>
        <span className="awp-fab-txt">
          <b>{t("AI Assistant", "المساعد الذكي")}</b>
          <span>{assist ? t("Close assistant", "إغلاق المساعد") : t("Ask about this page", "اسأل عن هذه الصفحة")}</span>
        </span>
      </button>
      {assistUsed && <PageAssistant hidden={!assist} onClose={() => setAssist(false)} />}
    </div>
  );
}
