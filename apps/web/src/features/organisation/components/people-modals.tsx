"use client";

import { useState, useTransition } from "react";

import type { PersonRow } from "@/features/organisation/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { changePersonPlacement, invitePeople, resendInvitation, suspendPerson } from "@/features/organisation/actions";
import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";
import { EmiratesIdField, useEmiratesId } from "./emirates-id-field";
import { PersonDelete } from "./person-delete";

/** What a picker needs to offer an org unit or a role. */
export type Choice = { code: string; nameEn: string; nameAr: string };

export type UnitChoice = { id: string; nameEn: string; nameAr: string; code: string };

/** Each address and what became of it (`UC-41.1-02`), and why no link was emailed (D248). */
type InviteOutcome = { email: string; invited: boolean; reason?: string; noEmail?: string };

/** Why an invitation email will not go, in the console's language. */
const NO_EMAIL_AR: Record<string, string> = {
  "the platform mail server is not configured": "خادم بريد المنصة غير مُعدّ",
  "the invitation email is switched off": "بريد الدعوة متوقف",
};

/**
 * `UC-41.1-01`: invite people into a role.
 *
 * Addresses are entered as free text, one per line or comma-separated, because they are
 * normally pasted from somewhere else. `UC-41.1-02`: the server answers per address, and
 * this shows that answer rather than a single success or failure — one typo in a pasted
 * list must not cost the other invitations.
 */
export function InvitePeopleModal({
  units,
  roles,
  onClose,
}: {
  units: UnitChoice[];
  roles: Choice[];
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const [addresses, setAddresses] = useState("");
  const [roleCode, setRoleCode] = useState(roles.find((role) => role.code === "Member")?.code ?? roles[0]?.code ?? "");
  const [unitId, setUnitId] = useState("");
  const [emiratesId, setEmiratesId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<InviteOutcome[] | null>(null);
  const [pending, start] = useTransition();

  const emails = addresses
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  // D387: an Emirates ID belongs to one person, so it is offered only when one address is typed.
  const oneAddress = emails.length === 1;

  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await invitePeople({ emails, roleCode, orgUnitId: unitId || null, ...(oneAddress && emiratesId.trim() ? { emiratesId } : {}) });
      if (result.ok) setOutcomes(result.outcomes);
      else setProblem(why(result));
    });

  const invited = outcomes?.filter((outcome) => outcome.invited) ?? [];
  const rejected = outcomes?.filter((outcome) => !outcome.invited) ?? [];

  return (
    <Modal
      title={t("Invite people", "دعوة أشخاص")}
      onClose={onClose}
      dirty={Boolean(addresses) && !outcomes}
      footer={
        outcomes ? (
          <Btn label={t("Done", "تم")} onClick={onClose} />
        ) : (
          <>
            <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
            <Btn
              label={t("Send invites", "إرسال الدعوات")}
              disabled={emails.length === 0 || !roleCode || pending}
              onClick={submit}
            />
          </>
        )
      }
    >
      {outcomes ? (
        <div style={{ display: "grid", gap: 12 }}>
          {invited.length > 0 && (
            <div>
              <p role="status" style={{ margin: "0 0 6px", color: "var(--feedback-success-text)" }}>
                {t(`${invited.length} invited.`, `تمت دعوة ${invited.length}.`)}
              </p>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {invited.map((outcome) => (
                  <li key={outcome.email} className="awp-small">
                    <span className="awp-mono">{outcome.email}</span> —{" "}
                    {outcome.noEmail
                      ? t(`no email was sent: ${outcome.noEmail}.`, `لم يُرسل بريد: ${NO_EMAIL_AR[outcome.noEmail] ?? outcome.noEmail}.`)
                      : t("emailed a link to accept.", "أُرسل إليه رابط القبول.")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rejected.length > 0 && (
            <div>
              <div className="awp-small awp-muted" style={{ marginBottom: 6 }}>
                {t("Not invited", "لم تتم الدعوة")}
              </div>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {rejected.map((outcome) => (
                  <li key={outcome.email} className="awp-small">
                    <span className="awp-mono">{outcome.email}</span> — {outcome.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <Field
            label={t("Email addresses", "عناوين البريد")}
            hint={t("One per line, or separated by commas.", "واحد في كل سطر، أو مفصولة بفواصل.")}
          >
            <textarea
              className="awp-input"
              rows={5}
              value={addresses}
              onChange={(event) => setAddresses(event.target.value)}
            />
          </Field>
          <Field
            label={t("Emirates ID (only when inviting one person)", "رقم الهوية الإماراتية (عند دعوة شخص واحد فقط)")}
            hint={t("Optional. Signing in with UAE PASS finds the person by it.", "اختياري. يُعرَف الشخص به عند تسجيل الدخول بالهوية الرقمية.")}
          >
            <input
              className="awp-input"
              value={oneAddress ? emiratesId : ""}
              onChange={(event) => setEmiratesId(event.target.value)}
              disabled={!oneAddress}
              placeholder="784-1990-1234567-1"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
            />
          </Field>
          <Field label={t("Role", "الدور")}>
            <PopSelect className="awp-input" value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {t(role.nameEn, role.nameAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
          <Field label={t("Organization", "الجهة")}>
            <PopSelect className="awp-input" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              <option value="">{t("None yet", "بدون حالياً")}</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {t(unit.nameEn, unit.nameAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
          {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * `UC-41.1-03`: a person's org unit, role and the scope that role applies in.
 * `UC-41.1-04` suspends them from here, and `UC-41.1-05` is what comes back when that
 * would leave the platform with no Platform Owner.
 */
export function PersonModal({
  person,
  units,
  roles,
  onClose,
}: {
  person: PersonRow;
  units: UnitChoice[];
  roles: Choice[];
  onClose: () => void;
}) {
  const { t, nm, why } = useAwp();
  const { say } = useToast();
  const [roleCode, setRoleCode] = useState(person.roleCode);
  const [unitId, setUnitId] = useState(person.unitId ?? "");
  const [scopeType, setScopeType] = useState(person.scopeType);
  const [problem, setProblem] = useState<string | null>(null);
  const [stranded, setStranded] = useState<{ key: string; title: string }[] | null>(null);
  const [pending, start] = useTransition();
  const emiratesId = useEmiratesId(person.id);

  const save = () =>
    start(async () => {
      setProblem(null);
      const refused = await emiratesId.save();
      if (refused) return setProblem(refused);
      const result = await changePersonPlacement({
        personId: person.id,
        roleCode,
        orgUnitId: unitId || null,
        scopeType,
        // `UC-41.2-03`: a unit-scoped role applies in the unit the person sits in.
        scopeId: scopeType === "OrgUnit" ? unitId || null : null,
      });
      if (result.ok) {
        say(t(`${nm(person)} was moved.`, `نُقل ${nm(person)}.`));
        onClose();
      } else setProblem(why(result));
    });

  const suspend = () =>
    start(async () => {
      setProblem(null);
      const result = await suspendPerson({ personId: person.id });
      if (result.ok) setStranded(result.stranded);
      else setProblem(why(result));
    });

  // D248: a new link, for an invitation that expired or never arrived.
  const resend = () =>
    start(async () => {
      setProblem(null);
      const result = await resendInvitation({ personId: person.id });
      if (!result.ok) setProblem(why(result));
      else if (result.noEmail) setProblem(t(`No email was sent: ${result.noEmail}.`, `لم يُرسل بريد: ${NO_EMAIL_AR[result.noEmail] ?? result.noEmail}.`));
      else say(t(`A new invitation was emailed to ${person.email}.`, `أُرسلت دعوة جديدة إلى ${person.email}.`));
    });

  return (
    <Modal
      title={nm(person)}
      onClose={onClose}
      dirty={roleCode !== person.roleCode || unitId !== (person.unitId ?? "") || scopeType !== person.scopeType || emiratesId.changed}
      footer={
        stranded ? (
          <Btn label={t("Done", "تم")} onClick={onClose} />
        ) : (
          <>
            <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
            {person.status === "Invited" && (
              <Btn type="secondary" label={t("Resend invitation", "إعادة إرسال الدعوة")} disabled={pending} onClick={resend} />
            )}
            {person.status !== "Suspended" && (
              <Btn type="danger" label={t("Suspend", "تعليق")} disabled={pending} onClick={suspend} />
            )}
            <PersonDelete person={person} onDeleted={onClose} />{/* D381: Invited or Suspended only */}
            <Btn label={t("Save", "حفظ")} disabled={pending} onClick={save} />
          </>
        )
      }
    >
      {stranded ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p role="status" style={{ margin: 0 }}>
            {t("Suspended, and their sessions ended.", "تم التعليق وإنهاء جلساتهم.")}
          </p>
          <div className="awp-small awp-muted">
            {stranded.length
              ? t("Open work that now needs a new owner:", "عمل مفتوح يحتاج إلى مسؤول جديد:")
              : t("They had no open assigned work.", "لا يوجد عمل مفتوح مُسند إليهم.")}
          </div>
          {stranded.length > 0 && (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {stranded.map((item) => (
                <li key={item.key} className="awp-small">
                  <span className="awp-mono">{item.key}</span> — {item.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="awp-row" style={{ gap: 12 }}>
            <Who id={person.id} s={44} />
            <div>
              <div className="awp-small awp-muted">{person.email}</div>
              <Tg
                tone={person.status === "Active" ? "success" : person.status === "Invited" ? "brand" : "neutral"}
                dot
                label={person.status}
              />
            </div>
          </div>
          <Field label={t("Role", "الدور")}>
            <PopSelect className="awp-input" value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {t(role.nameEn, role.nameAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
          <Field label={t("Organization", "الجهة")}>
            <PopSelect className="awp-input" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              <option value="">{t("None", "بدون")}</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {t(unit.nameEn, unit.nameAr)}
                </option>
              ))}
            </PopSelect>
          </Field>
          <Field
            label={t("The role applies", "يسري الدور")}
            hint={t(
              "Scoping a role limits it to one place; the permissions apply nowhere else.",
              "تحديد النطاق يقصر الدور على مكان واحد ولا تسري صلاحياته خارجه.",
            )}
          >
            <PopSelect
              className="awp-input"
              value={scopeType}
              onChange={(event) => setScopeType(event.target.value as PersonRow["scopeType"])}
            >
              <option value="Organisation">{t("Across the organisation", "على مستوى الجهة")}</option>
              <option value="OrgUnit">{t("In their organization only", "في جهتهم فقط")}</option>
            </PopSelect>
          </Field>
          <EmiratesIdField id={emiratesId} />
          {problem && <p role="alert" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>{problem}</p>}
        </div>
      )}
    </Modal>
  );
}
