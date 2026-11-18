"use client";

import { orThrow } from "@/lib/outcome";
import { useState } from "react";

import { usePeople } from "@/components/shared/directory";
import { KpiRow } from "@/components/shared/layout";
import { useModals } from "@/components/shared/modal-host";
import { PageHead } from "@/components/shared/page-head";
import { StTag } from "@/components/shared/status-tags";
import { Btn, Lnk, Toggle } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PopSelect } from "@/components/ui/pop-select";
import { Who } from "@/components/ui/avatar";
import {
  addProjectMember,
  deleteProject,
  removeProjectMember,
  renameProject,
  updateProjectPolicy,
} from "@/features/projects/actions";
import { type ProjectDetail, type ProjectsScreen } from "@/features/projects/types";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { formatDay } from "@/i18n";
import { useGo, type ScreenId } from "@/lib/routes";
import { type Project } from "@/types/directory";

const SENSITIVITIES: [string, string, string][] = [
  ["Public", "Public", "عام"],
  ["Internal", "Internal", "داخلي"],
  ["Confidential", "Confidential", "سري"],
  ["Restricted", "Restricted", "مقيّد"],
];

const STATUSES: [string, string, string][] = [
  ["Backlog", "Backlog", "قائمة الانتظار"],
  ["Planned", "Planned", "مخطط"],
  ["InProgress", "In progress", "قيد التنفيذ"],
  ["Paused", "Paused", "متوقف"],
  ["Done", "Done", "منجز"],
  ["Archived", "Archived", "مؤرشف"],
];

/** S-21: one project, its policy, its members and what it contains. */
export function Detail({
  project,
  detail,
  connectors,
  agents,
  mayWrite,
  onBack,
}: {
  project: Project;
  detail: ProjectDetail;
  connectors: ProjectsScreen["connectors"];
  agents: ProjectsScreen["agents"];
  mayWrite: boolean;
  onBack: () => void;
}) {
  const { t, lang, aName, nm } = useAwp();
  const people = usePeople();
  const go = useGo();
  const { act } = useModals();
  const [editing, setEditing] = useState(false);
  const [nameEn, setNameEn] = useState(project.n);
  const [nameAr, setNameAr] = useState(project.nAr);
  const [sensitivity, setSensitivity] = useState(detail.sensitivity);
  const [status, setStatus] = useState(detail.status);
  const [reviewer, setReviewer] = useState(detail.requireReviewerNotAuthor);
  const [allowedConnectors, setAllowedConnectors] = useState<string[]>(detail.allowedConnectors);
  const [allowedAgents, setAllowedAgents] = useState<string[]>(detail.allowedAgents);
  const [rules, setRules] = useState(detail.approvalRules);
  const [newRuleRef, setNewRuleRef] = useState("");
  const [newRuleTier, setNewRuleTier] = useState("T2");
  const [addCode, setAddCode] = useState("");
  const [run, pending] = useAction();
  // `UC-21.3-05`: the member whose open work has already been shown, so the second click
  // is the confirmation rather than the same warning again.
  const [warned, setWarned] = useState<string | null>(null);
  const memberKey = (member: { id: string; isAgent: boolean }) => `${member.id}-${member.isAgent}`;

  const inThis: [ScreenId, string, number][] = [
    ["sessions", t("Discussion rooms", "اجتماعات العمل"), detail.contents.rooms],
    ["tasks", t("Work items", "بنود العمل"), detail.contents.workItems],
    ["requests", t("Requests", "الطلبات"), detail.contents.requests],
    ["routines", t("Scheduled work items", "بنود العمل المجدولة"), detail.contents.schedules],
    ["artifacts", t("Artifacts", "المخرجات"), detail.contents.artifacts],
    ["files", t("Files", "الملفات"), detail.contents.files],
  ];

  const toggleIn = (list: string[], code: string) =>
    list.includes(code) ? list.filter((one) => one !== code) : [...list, code];

  const save = () =>
    run(async () => {
      orThrow(
        await updateProjectPolicy({
          key: detail.key,
          sensitivity,
          status,
          requireReviewerNotAuthor: reviewer,
          allowedConnectors,
          allowedAgents,
          approvalRules: rules,
        }),
      );
      setEditing(false);
      return t("Policy saved.", "تم حفظ السياسة.");
    });

  const saveName = () =>
    run(async () => {
      orThrow(await renameProject({ key: detail.key, nameEn, nameAr }));
      return t("Project renamed.", "تمت إعادة تسمية المشروع.");
    });

  const addMember = () =>
    run(async () => {
      if (!addCode) return null;
      // `UC-21.3-01` and `-02`: a person is named by id, an agent by its code.
      const isAgent = addCode.startsWith("agent:");
      const principal = isAgent ? addCode.slice("agent:".length) : addCode;
      orThrow(await addProjectMember({ key: detail.key, principal, isAgent, projectRole: "Member" }));
      setAddCode("");
      return t("Member added.", "تمت إضافة العضو.");
    });

  const remove = (member: { id: string; isAgent: boolean }) =>
    run(async () => {
      const confirmed = warned === memberKey(member);
      const outcome = orThrow(
        await removeProjectMember({ key: detail.key, principal: member.id, isAgent: member.isAgent, confirmed }),
      );
      // `UC-21.3-05`: the open work they still hold is shown before anything is removed.
      setWarned(outcome.removed ? null : memberKey(member));
      return outcome.removed
        ? t("Member removed.", "تمت إزالة العضو.")
        : t(
            `They still hold ${outcome.openWorkItems.join(", ")}. Remove anyway?`,
            `ما زال لديهم ${outcome.openWorkItems.join("، ")}. هل تُزال على أي حال؟`,
          );
    });

  const confirmDelete = () =>
    act({
      title: t("Delete project", "حذف المشروع"),
      desc: t(
        "A project can only be deleted once its rooms, work items, requests, artifacts, files, schedules and knowledge collections are gone, and no request type still names it as a default.",
        "لا يمكن حذف المشروع إلا بعد إزالة اجتماعاته وبنود عمله وطلباته ومخرجاته وملفاته وجدولته ومجموعات معرفته، وألا يُسمّيه أي نوع طلب كافتراضي.",
      ),
      danger: true,
      confirm: t("Delete", "حذف"),
      onDone: () =>
        run(async () => {
          orThrow(await deleteProject({ key: detail.key }));
          onBack();
          return t("Project deleted.", "حُذف المشروع.");
        }),
    });

  /** Where a recorded decision came from, and so where clicking it goes. */
  const openDecision = (sourceType: string, key: string) => {
    if (sourceType === "Approval") go("inbox", { sel: key });
    else go("session", { key });
  };

  return (
    <div className="awp-page">
      <PageHead
        crumb={<Lnk onClick={onBack}>{t("Projects", "المشاريع")}</Lnk>}
        title={
          editing ? (
            <div className="awp-row" style={{ gap: 8 }}>
              <input
                className="awp-input"
                style={{ fontSize: 20, fontWeight: 600, width: 220 }}
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
                aria-label={t("Name (English)", "الاسم (إنجليزي)")}
              />
              <input
                className="awp-input"
                dir="rtl"
                style={{ fontSize: 20, fontWeight: 600, width: 220 }}
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                aria-label={t("Name (Arabic)", "الاسم (عربي)")}
              />
              <Btn
                type="secondary"
                label={t("Save name", "حفظ الاسم")}
                disabled={pending || !nameEn.trim() || !nameAr.trim()}
                onClick={saveName}
              />
            </div>
          ) : (
            t(project.n, project.nAr)
          )
        }
        sub={<span className="awp-mono">{detail.key}</span>}
      >
        <StTag s={project.st} />
        {/* `UC-21.2-07`: a member who may not change the project is not offered Edit. */}
        {mayWrite && (
          <Btn
            type="secondary"
            label={editing ? t("Cancel", "إلغاء") : t("Edit project", "تعديل المشروع")}
            onClick={() => setEditing(!editing)}
          />
        )}
        <Btn label={t("Open work items", "فتح بنود العمل")} onClick={() => go("tasks")} />
        {mayWrite && (
          <Btn type="danger" label={t("Delete project", "حذف المشروع")} disabled={pending} onClick={confirmDelete} />
        )}
      </PageHead>
      <KpiRow
        items={[
          { label: t("Work items", "بنود العمل"), value: detail.contents.workItems },
          { label: t("Progress", "التقدم"), value: `${project.prog}%` },
          { label: t("Discussion rooms", "اجتماعات العمل"), value: detail.contents.rooms },
          { label: t("Requests", "الطلبات"), value: detail.contents.requests },
        ]}
      />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="awp-two">
        <Card
          title={t("Policies", "السياسات")}
          actions={editing ? <Btn label={t("Save policy", "حفظ السياسة")} disabled={pending} onClick={save} /> : undefined}
        >
          {editing ? (
            <>
              <Field label={t("Sensitivity", "التصنيف")}>
                <PopSelect className="awp-input" value={sensitivity} onChange={(event) => setSensitivity(event.target.value)}>
                  {SENSITIVITIES.map(([id, en, ar]) => (
                    <option key={id} value={id}>
                      {t(en, ar)}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <Field label={t("Status", "الحالة")}>
                <PopSelect className="awp-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUSES.map(([id, en, ar]) => (
                    <option key={id} value={id}>
                      {t(en, ar)}
                    </option>
                  ))}
                </PopSelect>
              </Field>
              <div className="awp-row" style={{ gap: 10, margin: "10px 0" }}>
                <Toggle on={reviewer} onChange={setReviewer} />
                <span>{t("Reviewer ≠ author on every item", "المراجع ≠ المؤلف لكل بند")}</span>
              </div>
              <Field
                label={t("Allowed connectors", "التكاملات المسموحة")}
                hint={t("Nothing selected means every registered connector.", "عدم الاختيار يعني كل التكاملات المسجلة.")}
              >
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {connectors.map((connector) => (
                    <label key={connector.code} className="awp-row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={allowedConnectors.includes(connector.code)}
                        onChange={() => setAllowedConnectors(toggleIn(allowedConnectors, connector.code))}
                      />
                      <span className="awp-mono">{connector.code}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field
                label={t("Allowed agents", "الوكلاء المسموحون")}
                hint={t("Nothing selected means every agent the trust level allows.", "عدم الاختيار يعني كل وكيل يسمح به مستوى الثقة.")}
              >
                <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {agents.map((agent) => (
                    <label key={agent.code} className="awp-row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={allowedAgents.includes(agent.code)}
                        onChange={() => setAllowedAgents(toggleIn(allowedAgents, agent.code))}
                      />
                      <span>{t(agent.nameEn, agent.nameAr)}</span>
                    </label>
                  ))}
                </div>
              </Field>
              {/* `UC-21.2-03`: an action named here needs a human inside this project. */}
              <Field label={t("Human approval for", "اعتماد بشري لـ")}>
                {rules.map((rule) => (
                  <div key={rule.ref} className="awp-row" style={{ gap: 8, padding: "4px 0" }}>
                    <span className="awp-mono" style={{ flex: 1 }}>
                      {rule.ref}
                    </span>
                    <span className="awp-small awp-muted">{rule.minimumTier}</span>
                    <Lnk danger onClick={() => setRules(rules.filter((one) => one.ref !== rule.ref))}>
                      {t("Remove", "إزالة")}
                    </Lnk>
                  </div>
                ))}
                <div className="awp-row" style={{ gap: 8, marginTop: 6 }}>
                  <input
                    className="awp-input"
                    value={newRuleRef}
                    onChange={(event) => setNewRuleRef(event.target.value)}
                    placeholder={t("e.g. email.send_external", "مثال: email.send_external")}
                  />
                  <PopSelect className="awp-input" style={{ maxWidth: 90 }} value={newRuleTier} onChange={(event) => setNewRuleTier(event.target.value)}>
                    {["T1", "T2", "T3"].map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </PopSelect>
                  <Btn
                    type="secondary"
                    label={t("Add rule", "إضافة قاعدة")}
                    disabled={!newRuleRef.trim() || rules.some((rule) => rule.ref === newRuleRef.trim())}
                    onClick={() => {
                      setRules([...rules, { ref: newRuleRef.trim(), minimumTier: newRuleTier }]);
                      setNewRuleRef("");
                    }}
                  />
                </div>
              </Field>
              <p className="awp-small awp-muted" style={{ margin: 0 }} role="note">
                {t("Project policies can only raise tiers.", "سياسات المشروع ترفع المستويات فقط.")}
              </p>
            </>
          ) : (
            <dl className="awp-kv" style={{ margin: 0 }}>
              <dt>{t("Sensitivity", "التصنيف")}</dt>
              <dd>
                <StTag s={detail.sensitivity} dot={false} />
              </dd>
              <dt>{t("Required reviews", "المراجعات المطلوبة")}</dt>
              <dd>
                {detail.requireReviewerNotAuthor
                  ? t("Reviewer ≠ author on every item", "المراجع ≠ المؤلف لكل بند")
                  : t("None", "لا يوجد")}
              </dd>
              <dt>{t("Human approval for", "اعتماد بشري لـ")}</dt>
              <dd className="awp-mono">
                {detail.approvalRules.length
                  ? detail.approvalRules.map((rule) => `${rule.ref} (${rule.minimumTier})`).join(" · ")
                  : t("Nothing beyond the tool tiers", "لا شيء خارج مستويات الأدوات")}
              </dd>
              <dt>{t("Allowed agents", "الوكلاء المسموحون")}</dt>
              <dd>
                {detail.allowedAgents.length
                  ? detail.allowedAgents
                      .map((code) => {
                        const agent = agents.find((one) => one.code === code);
                        return agent ? t(agent.nameEn, agent.nameAr) : code;
                      })
                      .join(", ")
                  : t("Every agent the trust level allows", "كل وكيل يسمح به مستوى الثقة")}
              </dd>
              <dt>{t("Allowed connectors", "التكاملات المسموحة")}</dt>
              <dd className="awp-mono">
                {detail.allowedConnectors.length
                  ? detail.allowedConnectors.join(" · ")
                  : t("All registered connectors", "كل التكاملات المسجلة")}
              </dd>
            </dl>
          )}
        </Card>
        <Card title={t("Members", "الأعضاء")}>
          {detail.members.map((member) => (
            <div
              key={`${member.id}-${member.isAgent}`}
              className="awp-row"
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)", gap: 10 }}
            >
              <Who id={member.id} s={30} />
              <span style={{ flex: 1 }}>{aName(member.id)}</span>
              <span className="awp-small awp-muted">
                {member.role === "Owner" ? t("Owner", "المستخدم") : member.isAgent ? t("Agent", "وكيل") : t("Member", "عضو")}
              </span>
              {mayWrite && (
                <Lnk danger onClick={() => remove(member)}>
                  {warned === memberKey(member) ? t("Remove anyway", "إزالة على أي حال") : t("Remove", "إزالة")}
                </Lnk>
              )}
            </div>
          ))}
          {mayWrite && (
            <div className="awp-row" style={{ gap: 8, marginTop: 12 }}>
              <PopSelect className="awp-input" value={addCode} onChange={(event) => setAddCode(event.target.value)}>
                <option value="">{t("Add a person or an agent…", "أضف شخصاً أو وكيلاً…")}</option>
                <optgroup label={t("Agents", "الوكلاء")}>
                  {agents
                    .filter((agent) => !detail.members.some((member) => member.isAgent && member.id === agent.code))
                    .map((agent) => (
                      <option key={agent.code} value={`agent:${agent.code}`}>
                        {t(agent.nameEn, agent.nameAr)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t("People", "الأشخاص")}>
                  {people
                    .filter((person) => !detail.members.some((member) => !member.isAgent && member.id === person.id))
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {nm(person)}
                      </option>
                    ))}
                </optgroup>
              </PopSelect>
              <Btn label={t("Add member", "إضافة عضو")} disabled={pending || !addCode} onClick={addMember} />
            </div>
          )}
        </Card>
        <Card title={t("In this project", "في هذا المشروع")}>
          {inThis.map(([screen, label, count]) => (
            <div key={screen} className="awp-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)" }}>
              <span style={{ flex: 1 }}>
                {/* `UC-21.2-02`: each link opens that list filtered to this project. */}
                <Lnk onClick={() => go(screen, { project: detail.key })}>{label}</Lnk>
              </span>
              <b>{count}</b>
            </div>
          ))}
        </Card>
        <Card title={t("Recent decisions", "القرارات الأخيرة")}>
          {detail.decisions.length ? (
            detail.decisions.map((decision) => (
              <div key={decision.titleEn} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-divider)" }}>
                {/* `UC-21.1-03`: the decision opens its source — the approval or the room
                    message it was recorded from. */}
                {decision.sourceKey ? (
                  <Lnk onClick={() => openDecision(decision.sourceType, decision.sourceKey as string)}>
                    {t(decision.titleEn, decision.titleAr)}
                  </Lnk>
                ) : (
                  <div>{t(decision.titleEn, decision.titleAr)}</div>
                )}
                <div className="awp-small awp-muted">
                  {aName(decision.decidedBy)} · {formatDay(lang, new Date(decision.decidedAt))}
                </div>
              </div>
            ))
          ) : (
            <p className="awp-muted awp-small" style={{ margin: 0 }}>
              {t("No decisions recorded yet.", "لم تُسجَّل قرارات بعد.")}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
