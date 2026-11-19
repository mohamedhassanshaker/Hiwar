"use client";

import { useState } from "react";

import {
  connectOAuth,
  importApiConnector,
  refreshConnectorTools,
  removeConnector,
  saveConnector,
  testApiConnector,
  testConnector,
} from "@/features/connectors/actions";
import { PLATFORM_CONNECTOR_CODE, TIERS, type Connector, type ConnectorTool } from "@/features/connectors/types";
import { Btn, Toggle } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { orThrow, Refused } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { CredentialFields, credentialDraft, credentialPayload, type CredentialDraft } from "./credential-fields";

/** A tool's tier as a tag with its label in the console's language; nothing for an unknown tier. */
function TierTag({ t: tier }: { t: string }) {
  const { t } = useAwp();
  const x = TIERS.find((y) => y[0] === tier);
  if (!x) return null;
  return <Tg tone={x[3]} label={tier + " · " + t(x[1], x[2])} />;
}

const TRANSPORT_OPTIONS: [string, string, string][] = [
  ["StreamableHttp", "Remote MCP (streamable HTTP)", "MCP بعيد (HTTP)"],
  ["Stdio", "Local MCP (stdio)", "MCP محلي (stdio)"],
];

/**
 * The drawer's working copy: the connector, the credential being typed (D296), and for a new
 * REST API the OpenAPI document its tools come from.
 */
type Draft = Connector & { cred: CredentialDraft; document: string; fileName: string };

function draftOf(connector: Connector): Draft {
  return { ...connector, cred: credentialDraft(connector.credential, connector.auth), document: "", fileName: "" };
}

/**
 * `UC-54.1-01`…`-08` and `UC-54.2-01`…`-08`: one connector, add or edit.
 *
 * The same form does both, because adding is editing a connector that does not exist yet.
 * What it never does is decide anything the server has to stand behind: Test connection
 * reports the real handshake, and the server shakes hands again before it stores an enabled
 * connector, so a drawer that was told the test passed cannot enable a server that is down.
 */
export function ConnectorDrawer({
  c,
  isNew,
  readOnly,
  onDone,
  onClose,
  oauthCallbackUrl,
  connected,
}: {
  c: Connector;
  isNew?: boolean;
  readOnly: boolean;
  onDone: () => void;
  onClose: () => void;
  /** Where an authorization server sends an administrator back after Connect (D296). */
  oauthCallbackUrl: string;
  /** What the last Connect of this connector came back with. */
  connected?: { ok: boolean; reason?: string };
}) {
  const { t, why } = useAwp();
  const [x, setX] = useState<Draft>(draftOf(c));
  const [confirmingRemoval, setConfirmingRemoval] = useState<string[] | null>(null);
  const [run, pending] = useAction();

  const setTool = (name: string, tier: string) =>
    setX({ ...x, tools: x.tools.map((tool) => (tool.name === name ? { ...tool, tier } : tool)) });

  /** A REST API's tools are its OpenAPI document's operations; an MCP server lists its own. */
  const rest = x.transport === "OpenApi";
  /** A stdio server's secrets are its environment, not request headers. */
  const stdio = x.transport === "Stdio";
  const credential = stdio ? undefined : credentialPayload(x.cred);

  const payload = () => ({
    code: x.n,
    nameEn: x.name,
    nameAr: x.nameAr,
    catalogueId: x.catalogueId,
    transport: x.transport,
    url: x.url,
    command: x.command,
    authType: credential?.type ?? x.auth,
    credential,
    defaultTier: x.def,
    enabled: x.on,
    tools: x.tools.map((tool) => ({ name: tool.name, tier: tool.tier, description: "" })),
    // The version the page holds now, not the draft's: a handshake records the connector's
    // status while the drawer is open, and the version trigger moves the row on each time.
    version: isNew ? undefined : c.version,
  });

  /** A saved REST API is tested by reaching it; its tools are its document's operations. */
  const restApi = rest && !isNew;

  /** D296: an administrator signs in at the server's authorization server, which sends them back. */
  const connect = () =>
    run(async () => {
      const { authorizationUrl } = orThrow(await connectOAuth({ connectorCode: x.n }));
      window.location.assign(authorizationUrl);
      return null;
    });

  /** `UC-54.1-02`: the real handshake, listing the tools it found at their earned tiers. */
  const test = () =>
    run(async () => {
      if (restApi) {
        const reached = await testApiConnector({ connectorCode: x.n });
        if (!reached.ok) throw new Refused({ reason: why(reached) });
        return t(
          `The API answered (HTTP ${reached.httpStatus}) · ${reached.tools.length} tools`,
          `استجابت الواجهة (HTTP ${reached.httpStatus}) · ${reached.tools.length} أدوات`,
        );
      }
      const result = await testConnector({
        connectorId: x.n,
        name: x.name || x.n,
        transport: x.transport === "Stdio" ? "stdio" : "http",
        url: x.url,
        command: x.transport === "Stdio" ? x.command.trim().split(/\s+/).filter(Boolean) : undefined,
        authType: credential?.type ?? x.auth,
        credential,
        defaultTier: x.def,
      });
      if (!result.ok) {
        // `UC-54.1-05`: the error, and the connector may still be added Disabled.
        setX((prev) => ({ ...prev, on: false }));
        throw new Refused({ reason: why(result) });
      }
      const known = new Map(x.tools.map((tool) => [tool.name, tool.tier]));
      setX((prev) => ({
        ...prev,
        tools: result.tools.map<ConnectorTool>((tool) => ({
          name: tool.name,
          tier: known.get(tool.name) ?? tool.tier,
          available: true,
        })),
      }));
      return (
        t("Handshake OK", "المصافحة ناجحة") + " · " + result.tools.length + t(" tools listed", " أدوات مسرودة")
      );
    });

  const save = () =>
    run(async () => {
      if (isNew && rest) {
        // `UC-54.1-09`: a REST API is registered from its document, every operation a tool.
        const outcome = orThrow(
          await importApiConnector({
            code: x.n,
            nameEn: x.name,
            nameAr: x.nameAr,
            document: x.document,
            serverUrl: x.url,
            authType: credential?.type ?? "None",
            credential,
            defaultTier: x.def,
            enabled: x.on,
          }),
        );
        onDone();
        // What was skipped is said, not dropped: an operation the document declared and the
        // connector has not got is something to know about.
        return outcome.skipped.length
          ? t(
              `${outcome.code}: ${outcome.tools} operations registered, ${outcome.skipped.length} skipped (${outcome.skipped[0]}).`,
              `${outcome.code}: سُجّلت ${outcome.tools} عملية، وتُخطّيت ${outcome.skipped.length}.`,
            )
          : t(
              `${outcome.code}: ${outcome.tools} operations registered from ${outcome.title}.`,
              `${outcome.code}: سُجّلت ${outcome.tools} عملية من ${outcome.title}.`,
            );
      }
      const result = await saveConnector(payload());
      if (!result.ok) throw new Refused({ reason: why(result) });
      onDone();
      return t(`${x.n} was saved.`, `حُفظ ${x.n}.`);
    });

  /** `UC-54.2-06`: read the server's list again and say what moved. */
  const refresh = () =>
    run(async () => {
      const result = await refreshConnectorTools({ connectorCode: x.n });
      if (!result.ok) throw new Refused({ reason: why(result) });
      onDone();
      return t("The tool list was read again.", "أُعيدت قراءة قائمة الأدوات.");
    });

  /** `UC-54.2-05`: name the agents that lose their tools before anything is removed. */
  const askToRemove = () =>
    run(async () => {
      const result = await removeConnector({ connectorCode: x.n, dryRun: true });
      // The dry run only decides what the confirmation says, so it reports nothing itself.
      setConfirmingRemoval(result.ok ? result.affectedAgents : []);
      return null;
    });

  const remove = () =>
    run(async () => {
      const result = await removeConnector({ connectorCode: x.n });
      if (!result.ok) throw new Refused({ reason: why(result) });
      onDone();
      return t(`${x.n} was removed.`, `أُزيل ${x.n}.`);
    });

  const unreviewed = x.tools.filter((tool) => !tool.available);

  if (confirmingRemoval) {
    return (
      <Drawer
        w={640}
        title={t("Remove connector", "إزالة الموصل")}
        sub={<span className="awp-mono">{x.n}</span>}
        onClose={() => setConfirmingRemoval(null)}
        footer={
          <>
            <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={() => setConfirmingRemoval(null)} />
            <Btn type="danger" label={t("Remove", "إزالة")} disabled={pending} onClick={remove} />
          </>
        }
      >
        <p style={{ margin: 0 }} role="alert">
          {confirmingRemoval.length
            ? t(
                "These agents use this connector and will lose every tool it offers:",
                "يستخدم هؤلاء الوكلاء هذا الموصل وسيفقدون كل أداة يتيحها:",
              )
            : t("No agent uses this connector.", "لا يستخدم أي وكيل هذا الموصل.")}
        </p>
        {confirmingRemoval.length > 0 && (
          <div className="awp-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {confirmingRemoval.map((code) => (
              <span key={code} className="awp-chip awp-mono">
                {code}
              </span>
            ))}
          </div>
        )}
      </Drawer>
    );
  }

  // D228: the Platform connector's tools are the platform's own, with the catalogue's tiers.
  // It is not configured here; an agent is granted its tools on the agent's Connector tools tab.
  // A new connector whose typed code happens to be "platform" stays the form, so Add answers the refusal.
  if (!isNew && x.n === PLATFORM_CONNECTOR_CODE) {
    return (
      <Drawer
        w={640}
        title={t(x.name, x.nameAr) || x.n}
        sub={<span className="awp-mono">{x.n}</span>}
        onClose={onClose}
        footer={<Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />}
      >
        <p style={{ margin: 0 }}>
          {t(
            "The platform's own tools. Part of the platform: it cannot be removed or switched off. Grant its tools to an agent on the agent's Connector tools tab. Every call runs with the permissions of the person the agent works for.",
            "أدوات المنصة نفسها. جزء من المنصة: لا يمكن إزالته أو إيقافه. امنح أدواته لوكيل من تبويب أدوات التكامل للوكيل. يعمل كل استدعاء بصلاحيات الشخص الذي يعمل الوكيل لصالحه.",
          )}
        </p>
        <div className="awp-col" style={{ gap: 0 }}>
          <b style={{ paddingBottom: 8 }}>
            {t(`${x.tools.length} tools`, `${x.tools.length} أداة`)}
          </b>
          {x.tools.map((tool) => (
            <div
              key={tool.name}
              className="awp-row"
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)", gap: 10 }}
            >
              <span className="awp-mono" style={{ flex: 1 }}>
                {tool.name}
              </span>
              {tool.harness && <Tg tone="neutral" label={t("Harness", "المشغّل")} />}
              <TierTag t={tool.tier} />
            </div>
          ))}
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      w={640}
      title={t(x.name, x.nameAr) || x.n}
      sub={<span className="awp-mono">{x.n}</span>}
      onClose={onClose}
      footer={
        readOnly ? (
          <Btn type="secondary" label={t("Close", "إغلاق")} onClick={onClose} />
        ) : (
          <>
            <Btn
              label={isNew ? t("Add connector", "إضافة الموصل") : t("Save changes", "حفظ التغييرات")}
              disabled={pending || x.n.trim() === "" || (isNew && rest && x.document.trim() === "")}
              onClick={save}
            />
            {!(isNew && rest) && (
              <Btn
                type="secondary"
                label={t("Test connection", "اختبار الاتصال")}
                disabled={pending}
                onClick={test}
              />
            )}
            {!isNew && !restApi && (
              <Btn
                type="secondary"
                label={t("Refresh tools", "تحديث الأدوات")}
                disabled={pending}
                onClick={refresh}
              />
            )}
            {!isNew && !x.builtin && (
              <Btn type="danger" label={t("Remove", "إزالة")} disabled={pending} onClick={askToRemove} />
            )}
          </>
        )
      }
    >
      {unreviewed.length > 0 && (
        <p role="alert" style={{ margin: 0, color: "var(--feedback-warning-text)" }}>
          {t(
            "The server's tool list changed. These tools are unavailable until you set their tier and save:",
            "تغيّرت قائمة أدوات الخادم. هذه الأدوات غير متاحة حتى تحدد مستواها وتحفظ:",
          )}{" "}
          <span className="awp-mono">{unreviewed.map((tool) => tool.name).join(", ")}</span>
        </p>
      )}
      {!isNew && (
        <div className="awp-row" style={{ padding: 14, borderRadius: 12, background: "var(--surface-card)" }}>
          <div style={{ flex: 1 }}>
            <b>{t("Connector enabled", "الموصل مفعّل")}</b>
            <div className="awp-small awp-muted">
              {t(
                "When off, agents cannot call any of its tools.",
                "عند الإيقاف لا يمكن للوكلاء استدعاء أي من أدواته.",
              )}
            </div>
          </div>
          <Toggle on={x.on} onChange={readOnly ? () => undefined : (v) => setX({ ...x, on: v })} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Name (English)", "الاسم (بالإنجليزية)")}>
          <input
            className="awp-input"
            value={x.name}
            disabled={readOnly}
            aria-label={t("Name (English)", "الاسم (بالإنجليزية)")}
            onChange={(e) => setX({ ...x, name: e.target.value })}
          />
        </Field>
        <Field label={t("Name (Arabic)", "الاسم (بالعربية)")}>
          <input
            className="awp-input"
            dir="rtl"
            value={x.nameAr}
            disabled={readOnly}
            aria-label={t("Name (Arabic)", "الاسم (بالعربية)")}
            onChange={(e) => setX({ ...x, nameAr: e.target.value })}
          />
        </Field>
      </div>
      <Field
        label={t("Code", "الرمز")}
        hint={
          isNew
            ? t(
                "Agents call its tools as code/tool. Lowercase letters, digits and hyphens; fixed once added.",
                "يستدعي الوكلاء أدواته بالصيغة الرمز/الأداة. أحرف لاتينية صغيرة وأرقام وشرطات؛ لا يتغير بعد الإضافة.",
              )
            : t(
                "Agents call its tools as code/tool, so the code is fixed once added.",
                "يستدعي الوكلاء أدواته بالصيغة الرمز/الأداة، لذا لا يتغير الرمز بعد الإضافة.",
              )
        }
      >
        <input
          className="awp-input awp-mono"
          value={x.n}
          disabled={readOnly || !isNew}
          aria-label={t("Code", "الرمز")}
          onChange={(e) => setX({ ...x, n: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
        />
      </Field>
      {/* One way in for both kinds: an MCP server, or a REST API from its OpenAPI document. */}
      {isNew && (
        <Field label={t("Type", "النوع")}>
          <PopSelect
            className="awp-input"
            value={rest ? "rest" : "mcp"}
            disabled={readOnly}
            aria-label={t("Type", "النوع")}
            onChange={(e) =>
              setX({
                ...x,
                transport: e.target.value === "rest" ? "OpenApi" : "StreamableHttp",
                url: e.target.value === "rest" ? "" : "https://",
                cred: { ...x.cred, type: x.cred.type === "OAuth" && e.target.value === "rest" ? "None" : x.cred.type },
              })
            }
          >
            <option value="mcp">{t("MCP server", "خادم MCP")}</option>
            <option value="rest">{t("REST API (OpenAPI)", "واجهة REST (OpenAPI)")}</option>
          </PopSelect>
        </Field>
      )}
      {!rest && (
        <Field label={t("Transport", "النقل")}>
          <PopSelect
            className="awp-input"
            value={x.transport}
            disabled={readOnly}
            aria-label={t("Transport", "النقل")}
            onChange={(e) => setX({ ...x, transport: e.target.value })}
          >
            {TRANSPORT_OPTIONS.map(([value, en, ar]) => (
              <option key={value} value={value}>
                {t(en, ar)}
              </option>
            ))}
          </PopSelect>
        </Field>
      )}
      {isNew && rest && (
        <Field label={t("OpenAPI or Swagger file", "ملف OpenAPI أو Swagger")}>
          <input
            type="file"
            className="awp-input"
            accept=".json,.yaml,.yml,application/json,text/yaml"
            disabled={readOnly}
            aria-label={t("OpenAPI or Swagger file", "ملف OpenAPI أو Swagger")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((document) => setX((prev) => ({ ...prev, document, fileName: file.name })));
            }}
          />
          {x.fileName && (
            <p className="awp-small awp-muted" style={{ margin: "6px 0 0" }}>
              {t(`${x.fileName} — ${x.document.length} characters read.`, `${x.fileName} — قُرئ ${x.document.length} حرفاً.`)}
            </p>
          )}
        </Field>
      )}
      {stdio ? (
        <Field
          label={t("Command", "أمر التشغيل")}
          hint={t(
            "The program the runtime starts for this connector, e.g. npx -y @modelcontextprotocol/server-foo.",
            "البرنامج الذي يشغّله وقت التشغيل لهذا الموصل، مثل npx -y @modelcontextprotocol/server-foo.",
          )}
        >
          <input
            className="awp-input awp-mono"
            value={x.command}
            disabled={readOnly}
            aria-label={t("Command", "أمر التشغيل")}
            placeholder="npx -y @modelcontextprotocol/server-foo"
            onChange={(e) => setX({ ...x, command: e.target.value })}
          />
        </Field>
      ) : (
        <Field
          label={t("Server URL", "رابط الخادم")}
          hint={isNew && rest ? t("Leave empty to use the document's own.", "اتركه فارغاً لاستخدام عنوان المستند.") : undefined}
        >
          <input
            className="awp-input awp-mono"
            value={x.url}
            disabled={readOnly}
            aria-label={t("Server URL", "رابط الخادم")}
            onChange={(e) => setX({ ...x, url: e.target.value })}
          />
        </Field>
      )}
      {!stdio && (
        <CredentialFields
          kind={rest ? "rest" : "mcp"}
          draft={x.cred}
          summary={isNew ? undefined : c.credential}
          disabled={readOnly}
          onChange={(cred) => setX((prev) => ({ ...prev, cred }))}
          connect={
            <div className="awp-col" style={{ gap: 8 }}>
              <div className="awp-row" style={{ gap: 10, flexWrap: "wrap" }}>
                {c.credential.type === "OAuth" && c.credential.connected ? (
                  <Tg tone="success" label={t("Connected", "مربوط")} />
                ) : (
                  <Tg tone="warning" label={t("Not connected", "غير مربوط")} />
                )}
                {!readOnly && (
                  <Btn
                    type="secondary"
                    label={t("Connect", "ربط")}
                    disabled={pending || isNew || c.auth !== "OAuth" || x.url !== c.url}
                    onClick={connect}
                  />
                )}
              </div>
              {connected && !connected.ok && (
                <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
                  {connected.reason ?? t("Connecting did not finish.", "لم يكتمل الربط.")}
                </p>
              )}
              <p className="awp-small awp-muted" style={{ margin: 0 }}>
                {isNew || c.auth !== "OAuth"
                  ? t("Save the connector with this authentication, then connect it.", "احفظ الموصل بهذه المصادقة ثم اربطه.")
                  : t(
                      "Connect signs you in at the server's authorization server; every agent's calls then act as that sign-in.",
                      "يسجّل الربط دخولك لدى خادم التفويض؛ ثم تعمل استدعاءات كل وكيل بهذا الدخول.",
                    )}{" "}
                {t("A client registered by hand uses this redirect address:", "يستخدم العميل المسجّل يدوياً عنوان إعادة التوجيه هذا:")}{" "}
                <span className="awp-mono">{oauthCallbackUrl}</span>
              </p>
            </div>
          }
        />
      )}
      <Field
        label={
          rest
            ? t("Default tier for a writing operation", "المستوى الافتراضي لعملية تكتب")
            : t("Default tier for new tools", "المستوى الافتراضي للأدوات الجديدة")
        }
        hint={
          rest
            ? t("A GET or HEAD operation reads only, so it is registered at T0.", "عمليات GET و HEAD تقرأ فقط، فتُسجّل عند T0.")
            : t(
                "Read-only tools default to T0 and destructive tools to T2 from MCP annotations. Project policies can only raise tiers.",
                "تأخذ أدوات القراءة T0 والمدمّرة T2 افتراضياً من تعليقات MCP. يمكن لسياسات المشروع رفع المستويات فقط.",
              )
        }
      >
        <PopSelect
          className="awp-input"
          value={x.def}
          disabled={readOnly}
          onChange={(e) => setX({ ...x, def: e.target.value })}
        >
          {TIERS.map(([tier, en, ar]) => (
            <option key={tier} value={tier}>
              {tier} · {t(en, ar)}
            </option>
          ))}
        </PopSelect>
      </Field>
      <div className="awp-col" style={{ gap: 8 }}>
        <b>{t("Tools and tiers", "الأدوات والمستويات")}</b>
        {x.tools.length === 0 && (
          <div className="awp-small awp-muted">
            {t("No tools yet. Run Test connection to list them.", "لا أدوات بعد. شغّل اختبار الاتصال لسردها.")}
          </div>
        )}
        {x.tools.map((tool) => (
          <div
            key={tool.name}
            className="awp-row"
            style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)", gap: 10 }}
          >
            <span className="awp-mono" style={{ flex: 1 }}>
              {x.n}/{tool.name}
            </span>
            {!tool.available && <Tg tone="warning" label={t("Unavailable", "غير متاحة")} />}
            <TierTag t={tool.tier} />
            <PopSelect
              className="awp-input"
              style={{ width: 170, height: 36 }}
              value={tool.tier}
              disabled={readOnly}
              aria-label={tool.name}
              onChange={(e) => setTool(tool.name, e.target.value)}
            >
              {TIERS.map(([tv, en, ar]) => (
                <option key={tv} value={tv}>
                  {tv} · {t(en, ar)}
                </option>
              ))}
            </PopSelect>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
