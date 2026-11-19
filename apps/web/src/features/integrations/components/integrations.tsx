"use client";

import { useState } from "react";

import type { Client, ClientDetail, ClientOption } from "@/features/integrations/types";
import { PageHead } from "@/components/shared/page-head";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { ClientView } from "./client-view";
import { NewClient } from "./new-client";

/** S-76: the clients and what each may do. */
export function Integrations({
  clients,
  details,
  base,
  tools,
  permissions,
}: {
  clients: Client[];
  details: Record<string, ClientDetail>;
  base: string;
  tools: ClientOption[];
  permissions: ClientOption[];
}) {
  const { t, aName } = useAwp();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const client = clients.find((one) => one.id === selected);
  if (client) {
    return (
      <ClientView
        client={client}
        detail={details[client.id]}
        base={base}
        tools={tools}
        permissionOptions={permissions}
        back={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("Govern", "الحوكمة")}
        title={t("Integrations", "التكاملات")}
        sub={t(
          "External clients and what they may do. Each client has its own keys, MCP connection and AG-UI exposure.",
          "العملاء الخارجيون وما يمكنهم فعله. لكل عميل مفاتيحه واتصال MCP وإتاحة AG-UI.",
        )}
      >
        <Btn label={t("New client", "عميل جديد")} icon="AddCircle" onClick={() => setCreating(true)} />
      </PageHead>
      <Card pad={false}>
        <DataTable
          onRow={(row) => setSelected(row.id)}
          rows={clients}
          cols={[
            {
              h: t("Client", "العميل"),
              r: (row) => (
                <div>
                  <b>{t(row.n, row.nAr)}</b>
                  <div className="awp-small awp-muted awp-mono">{row.id}</div>
                </div>
              ),
            },
            { h: t("Owner", "المستخدم"), r: (row) => aName(row.own) },
            {
              h: t("Allowed permissions", "الأذونات المسموحة"),
              r: (row) => (
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {row.perms.map((permission) => (
                    <Tg key={permission} label={permission} />
                  ))}
                </div>
              ),
            },
            {
              h: t("Agents", "الوكلاء"),
              r: (row) =>
                row.agents.length ? (
                  <div className="awp-row" style={{ gap: 0 }}>
                    {row.agents.map((agent, index) => (
                      <span key={agent} style={{ marginInlineStart: index ? -6 : 0, display: "inline-flex" }}>
                        <Who id={agent} s={24} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="awp-muted">—</span>
                ),
            },
            { h: t("Keys", "المفاتيح"), end: true, r: (row) => row.keys },
            { h: "MCP", r: (row) => <Tg tone={row.mcp ? "success" : "neutral"} label={row.mcp ? t("On", "مفعّل") : t("Off", "معطّل")} /> },
            { h: "AG-UI", r: (row) => <Tg tone={row.agui ? "success" : "neutral"} label={row.agui ? t("On", "مفعّل") : t("Off", "معطّل")} /> },
            { h: t("Status", "الحالة"), r: (row) => <StTag s={row.st} /> },
          ]}
        />
      </Card>
      {creating && <NewClient permissionOptions={permissions} onClose={() => setCreating(false)} onCreated={setSelected} />}
    </div>
  );
}
