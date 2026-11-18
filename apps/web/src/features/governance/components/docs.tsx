"use client";

import { useState } from "react";

import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { GuideBody } from "./guide-body";
import type { DocPage } from "@/features/governance/types";
import { useAwp } from "@/hooks/use-awp";

/** S-79: the documentation pages. */
export function Docs({ pages }: { pages: DocPage[] }) {
  const { t } = useAwp();
  const [sel, setSel] = useState(0);
  const page = pages[sel];
  return (
    <div className="awp-page">
      <PageHead crumb={t("Govern", "الحوكمة")} title={t("Documentation", "المساعدة")} />
      <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0,1fr)", gap: 16 }} className="awp-two">
        <Card pad={false}>
          {pages.map((item, i) => (
            <button key={item.slug} className={"awp-nav-i" + (sel === i ? " on" : "")} style={{ borderRadius: 0 }} onClick={() => setSel(i)}>
              {t(item.titleEn, item.titleAr)}
            </button>
          ))}
        </Card>
        {page ? (
          <Card title={t(page.titleEn, page.titleAr)}>
            <GuideBody text={t(page.bodyEn, page.bodyAr)} />
          </Card>
        ) : (
          <Card>
            <p className="awp-muted" style={{ margin: 0 }}>{t("No documentation yet.", "لا توجد مساعدة بعد.")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
