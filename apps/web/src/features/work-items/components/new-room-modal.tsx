"use client";

import { useEffect, useState, useTransition } from "react";

import { useAgents, useDirectory, useProjects, usePeople } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn } from "@/components/ui/button";
import { Chips } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopSelect } from "@/components/ui/pop-select";
import { Who } from "@/components/ui/avatar";
import { createRoom } from "@/features/rooms/actions";
import { allowedAgentsFor } from "@/features/rooms/directory";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";

/**
 * The New Discussion Room modal: project, title, type, turn-taking and status, and the people and
 * agents to bring in. Agents the chosen project does not allow are not offered, and a picked one
 * is dropped when the project changes. The person creating the room is always in it, as its Owner,
 * so they are shown first and cannot be taken out (D167, D345). Creating opens the new room; a
 * refusal shows in the modal.
 */
export function NewRoomModal({ onClose, go }: ModalProps) {
  const { t, nm, why } = useAwp();
  const projects = useProjects();
  const people = usePeople();
  const agents = useAgents();
  const { me } = useDirectory();
  const [type, setType] = useState("Chat");
  const [ppl, setPpl] = useState<string[]>([]);
  const [form, setForm] = useState({ projectKey: projects[0]?.k ?? "", title: "", status: "Active", turnTaking: "Autonomous" });
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tog = (id: string) => setPpl(ppl.includes(id) ? ppl.filter((x) => x !== id) : [...ppl, id]);

  // `UC-22.2-05`: an agent the project does not allow is not offered, so nobody picks one
  // and is refused afterwards. `null` is "every agent", which is a project with no list.
  useEffect(() => {
    if (!form.projectKey) return;
    void allowedAgentsFor(form.projectKey).then((codes) => {
      setAllowed(codes);
      if (codes !== null) setPpl((current) => current.filter((id) => !agents.some((agent) => agent.id === id) || codes.includes(id)));
    });
  }, [form.projectKey, agents]);

  const offered = [...people.filter((person) => person.id !== me.id), ...agents.filter((agent) => allowed === null || allowed.includes(agent.id))];
  const typeAr: Record<string, string> = { Chat: "محادثة", Review: "مراجعة", WarRoom: "غرفة طوارئ", Support: "دعم", Automation: "أتمتة" };
  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const key = orThrow(await createRoom({
          projectKey: form.projectKey,
          titleEn: form.title,
          titleAr: form.title,
          type,
          turnTaking: form.turnTaking,
          status: form.status,
          participants: ppl,
        }));
        onClose();
        go("session", { key });
      } catch (problem) {
        setError(why(problem));
      }
    });
  return (
    <Modal
      title={t("New Discussion Room", "اجتماع عمل جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          {/* `UC-22.2-03`: without a project there is nothing to create the room in. */}
          <Btn
            label={t("Create room", "إنشاء الاجتماع")}
            disabled={pending || !form.title.trim() || form.projectKey === ""}
            onClick={submit}
          />
        </>
      }
    >
      <Field label={t("Project", "المشروع")}>
        <PopSelect className="awp-input" value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })}>
          {projects.map((project) => (
            <option key={project.k} value={project.k}>
              {project.k} — {t(project.n, project.nAr)}
            </option>
          ))}
        </PopSelect>
      </Field>
      <Field label={t("Title", "العنوان")}>
        <input className="awp-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("e.g. Q1 budget planning", "مثال: تخطيط ميزانية الربع الأول")} />
      </Field>
      <Field group label={t("Type", "النوع")}>
        <Chips value={type} onChange={setType} items={["Chat", "Review", "WarRoom", "Support", "Automation"].map((k) => ({ id: k, label: t(k === "WarRoom" ? "War-room" : k, typeAr[k]) }))} />
      </Field>
      <Field group label={t("Participants", "المشاركون")}>
        <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="awp-chip on" style={{ paddingInlineStart: 4 }}>
            <Who id={me.id} s={24} />
            {nm(me)} · {t("Owner", "المستخدم")}
          </span>
          {offered.map((p) => (
            <button key={p.id} className={"awp-chip" + (ppl.includes(p.id) ? " on" : "")} onClick={() => tog(p.id)} style={{ paddingInlineStart: 4 }}>
              <Who id={p.id} s={24} />
              {nm(p)}
            </button>
          ))}
        </div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Status", "الحالة")}>
          <PopSelect className="awp-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="Active">{t("Active", "نشط")}</option>
            <option value="Paused">{t("Paused", "متوقف")}</option>
          </PopSelect>
        </Field>
        <Field label={t("Turn-taking", "تبادل الأدوار")}>
          <PopSelect className="awp-input" value={form.turnTaking} onChange={(e) => setForm({ ...form, turnTaking: e.target.value })}>
            <option value="Autonomous">{t("Autonomous", "مستقل")}</option>
            <option value="MentionOnly">{t("Mention only", "عند الإشارة فقط")}</option>
          </PopSelect>
        </Field>
      </div>
      {form.status === "Paused" && (
        <p className="awp-small awp-muted" style={{ margin: 0 }} role="status">
          {t("A paused room runs no agent until it is activated.", "لا يعمل أي وكيل في اجتماع متوقف حتى يُفعَّل.")}
        </p>
      )}
      {error && <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">{error}</p>}
    </Modal>
  );
}
