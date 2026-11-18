"use client";

import { useEffect, useState, useTransition } from "react";

import { useAgents, usePeople, useProjects } from "@/components/shared/directory";
import type { ModalProps } from "@/components/shared/modal-host";
import { Btn, Toggle } from "@/components/ui/button";
import { Chips, Seg } from "@/components/ui/tabs";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { PopDate, PopSelect } from "@/components/ui/pop-select";
import { saveSchedule } from "@/features/schedules/actions";
import { loadSchedule, loadScheduleOptions, type ScheduleOptions } from "@/features/schedules/directory";
import { orThrow } from "@/lib/outcome";
import { useAwp } from "@/hooks/use-awp";

/**
 * S-31: creating a scheduled work item (`UC-31.2-01` … `-07`), and editing one (`UC-31.1-04`).
 *
 * What is refused is refused on the server, and this shows the reason rather than deciding
 * it. The one thing decided here is when Create becomes available, which is when the form
 * says enough for the server to have something to answer.
 */

const REPEATS: [string, string, string][] = [
  ["Once", "Once", "مرة"],
  ["Daily", "Daily", "يومي"],
  ["Weekly", "Weekly", "أسبوعي"],
  ["Monthly", "Monthly", "شهري"],
  ["OnEvent", "On event", "عند حدث"],
];

/** The events a schedule may fire on, as the platform publishes them. */
const EVENTS = ["work_item.created", "request.submitted", "connector.webhook"];

const REQUEST_PREFIX = "request:";

/**
 * The dialog that creates a scheduled work item or, given `id`, edits it after loading it with
 * `loadSchedule`. The "Creates" choice is a work item type or a request type (prefixed
 * `request:`), and the audience list follows the audience type. Saves through `saveSchedule`
 * in the Asia/Dubai time zone, with the title and instructions used for both languages; an
 * edited schedule keeps its two languages' values for a field the person did not change.
 */
export function ScheduleModal({ id, onClose }: ModalProps) {
  const { t, nm, why } = useAwp();
  const projects = useProjects();
  const people = usePeople();
  const agents = useAgents();

  const [options, setOptions] = useState<ScheduleOptions>({ requestTypes: [], groups: [] });
  const [title, setTitle] = useState("");
  const [projectKey, setProjectKey] = useState(projects[0]?.k ?? "");
  const [creates, setCreates] = useState("Task");
  const [audienceType, setAudienceType] = useState("Agent");
  const [audience, setAudience] = useState("");
  const [repeats, setRepeats] = useState("Daily");
  const [eventName, setEventName] = useState(EVENTS[0]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [skip, setSkip] = useState(true);
  const [instructions, setInstructions] = useState("");
  // `UC-31.1-04`: the edited schedule's English and Arabic values, so saving it without touching
  // a field keeps both rather than writing the reader's language over the other one.
  const [stored, setStored] = useState<{ title: [string, string]; instructions: [string, string] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void loadScheduleOptions().then(setOptions);
  }, []);

  // `UC-31.1-04`: opened on a schedule, the form starts as that schedule rather than blank,
  // and saving changes it instead of creating a second one beside it.
  useEffect(() => {
    if (!id) return;
    void loadSchedule(id).then((schedule) => {
      if (!schedule) return;
      const storedTitle: [string, string] = [schedule.titleEn, schedule.titleAr];
      const storedInstructions: [string, string] = [schedule.instructionsEn ?? "", schedule.instructionsAr ?? ""];
      setStored({ title: storedTitle, instructions: storedInstructions });
      setTitle(t(...storedTitle));
      setProjectKey(schedule.projectKey);
      setCreates(
        schedule.createsRequestTypeCode
          ? REQUEST_PREFIX + schedule.createsRequestTypeCode
          : (schedule.createsWorkItemType ?? "Task"),
      );
      setAudienceType(schedule.audienceType);
      setAudience(schedule.audience);
      setRepeats(schedule.repeats);
      if (schedule.eventName) setEventName(schedule.eventName);
      setStartDate(schedule.startDate);
      setTimeOfDay(schedule.timeOfDay);
      setSkip(schedule.skipHolidaysAndWeekends);
      setInstructions(t(...storedInstructions));
    });
    // `t` follows the language; the form is filled once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Both languages' values for a field: the stored pair if it shows unchanged, else the one value typed. */
  const bothLanguages = (shown: string, pair: [string, string] | undefined): [string, string] =>
    pair && shown === t(...pair) ? pair : [shown, shown];

  const audienceChoices: [string, string][] =
    audienceType === "Agent"
      ? agents.map((agent) => [agent.id, nm(agent)])
      : audienceType === "Group"
        ? options.groups.map((group) => [group.id, t(group.nameEn, group.nameAr)])
        : people.map((person) => [person.id, nm(person)]);

  // `UC-31.2-06`: an agent is given nothing but its instructions, so it cannot be scheduled
  // without them. Said here as well as refused on the server, so the person sees it first.
  const needsInstructions = audienceType === "Agent" && instructions.trim() === "";
  const ready = title.trim() !== "" && projectKey !== "" && audience !== "" && !needsInstructions;

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const asRequest = creates.startsWith(REQUEST_PREFIX);
        const [titleEn, titleAr] = bothLanguages(title, stored?.title);
        const [instructionsEn, instructionsAr] = bothLanguages(instructions, stored?.instructions);
        orThrow(await saveSchedule({
          id,
          titleEn,
          titleAr,
          projectKey,
          createsWorkItemType: asRequest ? undefined : creates,
          createsRequestTypeCode: asRequest ? creates.slice(REQUEST_PREFIX.length) : undefined,
          audienceType,
          audience,
          repeats,
          eventName: repeats === "OnEvent" ? eventName : undefined,
          startDate,
          timeOfDay,
          timeZone: "Asia/Dubai",
          skipHolidaysAndWeekends: skip,
          instructionsEn: instructionsEn || undefined,
          instructionsAr: instructionsAr || undefined,
        }));
        onClose();
      } catch (problem) {
        setError(why(problem));
      }
    });

  return (
    <Modal
      w={640}
      title={id ? t("Edit Scheduled Work Item", "تعديل بند العمل المجدول") : t("New Scheduled Work Item", "بند عمل مجدول جديد")}
      onClose={onClose}
      footer={
        <>
          <Btn type="secondary" label={t("Cancel", "إلغاء")} onClick={onClose} />
          <Btn
            label={id ? t("Save schedule", "حفظ الجدول") : t("Create schedule", "إنشاء الجدول")}
            disabled={pending || !ready}
            onClick={submit}
          />
        </>
      }
    >
      <Field label={t("Title", "العنوان")}>
        <input
          className="awp-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("e.g. Monthly vendor review", "مثال: مراجعة الموردين الشهرية")}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Project", "المشروع")}>
          <PopSelect className="awp-input" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            {projects.map((project) => (
              <option key={project.k} value={project.k}>
                {project.k} — {t(project.n, project.nAr)}
              </option>
            ))}
          </PopSelect>
        </Field>
        {/* `UC-31.2-02`: a request type here makes each firing raise a request, not a work item. */}
        <Field label={t("Creates", "ينشئ")}>
          <PopSelect className="awp-input" value={creates} onChange={(event) => setCreates(event.target.value)}>
            <option value="Task">{t("Task", "مهمة")}</option>
            <option value="Bug">{t("Bug", "خلل")}</option>
            {options.requestTypes.map((type) => (
              <option key={type.code} value={REQUEST_PREFIX + type.code}>
                {t("Request: ", "طلب: ")}
                {t(type.nameEn, type.nameAr)}
              </option>
            ))}
          </PopSelect>
        </Field>
      </div>
      <Field group label={t("Audience", "الجمهور")}>
        <Seg
          value={audienceType}
          onChange={(value) => {
            setAudienceType(value);
            setAudience("");
          }}
          items={[
            { id: "Agent", label: t("Agent", "وكيل") },
            { id: "Person", label: t("Human", "شخص") },
            { id: "Group", label: t("Group", "مجموعة") },
          ]}
        />
      </Field>
      <Field label={t("Assigned to", "مُسند إلى")}>
        <PopSelect className="awp-input" value={audience} onChange={(event) => setAudience(event.target.value)}>
          <option value="">{t("Choose…", "اختر…")}</option>
          {audienceChoices.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </PopSelect>
      </Field>
      <Field group label={t("Repeats", "التكرار")}>
        <Chips value={repeats} onChange={setRepeats} items={REPEATS.map(([id, en, ar]) => ({ id, label: t(en, ar) }))} />
      </Field>
      {repeats === "OnEvent" ? (
        <Field label={t("Event", "الحدث")}>
          <PopSelect className="awp-input" value={eventName} onChange={(event) => setEventName(event.target.value)}>
            {EVENTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </PopSelect>
        </Field>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label={t("Start date", "تاريخ البدء")}>
            <PopDate className="awp-input" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={t("Time", "الوقت")}>
            <input type="time" className="awp-input" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} />
          </Field>
          <Field label={t("Time zone", "المنطقة الزمنية")}>
            <PopSelect className="awp-input" defaultValue="Asia/Dubai">
              <option>Asia/Dubai</option>
            </PopSelect>
          </Field>
        </div>
      )}
      <div className="awp-row" style={{ gap: 10 }}>
        <Toggle on={skip} onChange={setSkip} />
        <span>{t("Skip UAE public holidays and weekends", "تخطي العطل الرسمية وعطلات نهاية الأسبوع")}</span>
      </div>
      <Field label={t("Instructions", "التعليمات")}>
        <textarea
          className="awp-input"
          style={{ height: 80, padding: 12 }}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t("What should be done each time?", "ما الذي يجب فعله في كل مرة؟")}
        />
      </Field>
      {needsInstructions && (
        <p className="awp-small awp-muted" style={{ margin: 0 }} role="status">
          {t("Agents need instructions.", "الوكلاء بحاجة إلى تعليمات.")}
        </p>
      )}
      {error && (
        <p className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
