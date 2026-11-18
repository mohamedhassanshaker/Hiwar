"use client";

import { useState, useTransition } from "react";

import { changeToolGrant, revokeTool, setPlatformTool, setToolMode, type ToolConfiguration } from "@/features/agents/actions";
import { grantedToolNames } from "@/features/agents/run-payload";
import type { AgentDetail } from "@/features/agents/types";
import { PLATFORM_CONNECTOR_CODE } from "@/features/connectors/types";
import { AGENT_TOOL_MODES } from "@/db/schema/enums";
import { useToast } from "@/components/shared/toast";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";
import { GrantPicker, type PickerGroup, type PickerItem } from "./grant-picker";

/**
 * S-51 Connector tools: one record per connector the agent holds tools of, each opening onto
 * its tools, every one of which can be taken away (D228).
 *
 * The Platform connector is the platform's own catalogue and the built-ins the harness
 * answers (D80); its grant is the version's platform-tool grant. Every other connector's
 * grant is the version's tool modes. The setup tools and the harness plumbing are absent
 * because no stored grant reaches either.
 */

/** Whether granting this tool is a decision rather than a setting (D17, D63). */
const approvalClass = (tier: string | null) => tier === "T2" || tier === "T3";

type Row = { key: string; name: string; tier: string | null; harness?: boolean; mode?: string; toolId?: string };

const TOOL_TONE: Record<string, string> = { Auto: "neutral", Approval: "warning", Denied: "danger" };
const TOOL_LABEL: Record<string, [string, string]> = { Auto: ["Auto", "تلقائي"], Approval: ["Approval", "اعتماد"], Denied: ["Denied", "مرفوض"] };

/**
 * The Connector tools tab: one collapsible record per connector the agent holds tools of, the
 * Platform connector first, with each tool's tier, mode and a remove control when `editable`.
 * Warns about a skill that declares a tool the grant does not reach, and opens the grant
 * picker, whose save sends every addition and removal as one change (D238).
 */
export function ConnectorTools({
  code,
  detail,
  configuration,
  editable,
}: {
  code: string;
  detail: AgentDetail;
  /** The Platform connector's grant, read for the open agent; null without an active version. */
  configuration: ToolConfiguration | null;
  editable: boolean;
}) {
  const { t, why } = useAwp();
  const { say } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const act = (run: () => Promise<{ ok: true } | { ok: false; message: string; messageAr: string }>, done: string) =>
    start(async () => {
      setProblem(null);
      const result = await run();
      if (!result.ok) {
        setProblem(why(result));
        return;
      }
      setPicking(false);
      say(done);
    });

  const granted = new Set(configuration?.granted ?? []);
  const platformRows: Row[] = (configuration?.catalogue ?? [])
    .filter((tool) => granted.has(tool.name))
    .map((tool) => ({ key: tool.name, name: tool.name, tier: tool.tier, harness: tool.harness }));

  const connectorGroups = new Map<string, Row[]>();
  for (const tool of detail.tools) {
    const [connector, ...rest] = tool.ref.split("/");
    const rows = connectorGroups.get(connector) ?? [];
    rows.push({ key: tool.id, name: rest.join("/"), tier: tool.tier, mode: tool.mode, toolId: tool.id });
    connectorGroups.set(connector, rows);
  }
  const groups: { connector: string; rows: Row[] }[] = [
    ...(configuration ? [{ connector: PLATFORM_CONNECTOR_CODE, rows: platformRows }] : []),
    ...[...connectorGroups.entries()].map(([connector, rows]) => ({ connector, rows })),
  ];

  // What the run token would carry with the grant as it now stands: the same function the run
  // calls, so the warning below cannot drift from what the agent really reaches.
  const reachable = new Set(
    grantedToolNames({
      platformTools: platformRows.map((row) => row.name),
      connectorTools: configuration?.connectorTools ?? [],
    }),
  );
  const undeclared = (configuration?.skills ?? [])
    .map((skill) => ({ ...skill, missing: skill.declaredTools.filter((tool) => !reachable.has(tool)) }))
    .filter((skill) => skill.missing.length > 0);

  const label = (connector: string) => (connector === PLATFORM_CONNECTOR_CODE ? t("Platform", "المنصة") : connector);

  const removeRow = (connector: string, row: Row) =>
    connector === PLATFORM_CONNECTOR_CODE
      ? act(() => setPlatformTool({ code, tool: row.name, enabled: false }), t(`${row.name} was removed from ${code}.`, `أُزيلت ${row.name} من ${code}.`))
      : act(() => revokeTool({ code, connectorToolId: row.toolId }), t(`${connector}/${row.name} was removed from ${code}.`, `أُزيلت ${connector}/${row.name} من ${code}.`));

  // D238: the popup lists every tool the agent could hold, the Platform connector's and
  // each connector's, held or not, keyed `p:<tool>` and `t:<connector tool id>`.
  const pickerGroups: PickerGroup[] = [
    ...(configuration
      ? [{ id: PLATFORM_CONNECTOR_CODE, label: label(PLATFORM_CONNECTOR_CODE), items: configuration.catalogue.map((tool) => ({ key: `p:${tool.name}`, name: tool.name, tier: tool.tier })) }]
      : []),
    ...[
      ...new Set([...detail.tools, ...detail.toolShelf].map((tool) => tool.ref.split("/")[0])),
    ].map((connector) => ({
      id: connector,
      label: connector,
      items: [...detail.tools, ...detail.toolShelf]
        .filter((tool) => tool.ref.split("/")[0] === connector)
        .map((tool) => ({ key: `t:${tool.id}`, name: tool.ref.split("/").slice(1).join("/"), tier: tool.tier })),
    })),
  ];
  const held = new Set([...[...granted].map((name) => `p:${name}`), ...detail.tools.map((tool) => `t:${tool.id}`)]);

  const saveChoice = (picked: Set<string>) => {
    // The ids under one prefix that were added (picked, not held) or removed (held, not picked).
    const change = (prefix: string, on: boolean) =>
      [...(on ? picked : held)].filter((key) => key.startsWith(prefix) && (on ? !held.has(key) : !picked.has(key))).map((key) => key.slice(2));
    act(
      () =>
        changeToolGrant({
          code,
          grantPlatform: change("p:", true),
          revokePlatform: change("p:", false),
          grantTools: change("t:", true),
          revokeTools: change("t:", false),
        }),
      t(`The tools of ${code} were saved.`, `حُفظت أدوات ${code}.`),
    );
  };

  // Granting an approval-class Platform tool is asked first; anything else is a setting.
  const warnOf = (added: PickerItem[]) => {
    const risky = added.filter((tool) => tool.key.startsWith("p:") && approvalClass(tool.tier ?? null)).map((tool) => tool.name);
    return risky.length
      ? t(
          `${risky.join(", ")} delete, publish or apply something, and the change is not undone by cancelling the run. Each call still waits for a person to approve it, bound to the exact payload.`,
          `${risky.join("، ")} تحذف أو تنشر أو تطبّق شيئاً، ولا يُلغى أثرها بإلغاء العملية. يظل كل استدعاء بانتظار اعتماد شخص، مرتبطاً بالحمولة نفسها.`,
        )
      : null;
  };

  return (
    <Card pad={false}>
      {editable && (
        <div className="awp-row" style={{ padding: "12px 20px", justifyContent: "flex-end", borderBottom: "1px solid var(--border-divider)" }}>
          <Btn type="secondary" label={t("Add or remove tools", "إضافة أدوات أو إزالتها")} icon="AddCircle" disabled={saving} onClick={() => setPicking(true)} />
        </div>
      )}
      {problem && (
        <p role="alert" style={{ margin: 0, padding: "12px 20px", color: "var(--feedback-danger-text)" }}>
          {problem}
        </p>
      )}
      {undeclared.map((skill) => (
        <p key={skill.id} role="alert" className="awp-small" style={{ margin: 0, padding: "12px 20px", color: "var(--feedback-warning-text)" }}>
          {t(
            `${skill.name} declares ${skill.missing.join(", ")}, which this agent is not granted. The model will be told to use a tool that is refused.`,
            `تعلن ${skill.name} عن ${skill.missing.join("، ")}، وهي غير ممنوحة لهذا الوكيل. سيُطلب من النموذج استخدام أداة سيُرفض استدعاؤها.`,
          )}
        </p>
      ))}
      {groups.map(({ connector, rows }) => {
        const expanded = open === connector;
        return (
          <div key={connector} style={{ borderBottom: "1px solid var(--border-divider)" }}>
            <button
              type="button"
              className="awp-row"
              aria-expanded={expanded}
              data-connector={connector}
              onClick={() => setOpen(expanded ? null : connector)}
              style={{ width: "100%", padding: "14px 20px", gap: 10, background: "none", border: 0, cursor: "pointer", textAlign: "start", color: "inherit", font: "inherit" }}
            >
              <span style={{ display: "inline-flex", transform: expanded ? "none" : "rotate(-90deg)", transition: "transform .15s" }}>
                <Ic n="ChevronDown" s={18} />
              </span>
              <Ic n="PlugDS" s={18} />
              <b style={{ flex: 1 }}>{label(connector)}</b>
              {connector === PLATFORM_CONNECTOR_CODE && <Tg tone="brand" label={t("Built in", "مدمج")} />}
              <span className="awp-small awp-muted">{t(`${rows.length} ${rows.length === 1 ? "tool" : "tools"}`, `${rows.length} أداة`)}</span>
            </button>
            {expanded && (
              <div style={{ paddingBottom: 6 }}>
                {rows.length === 0 && (
                  <p className="awp-small awp-muted" style={{ margin: 0, padding: "4px 20px 12px 48px" }}>
                    {t("No tools of this connector are granted.", "لا توجد أدوات ممنوحة من هذا التكامل.")}
                  </p>
                )}
                {rows.map((row) => (
                  <div key={row.key} className="awp-row" style={{ padding: "8px 20px", paddingInlineStart: 48, gap: 10 }}>
                    <span className="awp-mono" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{row.name}</span>
                    {row.harness && <Tg tone="neutral" label={t("Harness", "المشغّل")} />}
                    {row.tier && <Tg tone={approvalClass(row.tier) ? "warning" : "neutral"} label={row.tier} />}
                    {row.mode !== undefined &&
                      (editable ? (
                        <PopSelect
                          className="awp-input"
                          style={{ width: 130 }}
                          value={row.mode}
                          aria-label={`${connector}/${row.name}`}
                          disabled={saving}
                          onChange={(e) =>
                            act(() => setToolMode({ code, connectorToolId: row.toolId, mode: e.target.value }), t("The tool's mode was saved.", "حُفظ وضع الأداة."))
                          }
                        >
                          {AGENT_TOOL_MODES.map((mode) => (
                            <option key={mode} value={mode}>{t(...(TOOL_LABEL[mode] ?? [mode, mode]))}</option>
                          ))}
                        </PopSelect>
                      ) : (
                        <Tg tone={TOOL_TONE[row.mode]} label={t(...(TOOL_LABEL[row.mode] ?? [row.mode, row.mode]))} />
                      ))}
                    {editable && (
                      <button
                        type="button"
                        className="awp-iconbtn"
                        style={{ width: 32, height: 32 }}
                        disabled={saving}
                        aria-label={t(`Remove ${row.name}`, `إزالة ${row.name}`)}
                        title={t("Remove tool", "إزالة الأداة")}
                        onClick={() => removeRow(connector, row)}
                      >
                        <Ic n="Cancel01" s={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {groups.length === 0 && (
        <p className="awp-muted" style={{ padding: 20, margin: 0 }}>{t("No tools granted.", "لا توجد أدوات ممنوحة.")}</p>
      )}
      <p className="awp-small awp-muted" style={{ margin: 0, padding: "12px 20px" }}>
        {editable
          ? t(
              "A change is saved as a draft revision and reaches a run once it is published.",
              "يُحفظ التغيير كمسودة ويصل إلى العمليات بعد النشر.",
            )
          : t("You may see this grant but not change it.", "يمكنك عرض هذا المنح دون تغييره.")}
      </p>
      {picking && (
        <GrantPicker
          title={t("Add or remove tools", "إضافة أدوات أو إزالتها")}
          groups={pickerGroups}
          initial={held}
          saving={saving}
          warnOf={warnOf}
          onClose={() => setPicking(false)}
          onSave={saveChoice}
        />
      )}
    </Card>
  );
}
