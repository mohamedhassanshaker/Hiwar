"use client";

import type { CredentialInput, CredentialSummary } from "@/features/connectors/credential";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { useAwp } from "@/hooks/use-awp";

/** D296: the authentication types a connector of each kind offers. */
const AUTH_TYPES: { value: CredentialInput["type"]; en: string; ar: string; kinds: ("mcp" | "rest")[] }[] = [
  { value: "None", en: "None", ar: "بدون", kinds: ["mcp", "rest"] },
  { value: "ApiKey", en: "API key", ar: "مفتاح API", kinds: ["mcp", "rest"] },
  { value: "Bearer", en: "Bearer token", ar: "رمز Bearer", kinds: ["mcp", "rest"] },
  { value: "Basic", en: "Basic (user name and password)", ar: "أساسي (اسم مستخدم وكلمة مرور)", kinds: ["mcp", "rest"] },
  { value: "ClientCredentials", en: "OAuth 2 client credentials", ar: "OAuth 2 بيانات اعتماد العميل", kinds: ["mcp", "rest"] },
  { value: "OAuth", en: "OAuth 2.1 sign-in (authorization code)", ar: "تسجيل دخول OAuth 2.1 (رمز التفويض)", kinds: ["mcp"] },
];

/** How the connector list names an authentication type. */
export function authLabel(type: string): [string, string] {
  const found = AUTH_TYPES.find((one) => one.value === type);
  return found ? [found.en, found.ar] : [type, type];
}

/** The fields the drawer edits, every value a string; secrets start empty. */
export type CredentialDraft = { type: CredentialInput["type"] } & Record<string, string>;

/** An edit starts from the stored credential's non-secret fields. */
export function credentialDraft(summary: CredentialSummary | undefined, fallbackType: string): CredentialDraft {
  const type = (summary?.type ?? fallbackType) as CredentialInput["type"];
  const draft: CredentialDraft = { type, in: "header", name: "X-API-Key" };
  for (const [key, value] of Object.entries(summary ?? {})) {
    if (typeof value === "string") draft[key] = value;
  }
  return draft;
}

/** What is sent: the fields this type takes, a secret left empty kept by the server. */
export function credentialPayload(draft: CredentialDraft): CredentialInput {
  const text = (key: string) => (draft[key] ?? "").trim();
  switch (draft.type) {
    case "ApiKey":
      return { type: "ApiKey", in: draft.in === "query" ? "query" : "header", name: text("name") || "X-API-Key", value: draft.value || undefined };
    case "Bearer":
      return { type: "Bearer", token: draft.token || undefined };
    case "Basic":
      return { type: "Basic", username: text("username"), password: draft.password || undefined };
    case "ClientCredentials":
      return {
        type: "ClientCredentials",
        tokenUrl: text("tokenUrl"),
        issuer: text("issuer"),
        clientId: text("clientId"),
        clientSecret: draft.clientSecret || undefined,
        scope: text("scope") || undefined,
      };
    case "OAuth":
      return { type: "OAuth", clientId: text("clientId") || undefined, clientSecret: draft.clientSecret || undefined, scope: text("scope") || undefined };
    default:
      return { type: "None" };
  }
}

/**
 * D296: a connector's authentication, as fields per type. A secret is never shown back: the
 * field says one is stored, and leaving it empty keeps it.
 */
export function CredentialFields({
  kind,
  draft,
  summary,
  disabled,
  onChange,
  connect,
}: {
  kind: "mcp" | "rest";
  draft: CredentialDraft;
  /** What is stored, to say a secret exists and whether an OAuth connector is connected. */
  summary?: CredentialSummary;
  disabled: boolean;
  onChange: (draft: CredentialDraft) => void;
  /** The Connect control of a saved OAuth connector, drawn by the drawer. */
  connect?: React.ReactNode;
}) {
  const { t } = useAwp();
  const stored = summary && summary.type === draft.type && "hasSecret" in summary && summary.hasSecret;
  const keepHint = stored ? t("Stored. Leave empty to keep it.", "مخزّن. اتركه فارغاً للإبقاء عليه.") : undefined;
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value });
  const input = (key: string, label: [string, string], options: { secret?: boolean; hint?: string; placeholder?: string } = {}) => (
    <Field label={t(...label)} hint={options.hint ?? (options.secret ? keepHint : undefined)}>
      <input
        className={options.secret ? "awp-input" : "awp-input awp-mono"}
        type={options.secret ? "password" : "text"}
        autoComplete={options.secret ? "new-password" : "off"}
        value={draft[key] ?? ""}
        disabled={disabled}
        placeholder={options.placeholder}
        aria-label={t(...label)}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  );

  return (
    <div className="awp-col" style={{ gap: 12 }}>
      <Field
        label={t("Authentication", "المصادقة")}
        hint={t("Stored encrypted; a secret is never shown again.", "تُخزَّن مشفّرة؛ ولا يُعرض أي سر مرة أخرى.")}
      >
        <PopSelect
          className="awp-input"
          value={draft.type}
          disabled={disabled}
          aria-label={t("Authentication", "المصادقة")}
          onChange={(event) => onChange({ ...draft, type: event.target.value as CredentialDraft["type"] })}
        >
          {AUTH_TYPES.filter((one) => one.kinds.includes(kind) || one.value === draft.type).map((one) => (
            <option key={one.value} value={one.value}>
              {t(one.en, one.ar)}
            </option>
          ))}
        </PopSelect>
      </Field>
      {draft.type === "ApiKey" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={t("Send it in", "يُرسل في")}>
              <PopSelect className="awp-input" value={draft.in ?? "header"} disabled={disabled} onChange={(event) => set("in", event.target.value)}>
                <option value="header">{t("A header", "ترويسة")}</option>
                <option value="query">{t("A query parameter", "معامل استعلام")}</option>
              </PopSelect>
            </Field>
            {input("name", ["Name", "الاسم"], { placeholder: "X-API-Key" })}
          </div>
          {input("value", ["Key", "المفتاح"], { secret: true })}
        </>
      )}
      {draft.type === "Bearer" && input("token", ["Token", "الرمز"], { secret: true })}
      {draft.type === "Basic" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {input("username", ["User name", "اسم المستخدم"])}
          {input("password", ["Password", "كلمة المرور"], { secret: true })}
        </div>
      )}
      {draft.type === "ClientCredentials" && (
        <>
          {input("tokenUrl", ["Token URL", "عنوان الرموز"], {
            placeholder: "https://auth.example.com/oauth/token",
            hint:
              kind === "mcp"
                ? t("Leave empty to discover it from the MCP server.", "اتركه فارغاً لاكتشافه من خادم MCP.")
                : t("Where the client id and secret are exchanged for a token.", "حيث يُستبدل معرّف العميل وسره برمز."),
          })}
          {kind === "mcp" &&
            input("issuer", ["Authorization server (issuer)", "خادم التفويض (المُصدِر)"], {
              placeholder: "https://auth.example.com",
              hint: t(
                "The server the client is registered with. The credentials go to no other.",
                "الخادم المسجّل لديه العميل. لا تُرسل بيانات الاعتماد إلى غيره.",
              ),
            })}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {input("clientId", ["Client ID", "معرّف العميل"])}
            {input("clientSecret", ["Client secret", "سر العميل"], { secret: true })}
          </div>
          {input("scope", ["Scope", "النطاق"], { placeholder: "read write" })}
        </>
      )}
      {draft.type === "OAuth" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {input("clientId", ["Client ID", "معرّف العميل"], {
              hint: t("Leave empty to register the platform with the server's authorization server.", "اتركه فارغاً لتسجيل المنصة لدى خادم التفويض."),
            })}
            {input("clientSecret", ["Client secret", "سر العميل"], { secret: true })}
          </div>
          {input("scope", ["Scope", "النطاق"], { placeholder: "read write" })}
          {connect}
        </>
      )}
    </div>
  );
}
