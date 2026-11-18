"use client";

import Image from "next/image";
import { useState } from "react";

import { PageHead } from "@/components/shared/page-head";
import { Card } from "@/components/ui/card";
import { Lnk } from "@/components/ui/button";
import { ROLES, SCENARIOS, type GuideScenario } from "./scenarios";
import { useAwp } from "@/hooks/use-awp";

/**
 * The user guide: one page per thing somebody sets out to do, with the screens they will
 * see. The pictures come from the running product and are checked in under `public/guide`.
 */

/** The **bold** of a step's words, which is the label on the screen. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((piece, index) => {
        if (piece.startsWith("**")) return <b key={index}>{piece.slice(2, -2)}</b>;
        if (piece.startsWith("`")) return <code key={index} className="awp-mono">{piece.slice(1, -1)}</code>;
        return <span key={index}>{piece}</span>;
      })}
    </>
  );
}

/**
 * One scenario's page: what to have ready, each step with its captured screenshot and a link to
 * the screen, the expected result and what to do if it fails. A step's card title is the step's
 * first sentence with its markup removed.
 */
function Scenario({ scenario, onBack }: { scenario: GuideScenario; onBack: () => void }) {
  const { t, lang } = useAwp();
  return (
    <div className="awp-page">
      <PageHead
        crumb={<Lnk onClick={onBack}>{t("User guide", "دليل الاستخدام")}</Lnk>}
        title={t(scenario.titleEn, scenario.titleAr)}
        sub={t(scenario.purposeEn, scenario.purposeAr)}
      />
      <Card title={t("Before you start", "قبل أن تبدأ")}>
        <p style={{ margin: 0 }}>{t(scenario.beforeEn, scenario.beforeAr)}</p>
      </Card>

      {scenario.steps.map((step, index) => (
        <Card key={step.shot} title={`${index + 1}. ${t(step.en, step.ar).replace(/[*`]/g, "").split(".")[0]}`}>
          <div className="awp-col" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}>
              <Words text={t(step.en, step.ar)} />
            </p>
            {/* Captured at 1440×900 from the seeded demo organisation. */}
            <Image
              src={`/guide/${lang}/${scenario.slug}-${String(index + 1).padStart(2, "0")}.png`}
              alt={t(step.en, step.ar).replace(/[*`]/g, "")}
              width={1440}
              height={900}
              style={{ width: "100%", height: "auto", borderRadius: 12, border: "1px solid var(--border-divider)" }}
              unoptimized
            />
            <Lnk onClick={() => window.open(step.path, "_self")}>{t("Open this screen", "افتح هذه الشاشة")}</Lnk>
          </div>
        </Card>
      ))}

      <Card title={t("What you should see", "ما ينبغي أن تراه")}>
        <p style={{ margin: 0 }}>{t(scenario.resultEn, scenario.resultAr)}</p>
      </Card>
      <Card title={t("If it does not work", "إذا لم ينجح الأمر")}>
        <p style={{ margin: 0 }}>{t(scenario.troubleEn, scenario.troubleAr)}</p>
      </Card>
    </div>
  );
}

/**
 * The guide's index: scenarios grouped by role, filtered by a search over their titles and
 * purposes in both languages. Choosing one shows its `Scenario` page in place.
 */
export function Guide() {
  const { t } = useAwp();
  const [open, setOpen] = useState<string | null>(null);
  const [term, setTerm] = useState("");

  const scenario = SCENARIOS.find((one) => one.slug === open);
  if (scenario) return <Scenario scenario={scenario} onBack={() => setOpen(null)} />;

  const needle = term.trim().toLowerCase();
  const matching = SCENARIOS.filter(
    (one) =>
      needle === "" ||
      `${one.titleEn} ${one.titleAr} ${one.purposeEn} ${one.purposeAr}`.toLowerCase().includes(needle),
  );

  return (
    <div className="awp-page">
      <PageHead
        crumb={t("Documentation", "المساعدة")}
        title={t("User guide", "دليل الاستخدام")}
        sub={t(
          "What to do, screen by screen, with pictures of the product as it is.",
          "ما الذي تفعله، شاشة بشاشة، بصور من المنتج كما هو.",
        )}
      >
        <input
          className="awp-input"
          style={{ maxWidth: 260 }}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          aria-label={t("Search the guide", "ابحث في الدليل")}
          placeholder={t("Search the guide", "ابحث في الدليل")}
        />
      </PageHead>

      {ROLES.map((role) => {
        const inRole = matching.filter((one) => one.role === role.id);
        if (inRole.length === 0) return null;
        return (
          <Card key={role.id} title={t(role.en, role.ar)}>
            <div className="awp-col" style={{ gap: 2 }}>
              {inRole.map((one) => (
                <button key={one.slug} className="awp-nav-i" style={{ textAlign: "start" }} onClick={() => setOpen(one.slug)}>
                  <span>
                    <b>{t(one.titleEn, one.titleAr)}</b>
                    <div className="awp-small awp-muted">{t(one.purposeEn, one.purposeAr)}</div>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        );
      })}

      {matching.length === 0 && (
        <Card>
          <p className="awp-muted" style={{ margin: 0 }}>
            {t("Nothing in the guide matches that.", "لا يوجد في الدليل ما يطابق ذلك.")}
          </p>
        </Card>
      )}
    </div>
  );
}
