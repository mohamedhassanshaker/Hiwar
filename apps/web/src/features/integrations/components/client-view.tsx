"use client";

import { useState } from "react";

import { useAgents } from "@/components/shared/directory";
import {
  deleteClient,
  revokeKey,
  rotateKey,
  setAgui,
  setClientStatus,
  setMcp,
  setPermissions,
  testMcpConnection,
} from "@/features/integrations/actions";
import { useModals } from "@/components/shared/modal-host";
import type { Client, ClientDetail, ClientOption } from "@/features/integrations/types";
import { formatDay } from "@/i18n";
import { PageHead } from "@/components/shared/page-head";
import { AgentAv } from "@/components/ui/avatar";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Tabs } from "@/components/ui/tabs";
import { Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { ShowSecret, CreateKey } from "./client-keys";

const AGUI_EVENTS = ["TEXT_MESSAGE_CONTENT", "TOOL_CALL_START", "STATE_SNAPSHOT", "STATE_DELTA", "RUN_FINISHED"];

/**
 * One integration client's page (S-77): activate, deactivate or delete it, and tabs for its keys,
 * MCP exposure with a connection test, AG-UI exposure with its agents, events and origins, and its
 * permissions. Every toggle saves at once; the origins field saves on blur. A rotated or created
 * key's secret is shown once in a dialog.
 */
export function ClientView({
  client,
  detail,
  base,
  tools: exposable,
  permissionOptions,
  back,
}: {
  client: Client;
  detail: ClientDetail | undefined;
  base: string;
  tools: ClientOption[];
  permissionOptions: ClientOption[];
  back: () => void;
}) {
  const { t, lang } = useAwp();
  const { ago } = useAgo();
  const { act: confirmAction } = useModals();
  const agents = useAgents();
  const [tab, setTab] = useState("keys");
  const [status, setStatus] = useState(client.st);
  const [mcpOn, setMcpOn] = useState(detail?.mcp.enabled ?? client.mcp);
  const [aguiOn, setAguiOn] = useState(detail?.agui.enabled ?? client.agui);
  const [tools, setTools] = useState(detail?.mcp.exposedTools ?? []);
  const [authType, setAuthType] = useState(detail?.mcp.authType ?? "ApiKey");
  const [events, setEvents] = useState(detail?.agui.allowedEvents ?? []);
  const [origins, setOrigins] = useState((detail?.agui.allowedOrigins ?? []).join(", "));
  const [permissions, setPermissionList] = useState(client.perms);
  const [agentCodes, setAgentCodes] = useState(client.agents);
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [testResult, setTestResult] = useState(detail?.mcp.lastTestResult ?? null);
  const [testSecret, setTestSecret] = useState("");
  const [creating, setCreating] = useState(false);
  const [attempt, pending] = useAction();
  const keys = detail?.keys ?? [];

  /** Each action reports what it changed, or the refusal the server returned. */
  const run = (body: () => Promise<{ ok: boolean; reason?: string }>, done?: string) =>
    attempt(async () => {
      const outcome = await body();
      if (!outcome.ok) {
        throw new Refused({ reason: outcome.reason ?? t("That did not work.", "لم ينجح ذلك.") });
      }
      return done ?? t("Saved.", "تم الحفظ.");
    });

  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((one) => one !== value) : [...list, value]);

  const confirmDelete = () =>
    confirmAction({
      title: t("Delete client", "حذف العميل"),
      desc: t(
        `Deleting removes every key, permission, and agent and tool exposure ${client.n} has. Unlike Deactivate, this cannot be undone.`,
        `الحذف يزيل كل مفتاح وصلاحية وتعرّض وكيل وأداة لدى ${client.nAr}. خلافاً للتعطيل، لا يمكن التراجع عن هذا.`,
      ),
      danger: true,
      confirm: t("Delete", "حذف"),
      onDone: () =>
        run(async () => {
          const outcome = await deleteClient({ clientCode: client.id });
          if (outcome.ok) back();
          return outcome;
        }, t(`${client.n} was deleted.`, `حُذف ${client.nAr}.`)),
    });

  return (
    <div className="awp-page">
      <PageHead crumb={<Lnk onClick={back}>{t("Govern / Integrations", "الحوكمة / التكاملات")}</Lnk>} title={t(client.n, client.nAr)} sub={<span className="awp-mono">{client.id}</span>}>
        <StTag s={status} />
        <Btn
          type="secondary"
          label={status === "Active" ? t("Deactivate", "تعطيل") : t("Activate", "تفعيل")}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const next = status === "Active" ? "Inactive" : "Active";
              const outcome = await setClientStatus({ clientCode: client.id, status: next });
              if (outcome.ok) setStatus(next);
              return outcome;
            }, status === "Active"
              ? t("All keys stop working until the client is reactivated.", "تتوقف كل المفاتيح حتى إعادة تفعيل العميل.")
              : t("The client is active again.", "العميل مفعّل مجدداً."))
          }
        />
        <Btn type="danger" label={t("Delete client", "حذف العميل")} disabled={pending} onClick={confirmDelete} />
      </PageHead>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "keys", label: t("Keys", "المفاتيح"), count: keys.length },
          { id: "mcp", label: t("MCP connection", "اتصال MCP") },
          { id: "agui", label: t("AG-UI expose", "إتاحة AG-UI") },
          { id: "perms", label: t("Permissions", "الأذونات") },
        ]}
      />

      {tab === "keys" && (
        <Card
          pad={false}
          title={t("API keys", "مفاتيح API")}
          actions={<Btn label={t("Create key", "إنشاء مفتاح")} icon="AddCircle" onClick={() => setCreating(true)} />}
        >
          <DataTable
            rows={keys}
            cols={[
              { h: t("Name", "الاسم"), r: (row) => <b>{row.name}</b> },
              { h: t("Key", "المفتاح"), r: (row) => <span className="awp-mono">{row.prefix}…</span> },
              {
                h: t("Last used", "آخر استخدام"),
                r: (row) => (row.lastUsedAt ? ago(row.lastUsedAt) : t("Never", "لم يُستخدم")),
              },
              { h: t("Expires", "الانتهاء"), r: (row) => (row.expiresAt ? formatDay(lang, new Date(row.expiresAt)) : t("Never", "بلا انتهاء")) },
              {
                h: t("Status", "الحالة"),
                r: (row) => <StTag s={row.status === "Active" ? "Active" : row.status === "Expired" ? "Retired" : "Disabled"} />,
              },
              {
                h: "",
                end: true,
                r: (row) => (
                  <div className="awp-row" style={{ justifyContent: "flex-end", gap: 12 }}>
                    <Lnk
                      onClick={() =>
                        run(async () => {
                          const outcome = await rotateKey({ keyId: row.id, graceHours: 24 });
                          if (outcome.ok) setSecretShown(outcome.value);
                          return outcome;
                        }, t("The old key stops working after 24 hours.", "يتوقف المفتاح القديم بعد 24 ساعة."))
                      }
                    >
                      {t("Rotate", "تدوير")}
                    </Lnk>
                    <Lnk
                      danger
                      onClick={() =>
                        run(
                          () => revokeKey({ keyId: row.id }),
                          t("That key stops working immediately.", "يتوقف هذا المفتاح فوراً."),
                        )
                      }
                    >
                      {t("Revoke", "إلغاء")}
                    </Lnk>
                  </div>
                ),
              },
            ]}
          />
          {!keys.length && <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>{t("No key has been created yet.", "لم يُنشأ مفتاح بعد.")}</p>}
        </Card>
      )}

      {tab === "mcp" && (
        <Card
          title={t("Expose platform as MCP server", "إتاحة المنصة كخادم MCP")}
          actions={
            <Toggle
              on={mcpOn}
              onChange={(next) => {
                setMcpOn(next);
                run(() => setMcp({ clientCode: client.id, enabled: next, authType, exposedTools: tools }));
              }}
            />
          }
        >
          {mcpOn ? (
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Endpoint", "نقطة النهاية")}>
                <input className="awp-input awp-mono" readOnly value={`${base}/api/mcp`} />
              </Field>
              <Field label={t("Auth", "المصادقة")} hint={t("The client sends its key as a bearer token.", "يرسل العميل مفتاحه كرمز حامل.")}>
                <PopSelect
                  className="awp-input"
                  value={authType}
                  onChange={(event) => {
                    setAuthType(event.target.value);
                    run(() => setMcp({ clientCode: client.id, enabled: mcpOn, authType: event.target.value, exposedTools: tools }));
                  }}
                >
                  <option value="ApiKey">API key</option>
                  <option value="OAuth">OAuth 2.1 (client credentials)</option>
                </PopSelect>
              </Field>
              <Field label={t("Exposed tools", "الأدوات المتاحة")}>
                <div className="awp-col" style={{ gap: 8 }}>
                  {exposable.map(({ code: tool }) => (
                    <label key={tool} className="awp-row">
                      <input
                        type="checkbox"
                        checked={tools.includes(tool)}
                        onChange={() => {
                          const next = toggleIn(tools, tool);
                          setTools(next);
                          run(() => setMcp({ clientCode: client.id, enabled: mcpOn, authType, exposedTools: next }));
                        }}
                      />
                      <span className="awp-mono">{tool}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t("Key to test with", "المفتاح المستخدم للاختبار")} hint={t("A secret is shown once, so the test asks for it.", "يظهر السر مرة واحدة، لذا يطلبه الاختبار.")}>
                <input className="awp-input awp-mono" type="password" value={testSecret} onChange={(event) => setTestSecret(event.target.value)} />
              </Field>
              <div>
                <Btn
                  type="secondary"
                  label={t("Run test", "تشغيل الاختبار")}
                  disabled={pending || testSecret.trim() === ""}
                  onClick={() =>
                    attempt(async () => {
                      // The result is what the test is for, so it is shown beside the
                      // button rather than in a toast that goes away while it is read.
                      const outcome = await testMcpConnection(client.id, testSecret);
                      setTestResult(outcome.ok ? outcome.value : outcome.reason);
                      return null;
                    })
                  }
                />
              </div>
              {testResult && (
                <p className="awp-small" style={{ margin: 0 }} role="status">
                  {testResult}
                </p>
              )}
            </div>
          ) : (
            <p className="awp-muted" style={{ margin: 0 }}>{t("MCP access is off for this client.", "وصول MCP معطّل لهذا العميل.")}</p>
          )}
        </Card>
      )}

      {tab === "agui" && (
        <Card
          title={t("Expose agents over AG-UI", "إتاحة الوكلاء عبر AG-UI")}
          actions={
            <Toggle
              on={aguiOn}
              onChange={(next) => {
                setAguiOn(next);
                run(() =>
                  setAgui({
                    clientCode: client.id,
                    enabled: next,
                    allowedEvents: events,
                    allowedOrigins: origins.split(",").map((one) => one.trim()).filter((one) => one !== ""),
                  }),
                );
              }}
            />
          }
        >
          {aguiOn ? (
            <div className="awp-col" style={{ gap: 14 }}>
              <Field label={t("Stream endpoint", "نقطة البث")}>
                <input className="awp-input awp-mono" readOnly value={`${base}/api/integrations/${client.id}/agui`} />
              </Field>
              <Field label={t("Agents available to this client", "الوكلاء المتاحون لهذا العميل")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {agents.map((agent) => (
                    <AgentChip
                      key={agent.id}
                      id={agent.id}
                      on={agentCodes.includes(agent.id)}
                      onClick={() => {
                        const next = toggleIn(agentCodes, agent.id);
                        setAgentCodes(next);
                        run(() => setPermissions({ clientCode: client.id, permissions, agentCodes: next }));
                      }}
                    />
                  ))}
                </div>
              </Field>
              <Field label={t("Events", "الأحداث")}>
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {AGUI_EVENTS.map((event) => (
                    <button
                      key={event}
                      className={"awp-chip awp-mono" + (events.includes(event) ? " on" : "")}
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        const next = toggleIn(events, event);
                        setEvents(next);
                        run(() =>
                          setAgui({
                            clientCode: client.id,
                            enabled: aguiOn,
                            allowedEvents: next,
                            allowedOrigins: origins.split(",").map((one) => one.trim()).filter((one) => one !== ""),
                          }),
                        );
                      }}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t("Allowed origins (CORS)", "المصادر المسموحة (CORS)")} hint={t("A call from any other origin is refused and logged.", "يُرفض أي نداء من مصدر آخر ويُسجل.")}>
                <input
                  className="awp-input"
                  value={origins}
                  onChange={(event) => setOrigins(event.target.value)}
                  onBlur={() =>
                    run(() =>
                      setAgui({
                        clientCode: client.id,
                        enabled: aguiOn,
                        allowedEvents: events,
                        allowedOrigins: origins.split(",").map((one) => one.trim()).filter((one) => one !== ""),
                      }),
                    )
                  }
                />
              </Field>
            </div>
          ) : (
            <p className="awp-muted" style={{ margin: 0 }}>{t("AG-UI streaming is off for this client.", "بث AG-UI معطّل لهذا العميل.")}</p>
          )}
        </Card>
      )}

      {tab === "perms" && (
        <Card title={t("Allowed permissions", "الأذونات المسموحة")}>
          <div className="awp-col" style={{ gap: 10 }}>
            {permissionOptions.map(({ code, en, ar }) => (
              <label key={code} className="awp-row" style={{ gap: 10 }}>
                <input
                  type="checkbox"
                  checked={permissions.includes(code)}
                  onChange={() => {
                    const next = toggleIn(permissions, code);
                    setPermissionList(next);
                    run(
                      () => setPermissions({ clientCode: client.id, permissions: next, agentCodes }),
                      t(
                        "The client's calls are limited to the new set at once.",
                        "تقتصر نداءات العميل على المجموعة الجديدة فوراً.",
                      ),
                    );
                  }}
                />
                <span className="awp-mono" style={{ width: 170 }}>{code}</span>
                <span className="awp-muted">{t(en, ar)}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      {creating && (
        <CreateKey
          clientCode={client.id}
          onClose={() => setCreating(false)}
          onCreated={(secret) => {
            setSecretShown(secret);
            setCreating(false);
          }}
        />
      )}
      {secretShown && <ShowSecret secret={secretShown} onClose={() => setSecretShown(null)} />}
    </div>
  );
}

/** A toggle chip for one agent, drawn with its avatar; renders nothing for an unknown agent. */
function AgentChip({ id, on, onClick }: { id: string; on: boolean; onClick: () => void }) {
  const { nm } = useAwp();
  const agents = useAgents();
  const agent = agents.find((one) => one.id === id);
  if (!agent) return null;
  return (
    <button className={"awp-chip" + (on ? " on" : "")} style={{ paddingInlineStart: 4 }} onClick={onClick}>
      <AgentAv a={agent} s={22} />
      {nm(agent)}
    </button>
  );
}
