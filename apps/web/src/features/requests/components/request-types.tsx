"use client";

import { useState } from "react";

import { createRequestType } from "@/features/requests/actions";
import { type RequestType, type RequestTypeDetail } from "@/features/requests/types";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAwp } from "@/hooks/use-awp";
import { keyOf, useProjOpts } from "@/components/shared/forms";
import { DataTable, FilterBar, Sel } from "@/components/shared/layout";
import { StTag, useTr } from "@/components/shared/status-tags";
import { useScreenParams } from "@/lib/routes";
import { RequestTypeDesigner } from "./request-type-designer";

/** S-30: the request types, filtered, and the designer of the one opened. */
export function RequestTypes({
  types,
  typeDetails,
  mayWriteTypes,
  appUrl,
}: {
  types: RequestType[];
  typeDetails: Record<string, RequestTypeDetail>;
  /** `UC-30.1-04`: the platform origin the designer's embed snippet points at. */
  appUrl: string;
  /** `UC-27.2-05`: whether this person may design a request type at all. */
  mayWriteTypes: boolean;
}) {
  const { t, why } = useAwp();
  const { open } = useModals();
  const tr = useTr();
  const projOpts = useProjOpts();
  const blank = { q: "", p: "any", cat: "any", st: "any", ch: "any", dec: "any" };
  const [f, setF] = useState(blank);
  const p = useScreenParams();
  const [rt, setRt] = useState<RequestType | null>(() => (p.open ? types.find((type) => type.c === p.open) || null : null));
  // The address opens a type when it changes, as the request list does (D165): the assistant
  // links a type it just created as `?open=<code>`.
  const [openedCode, setOpenedCode] = useState(rt ? p.open : undefined);
  const wanted = p.open ? types.find((type) => type.c === p.open) : undefined;
  if (p.open && p.open !== openedCode && wanted) {
    setOpenedCode(p.open);
    setRt(wanted);
  }
  const [typeError, setTypeError] = useState<string | null>(null);
  /**
   * `UC-27.2-02`: the type is created, then its detail opens. Creating it here rather than
   * only in the browser is what makes the steps the designer then adds belong to something.
   */
  const newType = ({ name: n, code, categoryEn, decomposition }: { name: string; code: string; categoryEn: string; decomposition: string }) => {
    setTypeError(null);
    void createRequestType({ code: code || keyOf(n) || "NEW", nameEn: n, nameAr: n, categoryEn, decomposition })
      .then((outcome) => {
        if (!outcome.ok) {
          setTypeError(outcome.reason);
          return;
        }
        setRt({ ...types[0], n, nAr: n, c: outcome.value, v: "v1", st: "Draft", p: "" });
      })
      .catch((problem: unknown) => setTypeError(why(problem)));
  };
  if (rt) return <RequestTypeDesigner key={rt.c} r={rt} detail={typeDetails[rt.c]} appUrl={appUrl} back={() => setRt(null)} />;

  const set = (k: keyof typeof blank) => (v: string) => setF({ ...f, [k]: v });
  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  const categories = distinct(types.map((type) => type.cat));
  const channels = distinct(types.flatMap((type) => type.ch.split(", ")));
  const decompositions = distinct(types.map((type) => type.dec));
  const statuses = distinct(types.map((type) => type.st));
  const rows = types.filter(
    (r) =>
      (!f.q || `${r.n} ${r.nAr} ${r.c}`.toLowerCase().includes(f.q.toLowerCase())) &&
      (f.p === "any" || r.p === f.p) &&
      (f.cat === "any" || r.cat === f.cat) &&
      (f.st === "any" || r.st === f.st) &&
      (f.ch === "any" || r.ch.split(", ").includes(f.ch)) &&
      (f.dec === "any" || r.dec === f.dec),
  );
  return (
    <div className="awp-page">
      <PageHead
        title={t("Request types", "أنواع الطلبات")}
        sub={t("A request type is the form and the transition steps a request moves through.", "نوع الطلب هو النموذج وخطوات الانتقال التي يمر بها الطلب.")}
      >
        {mayWriteTypes && <Btn label={t("New request type", "نوع طلب جديد")} icon="AddCircle" onClick={() => open("rtype", { onCreateRequestType: newType })} />}
      </PageHead>
      {typeError && (
        <Card>
          <p style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
            {typeError}
          </p>
        </Card>
      )}
      <Card pad={false}>
        <FilterBar>
          <input className="awp-input" style={{ maxWidth: 220 }} value={f.q} onChange={(e) => set("q")(e.target.value)} placeholder={t("Name or code", "الاسم أو الرمز")} aria-label={t("Name or code", "الاسم أو الرمز")} />
          <Sel value={f.p} onChange={set("p")} opts={projOpts()} />
          <Sel value={f.cat} onChange={set("cat")} w={170} opts={[["any", t("Any category", "أي فئة")], ...categories.map((cat) => [cat, cat] as [string, string])]} />
          <Sel value={f.ch} onChange={set("ch")} w={170} opts={[["any", t("Any channel", "أي قناة")], ...channels.map((ch) => [ch, ch] as [string, string])]} />
          <Sel value={f.dec} onChange={set("dec")} w={170} opts={[["any", t("Any decomposition", "أي تجزئة")], ...decompositions.map((dec) => [dec, dec] as [string, string])]} />
          <Sel value={f.st} onChange={set("st")} w={150} opts={[["any", t("Any status", "أي حالة")], ...statuses.map((st) => [st, tr(st)] as [string, string])]} />
          <Lnk onClick={() => setF(blank)}>{t("Clear", "مسح")}</Lnk>
        </FilterBar>
        <DataTable
          rows={rows}
          cols={[
            {
              h: t("Request type", "نوع الطلب"),
              r: (r) => (
                <div>
                  <button className="awp-lnk-t" onClick={() => setRt(r)}>
                    {t(r.n, r.nAr)}
                  </button>
                  <div className="awp-small awp-muted awp-mono">
                    {r.c} · {r.v}
                  </div>
                </div>
              ),
            },
            { h: t("Project", "المشروع"), r: (r) => (r.p ? <span className="awp-mono">{r.p}</span> : <span className="awp-muted">—</span>) },
            { h: t("Category", "الفئة"), r: (r) => r.cat },
            { h: t("Intake channels", "قنوات الاستقبال"), r: (r) => <span className="awp-small">{r.ch}</span> },
            { h: t("Decomposition", "التجزئة"), r: (r) => <span className="awp-mono">{r.dec}</span> },
            { h: t("SLA", "اتفاقية الخدمة"), r: (r) => r.sla },
            { h: t("Status", "الحالة"), r: (r) => <StTag s={r.st} /> },
            { h: t("Open", "مفتوحة"), end: true, r: (r) => r.open },
            // `UC-27.2-04`: Open on a type goes to its detail; read-only without the permission.
            { h: "", end: true, r: (r) => <Lnk onClick={() => setRt(r)}>{mayWriteTypes ? t("Open", "فتح") : t("View", "عرض")}</Lnk> },
          ]}
        />
        {!rows.length && (
          <p className="awp-muted" style={{ padding: 24, margin: 0, textAlign: "center" }}>
            {t("No request types match these filters.", "لا توجد أنواع طلبات تطابق عوامل التصفية.")}
          </p>
        )}
      </Card>
    </div>
  );
}
