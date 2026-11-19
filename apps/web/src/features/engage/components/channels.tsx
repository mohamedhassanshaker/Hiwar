"use client";

import { useState, useTransition } from "react";

import { setChannelEnabled } from "@/features/engage/actions";
import { CHANNEL_LABEL, COMING_SOON, type Channel, type ChannelConfig } from "@/features/engage/types";
import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { Lnk, Toggle } from "@/components/ui/button";
import { Tg } from "@/components/ui/tag";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { ConfigureChannel, TestChannel, type BindingTarget } from "./channel-modals";

/** S-61: the channels the platform talks to the outside world through. */
export function Channels({
  channels,
  configs,
  targets,
}: {
  channels: Channel[];
  configs: Record<string, ChannelConfig>;
  targets: BindingTarget[];
}) {
  const { t } = useAwp();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, toggle] = useTransition();

  const name = (type: string) => t(...(CHANNEL_LABEL[type] ?? [type, type]));

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
        title={t("Channels", "القنوات")}
        sub={t(
          "Enable or disable a channel and configure its credentials. Changes are hot-reloaded.",
          "فعّل القناة أو عطّلها واضبط بيانات اعتمادها. تُطبق التغييرات دون إعادة تشغيل.",
        )}
      />
      {problem && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {problem}
        </p>
      )}
      <Card pad={false}>
        <DataTable
          rows={channels}
          onRow={(row) => setConfiguring(row.type)}
          cols={[
            {
              h: "",
              r: (row) => (
                <Toggle
                  on={row.on}
                  onChange={(next) =>
                    toggle(async () => {
                      const outcome = await setChannelEnabled({
                        type: row.type,
                        enabled: next,
                        version: configs[row.type]?.version ?? 1,
                      });
                      setProblem(outcome.ok ? null : outcome.reason);
                    })
                  }
                />
              ),
            },
            { h: t("Channel", "القناة"), r: (row) => <b>{name(row.type)}</b> },
            { h: t("Status", "الحالة"), r: (row) => <StTag s={row.st} /> },
            { h: t("Bound to", "مرتبطة بـ"), r: (row) => t(row.boundToEn, row.boundToAr) },
            {
              h: "",
              end: true,
              r: (row) => (
                <div className="awp-row" style={{ justifyContent: "flex-end", gap: 12 }}>
                  <Lnk onClick={() => setTesting(row.type)}>{t("Test channel", "اختبار القناة")}</Lnk>
                  <Lnk onClick={() => setConfiguring(row.type)}>{t("Configure", "إعداد")}</Lnk>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* `UC-61.1-10`: these have no toggle, because there is nothing behind them to enable. */}
      <Card title={t("Coming soon", "قريباً")}>
        <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {COMING_SOON.map((one) => (
            <span key={one} className="awp-chip" style={{ cursor: "default", opacity: 0.7 }} aria-disabled="true">
              {one}
              <Tg label={t("Coming soon", "قريباً")} />
            </span>
          ))}
        </div>
      </Card>

      {configuring && configs[configuring] && (
        <ConfigureChannel config={configs[configuring]} targets={targets} onClose={() => setConfiguring(null)} />
      )}
      {testing && configs[testing] && <TestChannel config={configs[testing]} onClose={() => setTesting(null)} />}
    </div>
  );
}
