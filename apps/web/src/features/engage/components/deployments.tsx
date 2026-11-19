"use client";

import { useState } from "react";

import { type Deployment } from "@/features/engage/types";
import { useGo } from "@/lib/routes";
import { PageHead } from "@/components/shared/page-head";
import { Btn } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stars } from "@/components/ui/metrics";
import { Who } from "@/components/ui/avatar";
import { useAwp } from "@/hooks/use-awp";
import { DataTable } from "@/components/shared/layout";
import { StTag } from "@/components/shared/status-tags";
import { DeploymentDetail, type DeploymentExtras } from "./deployment-detail";
import { NewDeployment } from "./new-deployment";

/** S-62: the deployments, and the one that is open. */
export function Deployments({
  deployments,
  extras,
  agentOptions,
}: {
  deployments: Deployment[];
  extras: Record<string, DeploymentExtras>;
  agentOptions: { code: string; nameEn: string; nameAr: string }[];
}) {
  const { t, aName } = useAwp();
  const go = useGo();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const open = deployments.find((one) => one.id === selected);
  if (open && extras[open.id]) {
    return <DeploymentDetail deployment={open} extras={extras[open.id]} back={() => setSelected(null)} go={go} />;
  }

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("AI Capabilities", "قدرات الذكاء الاصطناعي")}
        title={t("Embedded Deployment", "النشر المضمّن")}
        sub={t(
          "Agents published to websites and channels, with branding, security and storylines.",
          "وكلاء منشورون على المواقع والقنوات مع الهوية والأمان والسيناريوهات.",
        )}
      >
        <Btn label={t("New deployment", "نشر جديد")} icon="AddCircle" onClick={() => setCreating(true)} />
      </PageHead>
      <Card pad={false}>
        <DataTable
          onRow={(row) => setSelected(row.id)}
          rows={deployments}
          cols={[
            {
              h: t("Deployment", "النشر"),
              r: (row) => (
                <div>
                  <b>{t(row.n, row.nAr)}</b>
                  <div className="awp-small awp-muted awp-mono">{row.id}</div>
                </div>
              ),
            },
            {
              h: t("Default agent", "الوكيل الافتراضي"),
              r: (row) => (
                <button
                  className="awp-row awp-lnk-t"
                  style={{ gap: 8 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    go("agents", { agent: row.a });
                  }}
                >
                  <Who id={row.a} s={24} />
                  {aName(row.a)}
                </button>
              ),
            },
            { h: t("Surfaces", "الواجهات"), r: (row) => row.surf },
            { h: t("Storyline", "السيناريو"), r: (row) => <span className="awp-small">{row.sl}</span> },
            { h: t("Status", "الحالة"), r: (row) => <StTag s={row.st} /> },
            {
              h: t("Rate", "التقييم"),
              r: (row) => (row.rate ? <Stars v={row.rate} /> : <span className="awp-muted">{t("No ratings yet", "لا تقييمات بعد")}</span>),
            },
          ]}
        />
      </Card>
      {creating && <NewDeployment agentOptions={agentOptions} onClose={() => setCreating(false)} onCreated={setSelected} />}
    </div>
  );
}
