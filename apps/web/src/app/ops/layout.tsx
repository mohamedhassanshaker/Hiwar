import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";
import { Toaster } from "@/components/toast";
import { requireOperator } from "@/server/ops";

/** The operator portal shell (OPS-001 to OPS-011) and the AI capabilities module, for Hiwar staff with a platform role. */
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const op = await requireOperator();
  const groups: [string, [string, string, string][]][] = [
    ["Platform", [["/ops", "Organizations", "i-building"], ["/ops/plans", "Plans and prices", "i-layers"], ["/ops/website", "Website", "i-globe"], ["/ops/support", "Support and safety", "i-headset"], ["/ops/business", "Cost and health", "i-activity"]]],
    [
      "AI capabilities",
      [
        ["/ops/ai/agents", "Agents", "i-bot"],
        ["/ops/ai/skills", "Skills", "i-book"],
        ["/ops/ai/connectors", "Connectors", "i-plug"],
        ["/ops/ai/memory", "Memory", "i-database"],
        ["/ops/ai/knowledge", "Knowledge", "i-file"],
        ["/ops/ai/models", "Models and routes", "i-route"],
        ["/ops/ai/channels", "Channels", "i-message"],
        ["/ops/ai/embedded-deployment", "Embedded deployment", "i-code"],
        ["/ops/ai/conversations", "Conversations", "i-inbox"],
        ["/ops/ai/runs", "Runs", "i-zap"],
        ["/ops/ai/approvals", "Approvals", "i-check-circle"],
        ["/ops/ai/budgets", "Budgets", "i-wallet"],
        ["/ops/ai/integrations", "Integrations", "i-link"],
        ["/ops/ai/system", "System", "i-server"],
      ],
    ],
    ["Money", [["/ops/billing", "Subscriptions and billing", "i-receipt"], ["/ops/finance", "Payments and ledger", "i-wallet"]]],
  ];
  return (
    <div className="panel-shell">
      <nav aria-label="Operator navigation" className="side-nav" style={{ overflowY: "auto" }}>
        <Brand href="/ops" light />
        <div className="org-chip">
          <span className="col gap-0">
            <span className="b">Operator portal</span>
            <span className="xs nav-sub">{op.role === "platform_admin" ? "Platform admin" : "Support operator"}</span>
          </span>
        </div>
        {groups.map(([label, items]) => (
          <div key={label} className="col gap-2">
            <div className="nav-group">{label}</div>
            {items.map(([href, item, icon]) => (
              <Link key={href} href={href} className="nav-item">
                <i className={`i ${icon}`} aria-hidden="true" />
                {item}
              </Link>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="user-chip">
          <Link href="/ops/me" className="b grow trunc" style={{ color: "inherit" }} aria-label={`My profile: ${op.name}`}>{op.name}</Link>
          <form action="/api/auth/sign-out" method="post">
            <button className="btn ghost sm nav-icon" aria-label="Sign out">
              <i className="i i-logout" />
            </button>
          </form>
        </div>
      </nav>
      <div className="panel-main">
        <main className="content">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
