# Hiwar UI Specification

Version 1.0 · Source: final Hiwar design artifact (canvas prototype) · Companion to "Hiwar: Product Specification"

Hiwar (حوار) is a platform where a business builds AI agents, installs them on its website as a chat widget, watches conversations live, and lets staff take over from the AI at any moment. This document describes every screen of the final UI prototype: purpose, layout, controls, states, interactions and rules, so design, engineering and QA can build and test against it.

---

## 1. Overview

### 1.1 Scope of the prototype

| Area | Canvas page | Status |
|---|---|---|
| Control panel (customer-facing) | 1 · Control panel | Complete, interactive, 9 screens |
| Public website | 0b · Public website | Complete, 2 screens (Home, Pricing) |
| Platform operator portal | 8 · Platform operator | As-is shell, legacy wording remains (see 9) |
| AI capabilities (operator) | 8b · AI capabilities | As-is shell, legacy wording remains (see 9) |
| Brand sheet and prototype map | Foundations | Complete |

### 1.2 Principles

1. **One owner per conversation.** The AI or one person owns a conversation at any moment. The UI never shows two parties replying.
2. **Status is shown quietly.** A coloured dot plus a label, plain text counts, inline actions. No alert banners or pill badges in places where a plain label works. Warning banners are kept only for real limits (plan usage at 80%).
3. **Staff stay in control.** Take over, claim, hand back and release are always one click away in the inbox.
4. **Transparent AI.** The widget labels the AI, and staff can see what the AI used (sources and tool calls) for each answer.
5. **Bilingual.** The visitor widget supports English and Arabic with RTL. The control panel is English in this version.

---

## 2. Brand and visual identity

### 2.1 Name and logo
- Product name: **Hiwar**, Arabic wordmark **حوار**, shown together in the sidebar brand.
- Logo: speech-bubble based mark (two overlapping conversation bubbles, one answered by the other). Three options (A, B, C) are on the Brand sheet. The sidebar uses the selected mark as inline SVG.

### 2.2 Colour
Deep indigo with a teal accent.

| Role | Value | Use |
|---|---|---|
| Brand deep | #12143a | Sidebar background, headings on dark |
| Brand | #2a2f6b | Primary buttons, active nav, links |
| Accent | #0d9488 | Highlights, AI activity, secondary actions |
| Accent light | #14b8a6 | Charts, focus rings, live indicators |
| Success | green family | Person active, ready, verified |
| Warning | amber family | Waiting for a person, nearing limits |
| Danger | red family (5.6:1 text contrast) | Failed, over limit, destructive actions |
| Muted | grey family | Closed, disabled, secondary text |

All colours are tokens in the shared stylesheet. Danger text meets WCAG AA contrast at 5.6:1.

### 2.3 Typography
Sans-serif UI face for the Latin script, an Arabic-capable face for حوار and the Arabic widget. Monospace for keys, version tags (`v7`), snippets and ownership versions. See the Brand sheet for sizes.

### 2.4 Rules of use
- Do not recolour the logo outside the brand palette.
- Keep clear space equal to the bubble height around the mark.
- Use the Arabic wordmark beside the Latin one on the sidebar and public header.

---

## 3. Personas and sample data

| Persona | Role | Where used |
|---|---|---|
| Noura Al Suwaidi | Owner of Gulf Bites Restaurants | Signed-in user shown in the sidebar |
| Khalid | Support Agent | Owns the human conversation in the inbox |
| Omar Hassan | Visitor | Conversation c1, AI active |
| Fatima Al Ketbi | Visitor (Arabic) | Conversation c2, waiting for a person |
| Rashid Al Mazrouei | Visitor | Conversation c3, owned by Khalid |
| Builder, Analyst, Billing | Team members | Team and permission screens |

Sample organization: **Gulf Bites Restaurants**, **Growth plan**. Agents: **Layla** (v7, live), **Salim** (v3, live), **Rana** (draft). Deployments: **Order site · Dubai** (live), **Catering page** (live, pinned to v3), **Arabic landing page** (draft).

---

## 4. Information architecture and navigation

### 4.1 Control panel sitemap

```
Hiwar control panel
├── Build
│   ├── Agents            (C-Agents)
│   ├── Knowledge         (C-Knowledge)
│   └── Deployments       (C-Deployments)  → Widget preview (C-Widget)
├── Operate
│   ├── Conversations     (C-Inbox)   [count 3]
│   └── Analytics         (C-Analytics)
├── Organization
│   ├── Plan and usage    (C-Billing)
│   ├── Team and roles    (C-Team)
│   └── Audit log         (C-Audit)
└── Help and support      → Pricing (public)
```

### 4.2 Shell (shared on every control panel screen)

**Sidebar (PanelNav, 248 px wide)**
- Brand: logo, "Hiwar", "حوار".
- Organization chip: "Gulf Bites Restaurants · Growth plan".
- Groups: Build, Operate, Organization, Help and support. Active item highlighted via the `active` prop. Conversations shows a plain count (3).
- User chip: "Noura Al Suwaidi · Owner". Sign out returns to the public Home.
- On narrow screens the sidebar opens through a `hiwar-nav` event (mobile menu button).

**Top bar (PanelTop, 60 px high)**
- Breadcrumb: "Gulf Bites › {screen}".
- Search field.
- Language control EN / عربي. Choosing Arabic shows a toast: the Arabic control panel is planned; Arabic and RTL are shown in the widget.
- Notification bell with a count (2).

**Layout grid:** `.app` (sidebar + main), `.content` scroll area, `.card` surfaces, `.split`, `.split3` (three-column inbox), `.rail`, `.center`, `.narrow`, `.wide` helpers. Control panel boards are 1440 px wide and fluid.

### 4.3 Public website
Home → Pricing → Sign in or Start free → Conversations (C-Inbox). Sign out from the panel → Home.

---

## 5. Design system

### 5.1 Components

| Component | Description |
|---|---|
| Button | Primary (indigo), secondary, ghost, danger, small. Disabled state at 45% opacity |
| Status dot `.stt` | 8 px dot + label. Variants: `ai` (teal), `warn` (amber), `ok` (green), `mut` (grey), `bad` (red) |
| Plain note `.note-p` | Muted paragraph with an optional inline action link. Replaces alert banners |
| Badge | Small text tag, used only for Read / Write on tools, Planned on pricing items, and plan names |
| Tabs `.tabs/.tab` | Underlined tabs with optional plain count |
| Segmented control `.seg` | 2–3 exclusive options (EN/عربي, Monthly/Yearly, 7/30/90 days) |
| Switch `.switch` | On/off settings |
| Table `.table-wrap/.table` | Sticky header, row hover, inline row actions |
| Progress `.progress` | Usage meters, with warning (≥ 80%) and danger (≥ 100%) colours |
| Avatar `.avatar` | Initials circle |
| Dialog `.overlay/.dialog` | Modal for forms and confirmations (add source, invite, hand back) |
| Toast `.toast` | Transient confirmation at the bottom, 3 seconds |
| Prototype bar `.proto` | Dashed bar with buttons that simulate events. Not part of the product UI |

### 5.2 Status vocabulary

| Conversation state | Dot | Label |
|---|---|---|
| AI_ACTIVE | teal | With the AI |
| HANDOVER_PENDING | amber | Waiting for a person |
| HUMAN_ACTIVE | green | With {name} |
| COPILOT (P2) | teal outline | AI suggesting |
| CLOSED | grey | Closed |

Source status: Ready, Processing, Queued, Failed (with reason), Disabled. Agent status: Live, Draft. Deployment status: Live, Paused, Draft.

### 5.3 Rules for notices
- Prefer inline text with a status dot over a coloured box.
- A banner is allowed only for plan limits and blocking errors.
- Counts in tabs are plain numbers, never pills.
- Native selects, not pill filters, for list filters.

### 5.4 Accessibility
- Colour is never the only signal: every dot has a text label.
- Focus ring in accent light on all interactive elements.
- Minimum body contrast AA. Touch targets at least 36 px.
- The widget sets `dir="rtl"` in Arabic and mirrors layout and bubbles.

---

## 6. Control panel screens

### 6.1 Conversations (C-Inbox) — live inbox, takeover and handback

**Purpose.** Let staff watch every conversation live, take over from the AI, reply, hand back and close. This is the signature screen.

**Layout (three columns).**
1. **List rail** — tabs All / Needs a person / With the AI / With the team (plain counts). Two native selects (deployment, status). Each item: visitor name, last message snippet, time, `.stt` dot + label, site name as muted text.
2. **Thread** — header with visitor name, `.stt` dot + label, and mono `v{n}` (ownership version). When pending: "Waiting {time}" text and a **Claim** button. When another person owns it: "{name} is replying". Messages with sender label (Visitor, AI, person name, internal note). AI typing indicator. Composer.
3. **Details panel** — visitor info (name, language, page, deployment, started), ownership history, "What the AI used" (sources and tool calls per answer).

**Composer.** Two modes: **Reply** (goes to the visitor) and **Internal note** (staff only, visually distinct, never delivered). Disabled unless the viewer owns the conversation. If the AI owns it, the composer shows "Take over to reply".

**Actions and rules.**

| Action | Available when | Effect |
|---|---|---|
| Take over | AI_ACTIVE | Cancels any AI generation in progress and discards the unsent AI draft. Owner becomes the user. State → HUMAN_ACTIVE. `ownership_version` + 1 |
| Claim | HANDOVER_PENDING | First valid claim wins. Owner becomes the claimer. State → HUMAN_ACTIVE. Version + 1. A second claimer sees "{name} already claimed this" |
| Hand back to the AI | HUMAN_ACTIVE, owner only | Dialog with a staff-only note field. Blank means the system writes a summary. AI continues. State → AI_ACTIVE. Version + 1 |
| Release to queue | HUMAN_ACTIVE, owner only | State → HANDOVER_PENDING, no owner |
| Close conversation | Any open state | State → CLOSED. Composer disabled |

**Single-writer guarantees.**
- Only the owner can produce visitor-visible messages.
- A visitor message while the AI owns the conversation → AI replies.
- While a person owns it → delivered only to that person, no AI reply.
- While HANDOVER_PENDING → queued, shown to whoever claims it, no AI reply.
- The prototype shows double replies = 0.

**Seed conversations.**
- c1 Omar Hassan: AI_ACTIVE, AI typing, v1.
- c2 Fatima Al Ketbi: HANDOVER_PENDING, reason "visitor request", Arabic, v2, waited 1 min 40 s.
- c3 Rashid Al Mazrouei: HUMAN_ACTIVE, owner Khalid, v3.

**Prototype bar buttons.** "Visitor sends a message", "A colleague claims first" (simulates the race on c2), "Reset".

**Empty state.** "No conversations match these filters." with a clear-filters link.

### 6.2 Agents (C-Agents)

**Purpose.** Create, configure, test, publish and roll back AI agents.

**Layout.** Left: agent list (Layla v7 Live, Salim v3 Live, Rana Draft) with New agent. Center: editor with tabs. Right: test console.

**Editor tabs.**

| Tab | Fields |
|---|---|
| Persona | Name, model, reply language (Auto / English / Arabic), tone, instructions (multiline), creativity slider, reply length, operating hours |
| Knowledge | Toggle per source (from Knowledge screen) |
| Tools | 5 tools with Read or Write badge. Write tools have a confirmation policy select (Ask the visitor first / Run automatically / Require staff approval). Add HTTP tool |
| Guardrails | Allowed topics, blocked topics, refusal message, 4 toggles |
| Escalation | 4 toggles (visitor asks, low confidence, sensitive topic, repeated failure), low-confidence count, behaviour when no person is available (Keep with the AI / Collect contact details / Show offline message) |
| Versions | Draft, Live, earlier versions with Roll back |

**Actions.** Publish v{next} (creates a new live version), Duplicate, New agent, Roll back (makes an earlier version the new live version, with confirmation).

**Test console (right).** Chat with the draft. Canned answers in English and Arabic (language detected by Arabic Unicode range). Each AI turn shows sources used, tool calls, and token cost. Suggestion chips in both languages. "Reset conversation".

### 6.3 Knowledge (C-Knowledge)

**Purpose.** Manage what agents know and find gaps.

**Stats row.** Sources ready, chunks, storage (0.4 of 5 GB), unanswered questions.

**Tabs.**
1. **Sources** — table: name, type (File, Website, FAQ), status (Ready, Processing, Queued, Failed with reason, Disabled), chunks, updated. Row actions: Re-crawl (websites), Retry (failed), Replace (files), Disable/Enable, Delete (confirmation).
2. **Unanswered questions** — list of visitor questions the AI could not answer, with count and last asked. Actions: **Write an answer** (inline editor, saves as an FAQ source), **Add as FAQ**, **Dismiss**.

**Add source dialog.** Three modes: Files (drag and drop, type and size hints), Website (URL, crawl depth, allowed domains), FAQ entry (question, answer). Submitting creates a row that moves Queued → Processing → Ready in the prototype.

**Ingest states.** Queued → Processing → Ready, or Failed (reason such as "Page requires sign-in") with Retry.

### 6.4 Deployments (C-Deployments)

**Purpose.** Install an agent on a website and control where and how it runs.

**Layout.** Left: deployment list with status and agent. Right: tabs.

**Tabs.**
- **Install** — snippet with public key (`pk_dep_…`), Copy, Send to developer (mail dialog), Verify domain, Rotate key (old key keeps working for a 7-day grace period).
- **Allowed origins** — list of domains with verified state, add and remove. The widget only loads on listed origins.
- **Appearance** — brand colour, welcome message, position (bottom right / bottom left), toggles: show AI label, suggested questions, right-to-left. Live preview at right.
- **Behavior and quotas** — version pinning (Latest live / Pin to version), language override, tool subset (which of the agent's tools this site may use), messages per month (20,000), concurrent conversations (200), behaviour at limit (Show offline message / Stop AI / Allow overage), pre-chat form toggle.

**Header actions.** Pause (widget shows offline message) and Make live. Draft deployments cannot go live until an origin is verified.

### 6.5 Widget preview (C-Widget)

**Purpose.** Show the visitor experience on a mock Gulf Bites site.

- Chat bubble opens a panel with header (agent name, "AI assistant" label), message list, suggested questions, input, and **Talk to a person**.
- **EN / Arabic RTL toggle.** Arabic mirrors layout, aligns text right, uses Arabic copy.
- **States** (switcher above the preview): AI replying, Waiting for a person (with a short "A person will join shortly" line and a Cancel link), Person connected (name and avatar), Handed back (note that the assistant is back), Offline (leave a message or contact details).
- The AI label is visible whenever the AI is replying. When a person is connected, the header shows the person's name instead.

### 6.6 Analytics (C-Analytics)

**Controls.** Range segmented control (7 / 30 / 90 days), Export CSV (toast confirms).

**KPIs (6).** Conversations, Resolved by the AI (67%), Reached a person (27%), First reply (1.4 s), Wait for a person (1 min 12 s), Double replies (0).

**Panels.**
- Conversations per day: bar chart, AI portion and person portion.
- Breakdown table with a segmented choice: by deployment, by agent, by language. Columns: conversations, resolved by AI, reached a person, cost per conversation.
- Reasons for reaching a person: horizontal bars (visitor request, low confidence, sensitive topic, tool failure, other).
- Top questions list with counts.
- Plain note defining "resolved by the AI": the conversation ended without reaching a person and was not reopened within 24 hours.

### 6.7 Plan and usage (C-Billing)

**Controls.** Monthly / Yearly segmented control.

**Sections.**
1. **Usage meters** — messages, agents, deployments, seats, knowledge storage. Each shows used / limit and a progress bar. At 80% or above: warning colour. At 100%: danger colour. An 80%-usage banner remains for the nearing-limit state, with an Upgrade action.
2. **Limits and alerts** — behaviour at limit (select) and alert thresholds (80% and 100% checkboxes).
3. **Invoices** — table: number, period, amount, status, Download.
4. **Plans** — Starter, Growth (current), Business, Enterprise (custom, Contact sales). Prices are placeholders "AED [price]". Change plan opens a confirm dialog with effective date.
5. **Payment method** — card note with Update.

### 6.8 Team and roles (C-Team)

**Members table.** Name, email, role (select), 2-step sign-in status, last active. The Owner's role is locked. Remove member with confirmation. **Invite member** dialog: email, role, optional message.

**Permission matrix** (spec 4.1.1):

| Capability | Owner | Admin | Builder | Support Agent | Analyst | Billing |
|---|---|---|---|---|---|---|
| Manage agents and knowledge | Yes | Yes | Yes | No | No | No |
| Manage deployments | Yes | Yes | Yes | No | No | No |
| View and reply to conversations | Yes | Yes | No | Yes | No | No |
| Take over and hand back | Yes | Yes | No | Yes | No | No |
| View analytics | Yes | Yes | Yes | Limited | Yes | No |
| Manage plan and invoices | Yes | No | No | No | No | Yes |
| Manage team and roles | Yes | Yes | No | No | No | No |
| View audit log | Yes | Yes | No | No | No | No |

**Security.** Require 2-step sign-in (switch). Session length (14 days default). A plain note describes how role changes apply immediately.

### 6.9 Audit log (C-Audit)

Filter by area (All, Agents, Tools, Deployments, Users, Exports), search, Export. Table columns: time, person, area, action, target. Eight sample entries such as "Noura published Layla v7", "Khalid took over conversation", "Key rotated for Order site". Entries are read-only and cannot be deleted.

---

## 7. Public website

### 7.1 Home (W-Home)
Sections in order:
1. Hero: headline, subhead, Start free and Sign in, Arabic tagline.
2. Embed snippet: shows the one-line install.
3. Five steps: create an agent, add knowledge, deploy, watch, take over.
4. Takeover section with a state strip (With the AI → Waiting for a person → With a person → Handed back).
5. Six feature cards.
6. "Safe by design" band: guardrails, confirmation on risky tools, audit log, single owner per conversation.
7. Footer.

### 7.2 Pricing (W-Pricing)
- One product, four plans: Starter, Growth, Business, Enterprise. No audience tabs.
- Prices shown as "AED [YOUR PRICE]" placeholders. Monthly / Yearly switch.
- Items from release P2 carry a "Planned" badge: copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label.
- Comparison table and FAQ.
- Start free goes to the control panel.

---

## 8. Prototype behaviour and state

| Screen | State kept in the prototype |
|---|---|
| C-Inbox | Conversation list, active conversation, ownership and version, composer mode, simulated visitor messages |
| C-Agents | Selected agent, draft edits, versions, test conversation |
| C-Knowledge | Sources, processing timers, unanswered list |
| C-Deployments | Deployments, origins, appearance, quotas |
| C-Widget | Language, widget state, messages |
| C-Analytics | Range, breakdown selection |
| C-Billing | Interval, selected plan |
| C-Team | Members, roles, invite |
| C-Audit | Filter, search |

All state resets on reload. The dashed prototype bar and canned responses are prototype-only and are not product UI.

---

## 9. Operator portal and AI capabilities (as-is)

These two pages are the platform owner's internal tools. They were recoloured and renamed to Hiwar but their content still follows the earlier product and needs a content pass before build.

**Operator portal (page 8):** O-Tenants, O-Plans, O-CMS, O-Support, O-Business, O-Billing, O-Finance, O-Me.
**AI capabilities (page 8b):** O-Agents, O-Skills, O-Connectors, O-Memory, O-Knowledge, O-Models, O-AI, O-Convos, O-Runs.

Mapping to Hiwar concepts:

| Screen | Hiwar meaning |
|---|---|
| O-Tenants | Organizations (tenants) list and detail |
| O-Plans | Plan definitions and limits |
| O-CMS | Public site content, banners, coupons |
| O-Support | Support queues for customer organizations |
| O-Business | Model cost, service health, tenant isolation checks |
| O-Billing, O-Finance | Renewals, invoices, payments, ledger |
| O-Agents, O-Skills, O-Connectors | Platform-level agent templates and tools |
| O-Memory, O-Knowledge | Retrieval and knowledge infrastructure |
| O-Models, O-AI | Model routes, failovers, releases, evaluation sets |
| O-Convos, O-Runs | Cross-tenant conversation and run inspection (restricted, audited) |

---

## 10. Localisation and accessibility

- Visitor widget: English and Arabic, full RTL mirroring, Arabic copy for suggested questions, welcome message and states.
- Control panel: English only. The عربي toggle shows a "planned" toast.
- Dates and numbers use the organization's locale setting (not designed yet).
- All status uses text plus a dot. Keyboard order follows visual order. Dialogs trap focus and close with Escape.

---

## 11. Release scope (from the product specification)

| Release | UI included |
|---|---|
| P1 | Inbox with takeover, claim, hand back, release, close. Agents, Knowledge, Deployments, Widget, Analytics, Plan and usage, Team and roles, Audit log, Home, Pricing |
| P2 | Copilot mode, webhooks and API, SSO, scheduled reports, regional hosting, white label. Shown as "Planned" on Pricing only |
| P3 | Not shown in the UI |

---

## 12. Known gaps and open decisions

1. Prices and trial terms are placeholders ("AED [price]").
2. Arabic control panel is not designed.
3. Operator and AI capabilities screens still carry learning-product wording (courses, learners, credits) and need rewriting.
4. Foundation components Sidebar, Topbar, Profile, Payments, OrgProfile, TablePager, TableSearch come from the earlier shell. Sidebar's operator menu is still in use there.
5. Logo: one of options A, B, C must be chosen and exported as final assets.
6. Copilot mode (P2) has a defined status label but no screen.
7. Mobile layout of the control panel is limited to the collapsible sidebar. Inbox on phones needs a single-column design.
8. Exact copy for error states (network loss, expired session) is not specified.
