"use client";

import { useState, useTransition } from "react";

import { setProviderActive } from "@/features/models/actions";
import { providerHealth, type ModelRoute, type Provider, type RouteStep } from "@/features/models/types";
import { useMay } from "@/components/shared/directory";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, Tabs } from "@/components/ui/tabs";
import { Tg } from "@/components/ui/tag";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";
import { DataTable, Grid } from "@/components/shared/layout";
import { HealthTag } from "./health-tag";
import { ProvIcon } from "./provider-icon";
import { ProviderDrawer } from "./provider-drawer";
import { CustomProviderModal } from "./custom-provider-modal";
import { CloudProviderModal } from "./cloud-provider-modal";
import { RouteEditor } from "./route-editor";

/** S-59 providers and their connections, S-60 the routes agents call. */

export function Models({ providers, routes }: { providers: Provider[]; routes: ModelRoute[] }) {
  const { t } = useAwp();
  const may = useMay();
  // `UC-59.1-09`: read-only without `models:write`. Secrets are never sent to the client
  // at all, whatever this says.
  const readOnly = !may("models:write");
  const [tab, setTab] = useState("providers");
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [edit, setEdit] = useState<ModelRoute | "new" | null>(null);
  const [kind, setKind] = useState("all");
  const [, start] = useTransition();

  const current = open ? providers.find((x) => x.id === open) : undefined;

  const toggle = (p: Provider, active: boolean) =>
    start(async () => {
      orThrow(await setProviderActive({ providerId: p.id, active }));
    });

  const step = (s: RouteStep) => {
    const provider = providers.find((q) => q.id === s[0]);
    const connection = provider?.conns.find((q) => q.id === s[1]);
    const live = provider?.on && connection?.on;
    return (
      <span className="awp-row" style={{ gap: 6, opacity: live ? 1 : 0.55 }}>
        {provider && <ProvIcon p={provider} s={22} />}
        <button className="awp-lnk-t" onClick={() => provider && setOpen(provider.id)}>
          {provider ? provider.n : "—"}
        </button>
        <span className="awp-muted">›</span>
        <span>{connection ? connection.n : "—"}</span>
        <span className="awp-muted">›</span>
        <span className="awp-mono">{s[2]}</span>
        {!live && <Tg tone="warning" label={t("Inactive", "غير نشط")} />}
      </span>
    );
  };

  const list = providers.filter(
    (p) =>
      kind === "all" ||
      (kind === "active"
        ? p.on
        : kind === "custom"
          ? p.kind === "Custom"
          : kind === "cloud"
            ? p.kind === "Cloud"
            : !p.on),
  );

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
        title={t("Models & routes", "النماذج والمسارات")}
        sub={t(
          "Providers hold one or more connections; each connection allows specific models. Routes chain provider › connection › model.",
          "يملك المزود اتصالاً أو أكثر، ويسمح كل اتصال بنماذج محددة. تربط المسارات المزود › الاتصال › النموذج.",
        )}
      >
        {!readOnly &&
          (tab === "providers" ? (
            <>
              <Btn type="secondary" label={t("Add custom provider", "إضافة مزود مخصص")} icon="AddCircle" onClick={() => setCustom(true)} />
              <Btn label={t("Add cloud provider", "إضافة مزود سحابي")} icon="AddCircle" onClick={() => setCloud(true)} />
            </>
          ) : (
            <Btn label={t("New route", "مسار جديد")} icon="AddCircle" onClick={() => setEdit("new")} />
          ))}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "providers", label: t("Providers", "المزودون"), count: providers.length },
          { id: "routes", label: t("Routes", "المسارات"), count: routes.length },
        ]}
      />
      {tab === "providers" && (
        <>
          <Chips
            value={kind}
            onChange={setKind}
            items={[
              { id: "all", label: t("All", "الكل") },
              { id: "active", label: t("Active", "نشط") },
              { id: "inactive", label: t("Not active", "غير نشط") },
              { id: "custom", label: t("Custom", "مخصص") },
              { id: "cloud", label: t("Cloud", "سحابي") },
            ]}
          />
          <Grid min={260}>
            {list.map((p) => (
              <div
                key={p.id}
                className="awp-card"
                onClick={() => setOpen(p.id)}
                style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, cursor: "pointer", opacity: p.on ? 1 : 0.75 }}
              >
                <div className="awp-row" style={{ gap: 12 }}>
                  <ProvIcon p={p} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{p.n}</b>
                    <div className="awp-small awp-muted">
                      {p.engine ? t("Custom · ", "مخصص · ") + p.engine : t("Cloud provider", "مزود سحابي")}
                    </div>
                  </div>
                  <Toggle on={p.on} onChange={readOnly ? () => undefined : (v) => toggle(p, v)} />
                </div>
                <div
                  className="awp-row awp-small awp-muted"
                  style={{ justifyContent: "space-between", borderTop: "1px solid var(--border-divider)", paddingTop: 10 }}
                >
                  <span>
                    {p.conns.length} {t("connections", "اتصالات")} ·{" "}
                    {p.conns.reduce((n, c) => n + c.allow.length, 0)} {t("models allowed", "نماذج مسموحة")}
                  </span>
                  {p.conns.length ? (
                    <HealthTag h={providerHealth(p)} />
                  ) : (
                    <Tg label={t("Not connected", "غير متصل")} />
                  )}
                </div>
              </div>
            ))}
          </Grid>
        </>
      )}
      {tab === "routes" && (
        <Card pad={false}>
          <DataTable
            rows={routes}
            cols={[
              {
                h: t("Alias", "الاسم المستعار"),
                r: (r) => (
                  <div>
                    <b className="awp-mono">{r.a}</b>
                    <div className="awp-small awp-muted">{t(r.use[0], r.use[1])}</div>
                    {r.schema && (
                      <div className="awp-row" style={{ gap: 6, marginTop: 4 }}>
                        <Tg tone="info" label={t("Typesafe", "مضبوط النوع")} />
                        <span className="awp-small awp-mono">{r.schema}</span>
                      </div>
                    )}
                    {r.voice && (
                      <div className="awp-row" style={{ gap: 6, marginTop: 4 }}>
                        <Tg tone="brand" label={t("Voice", "صوت")} />
                        <span className="awp-small">{r.voice}</span>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                h: t("Chain (provider › connection › model)", "السلسلة (المزود › الاتصال › النموذج)"),
                r: (r) => (
                  <div className="awp-col" style={{ gap: 6 }}>
                    {r.chain.map((s, i) => (
                      <div key={i} className="awp-row" style={{ gap: 8 }}>
                        <span className="awp-small awp-muted" style={{ width: 56 }}>
                          {i ? t("Fallback", "بديل") : t("Primary", "أساسي")}
                        </span>
                        {step(s)}
                      </div>
                    ))}
                  </div>
                ),
              },
              { h: t("Agents", "الوكلاء"), end: true, r: (r) => r.agents },
              {
                h: "",
                end: true,
                r: (r) => (readOnly ? null : <Lnk onClick={() => setEdit(r)}>{t("Edit", "تعديل")}</Lnk>),
              },
            ]}
          />
        </Card>
      )}
      {current && (
        <ProviderDrawer
          p={current}
          readOnly={readOnly}
          onDone={() => setOpen(null)}
          onClose={() => setOpen(null)}
        />
      )}
      {custom && <CustomProviderModal onDone={() => setCustom(false)} onClose={() => setCustom(false)} />}
      {cloud && <CloudProviderModal onDone={() => setCloud(false)} onClose={() => setCloud(false)} />}
      {edit && (
        <RouteEditor
          route={edit === "new" ? null : edit}
          provs={providers}
          onDone={() => {
            setEdit(null);
            setTab("routes");
          }}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
