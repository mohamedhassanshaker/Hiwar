"use client";

import { useState } from "react";

import type { PersonRow } from "@/features/organisation/types";
import { Btn } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { approveRegistration, declineRegistration } from "@/features/organisation/actions";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { orThrow } from "@/lib/outcome";
import type { Choice, UnitChoice } from "./people-modals";

/**
 * D393: a registration waiting for approval. Approve makes the person Active in a role and emails
 * them; Decline removes the registration. The role and organization can be changed only by someone
 * who also holds `permissions:write` (`mayChooseRole`); otherwise the person joins as a Member in the
 * organization they registered in.
 */
export function RegistrationModal({
  person,
  units,
  roles,
  mayChooseRole,
  onClose,
}: {
  person: PersonRow;
  units: UnitChoice[];
  roles: Choice[];
  mayChooseRole: boolean;
  onClose: () => void;
}) {
  const { t, nm } = useAwp();
  const [run, pending] = useAction();
  const [roleCode, setRoleCode] = useState(roles.find((role) => role.code === "Member")?.code ?? roles[0]?.code ?? "");
  const [unitId, setUnitId] = useState(person.unitId ?? "");

  const decide = (act: () => Promise<string>) => run(act).then((done) => done && onClose());

  return (
    <Modal
      title={t("New registration", "طلب تسجيل جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            type="danger"
            label={t("Decline", "رفض")}
            disabled={pending}
            onClick={() =>
              decide(async () => {
                orThrow(await declineRegistration({ personId: person.id }));
                return t(`${nm(person)}'s registration was declined.`, `تم رفض طلب تسجيل ${nm(person)}.`);
              })
            }
          />
          <Btn
            label={t("Approve", "اعتماد")}
            disabled={pending}
            onClick={() =>
              decide(async () => {
                orThrow(await approveRegistration({ personId: person.id, ...(mayChooseRole ? { roleCode, orgUnitId: unitId || null } : {}) }));
                return t(`${nm(person)} was approved and emailed.`, `تم اعتماد ${nm(person)} وإبلاغه بالبريد.`);
              })
            }
          />
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div className="awp-row" style={{ gap: 12 }}>
          <Who id={person.id} s={44} />
          <div>
            <div style={{ fontWeight: 500 }}>{nm(person)}</div>
            <div className="awp-small awp-muted">{person.email}</div>
            <Tg tone="warning" dot label={t("Pending approval", "بانتظار الاعتماد")} />
          </div>
        </div>
        <div className="awp-small awp-muted">{t(`Registered with ${person.signInMethod}.`, `سجّل عبر ${person.signInMethod}.`)}</div>
        {!mayChooseRole && person.unitId && (
          <Field label={t("Organization", "الجهة")}>
            <div>{person.unit}</div>
          </Field>
        )}
        {mayChooseRole ? (
          <>
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
                {!person.unitId && <option value="">{t("None", "بدون")}</option>}
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {t(unit.nameEn, unit.nameAr)}
                  </option>
                ))}
              </PopSelect>
            </Field>
          </>
        ) : (
          <p className="awp-small awp-muted" style={{ margin: 0 }}>
            {t("They join as a Member. A person who manages permissions can change that afterwards.", "ينضم كعضو. ويمكن لمن يدير الصلاحيات تغيير ذلك لاحقاً.")}
          </p>
        )}
      </div>
    </Modal>
  );
}
