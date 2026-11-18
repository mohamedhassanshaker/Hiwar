"use client";

import { useState, useTransition } from "react";

import { useMay } from "@/components/shared/directory";
import { setConnectorEnabled } from "@/features/connectors/actions";
import { PLATFORM_CONNECTOR_CODE, TIERS, type Connector } from "@/features/connectors/types";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { ConnectorDrawer } from "./connector-drawer";
import { authLabel } from "./credential-fields";

/** S-54 Connectors: the MCP servers agents reach systems through. */

export function Connectors({
  connectors,
  oauthCallbackUrl,
  opened,
}: {
  connectors: Connector[];
  /** Where an authorization server sends an administrator back after Connect (D296). */
  oauthCallbackUrl: string;
  /** The connector the address names, and what its Connect came back with. */
  opened?: { code: string; connected?: { ok: boolean; reason?: string } };
}) {
  const { t } = useAwp();
  const may = useMay();
  // `UC-54.2-08`: without connectors:write the page lists and opens, and changes nothing.
  const readOnly = !may("connectors:write");
  const [open, setOpen] = useState<{ c: Connector; isNew?: boolean; connected?: { ok: boolean; reason?: string } } | null>(() => {
    const found = opened && connectors.find((connector) => connector.n === opened.code);
    return found ? { c: found, connected: opened.connected } : null;
  });
  // The drawer is given the row as the page holds it now, so it saves at the current version.
  const live = open && !open.isNew ? (connectors.find((connector) => connector.n === open.c.n) ?? open.c) : open?.c;
  const [, start] = useTransition();

  const tiersSum = (c: Connector) =>
    TIERS.map(([tier]) => [tier, c.tools.filter((tool) => tool.tier === tier).length] as [string, number]).filter(
      (x) => x[1],
    );

  /** `UC-54.1-04`: Connector opens the drawer empty. */
  const addNew = () =>
    setOpen({
      isNew: true,
      c: {
        n: "",
        name: "",
        nameAr: "",
        d: "",
        dAr: "",
        kind: "Remote MCP",
        transport: "StreamableHttp",
        url: "https://",
        command: "",
        auth: "None",
        credential: { type: "None" },
        st: "Disabled",
        on: false,
        def: "T1",
        tools: [],
        catalogueId: null,
        version: 1,
        builtin: false,
      },
    });

  const toggle = (c: Connector, enabled: boolean) =>
    start(async () => {
      orThrow(await setConnectorEnabled({ code: c.n, enabled, version: c.version }));
    });

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
        title={t("Connectors", "التكامل")}
        sub={t(
          "MCP servers and REST APIs that give agents controlled access to systems. Each connector sets the tier of every tool it exposes.",
          "خوادم MCP وواجهات REST تمنح الوكلاء وصولاً مضبوطاً إلى الأنظمة. يحدد كل موصل مستوى كل أداة يتيحها.",
        )}
      >
        {/* D296: one way in; the drawer asks whether it is an MCP server or a REST API. */}
        {!readOnly && (
          <Btn
            label={t("Connector", "موصل")}
            icon="AddCircle"
            onClick={addNew}
          />
        )}
      </PageHead>
      <Card pad={false}>
        <DataTable
          onRow={(c) => setOpen({ c })}
          rows={connectors}
          cols={[
            {
              h: "",
              // D228: the Platform connector is always on.
              r: (c) => (
                <Toggle
                  on={c.on}
                  onChange={readOnly || c.n === PLATFORM_CONNECTOR_CODE ? () => undefined : (v) => toggle(c, v)}
                />
              ),
            },
            {
              h: t("Connector", "الموصل"),
              r: (c) => (
                <div>
                  <button
                    className="awp-lnk-t"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen({ c });
                    }}
                  >
                    {t(c.name, c.nameAr)}
                  </button>
                  <div className="awp-small awp-muted awp-mono">{c.n}</div>
                  <div className="awp-small awp-muted">{t(c.d, c.dAr)}</div>
                </div>
              ),
            },
            { h: t("Transport", "النقل"), r: (c) => c.kind },
            { h: t("Auth", "المصادقة"), r: (c) => t(...authLabel(c.auth)) },
            {
              h: t("Tool tiers", "مستويات الأدوات"),
              r: (c) => (
                <div className="awp-row" style={{ gap: 4, flexWrap: "wrap" }}>
                  {tiersSum(c).map(([tier, n]) => (
                    <Tg key={tier} tone={TIERS.find((y) => y[0] === tier)?.[3]} label={tier + " × " + n} />
                  ))}
                </div>
              ),
            },
            {
              h: t("Status", "الحالة"),
              r: (c) => <StTag s={c.on ? (c.st === "Connected" ? "Healthy" : "Degraded") : "Disabled"} />,
            },
          ]}
        />
      </Card>
      {open && live && (
        <ConnectorDrawer
          c={live}
          isNew={open.isNew}
          readOnly={readOnly}
          oauthCallbackUrl={oauthCallbackUrl}
          connected={open.connected}
          onClose={() => setOpen(null)}
          onDone={() => setOpen(null)}
        />
      )}
    </div>
  );
}
