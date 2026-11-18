"use client";

import { useEffect, useRef, useState } from "react";

import { useProjects } from "@/components/shared/directory";
import { Ic } from "@/components/ui/icon";
import { makeTask } from "@/features/comments/actions";
import type { Comment, Mentionable } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { mentionNames } from "./composer";

/**
 * "Make it a task" (handoff v2 section 5.2).
 *
 * The form opens inside the conversation rather than over it, so the comment it is about
 * is still readable while the title is being edited. It is prefilled from the comment's
 * first sentence, assigned to whoever was named, and raised in the project the person
 * picks — a work item has to belong to one, which the prototype did not have to decide.
 */

/** Whether a comment reads as a request rather than an observation. */
export const soundsLikeARequest = (text: string) =>
  /\b(can you|could you|please|look at|check|review|follow up|chase|pick up|fix|update me)\b|يمكنك|يرجى|راجع|تابع/i.test(text);

/** `YYYY-MM-DD` for a day offset from today, which is what the chips offer. */
function dayFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The inline form that raises a work item from a comment: title from the comment's first
 * sentence, assignee from the first person it names, High priority when it reads as a request,
 * due tomorrow, and the first of the person's projects. Escape closes it; a failed create is
 * shown in the form.
 */
export function MakeTaskForm({
  comment,
  people,
  onClose,
  onCreated,
}: {
  comment: Comment;
  people: Mentionable[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang, nm } = useAwp();
  const locale = lang === "ar" ? "ar-AE" : "en-GB";
  const projects = useProjects();
  const named = people.find((person) => comment.mentions.includes(person.id));

  // The first sentence, with the mention stripped: "@Mariam can you look at the 6 stuck
  // tasks?" is a task called "Can you look at the 6 stuck tasks", not the whole thread.
  const withoutMentions = mentionNames(people).reduce(
    (text, { name }) => text.replaceAll(`@${name}`, ""),
    comment.bodyText,
  );
  const firstSentence = (withoutMentions.trim().split(/(?<=[.?!؟])\s/)[0] ?? "").replace(/[?؟]$/, "").trim();

  const [title, setTitle] = useState(
    firstSentence ? (firstSentence[0].toUpperCase() + firstSentence.slice(1)).slice(0, 200) : t("Follow up", "متابعة"),
  );
  const [assignee, setAssignee] = useState(named?.id ?? "");
  const [priority, setPriority] = useState(soundsLikeARequest(comment.bodyText) ? "High" : "Medium");
  const [due, setDue] = useState(dayFromNow(1));
  const [project, setProject] = useState(projects[0]?.k ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleField.current?.focus({ preventScroll: true });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape closes this form, not the conversation it is inside.
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [onClose]);

  const days: [string, string, string][] = [
    ["today", t("Today", "اليوم"), dayFromNow(0)],
    ["tomorrow", t("Tomorrow", "غداً"), dayFromNow(1)],
    // The coming Friday, or the one after when today is already Friday.
    ["week", t("This week", "هذا الأسبوع"), dayFromNow(((5 - new Date().getDay() + 7) % 7) || 7)],
  ];

  const create = async () => {
    if (!title.trim() || !project) return;
    setBusy(true);
    setProblem(null);
    try {
      await makeTask({ commentId: comment.id, title: title.trim(), assignee: assignee || undefined, priority, dueAt: due, projectKey: project });
      onCreated();
    } catch {
      setProblem(t("The task could not be created.", "تعذّر إنشاء المهمة."));
      setBusy(false);
    }
  };

  return (
    <div className="qt-inline" role="group" aria-label={t("Make it a task", "حوّله إلى مهمة")}>
      <label className="qt-f">
        <span className="qt-l">{t("Task", "المهمة")}</span>
        <input
          ref={titleField}
          className="qt-in"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
      </label>
      <div className="qt-2">
        <label className="qt-f">
          <span className="qt-l">{t("Project", "المشروع")}</span>
          <select className="qt-in" value={project} onChange={(event) => setProject(event.target.value)}>
            {projects.map((one) => (
              <option key={one.k} value={one.k}>
                {one.k} — {t(one.n, one.nAr)}
              </option>
            ))}
          </select>
        </label>
        <label className="qt-f">
          <span className="qt-l">{t("Assigned to", "مُسندة إلى")}</span>
          {/* Native, as handoff v2 leaves the quick-task form: it is one short list inside
              a form that is itself inside a popover, and a third stacked layer is worse. */}
          <select className="qt-in" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">{t("Nobody yet", "لا أحد بعد")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {nm(person)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="qt-f" role="radiogroup" aria-labelledby="qt-priority">
        <span className="qt-l" id="qt-priority">
          {t("Priority", "الأولوية")}
        </span>
        <div className="qt-seg">
          {[
            ["Low", t("Low", "منخفضة")],
            ["Medium", t("Medium", "متوسطة")],
            ["High", t("High", "عالية")],
          ].map(([value, label]) => (
            <button key={value} role="radio" aria-checked={priority === value} className={priority === value ? "on" : ""} onClick={() => setPriority(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="qt-f" role="group" aria-labelledby="qt-due">
        <span className="qt-l" id="qt-due">
          {t("Due", "الاستحقاق")}
        </span>
        <div className="qt-chips">
          {days.map(([id, label, value]) => (
            <button key={id} className={"qt-chip" + (due === value ? " on" : "")} aria-pressed={due === value} onClick={() => setDue(value)}>
              {label}
            </button>
          ))}
          <input
            type="date"
            className="qt-in qt-date"
            value={due}
            min={dayFromNow(0)}
            onChange={(event) => event.target.value && setDue(event.target.value)}
            aria-label={t("Pick a date", "اختر تاريخاً")}
          />
          <span className="qt-note">{new Date(`${due}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" })}</span>
        </div>
      </div>
      {problem && (
        <p className="qt-note" role="alert" style={{ color: "var(--text-danger)" }}>
          {problem}
        </p>
      )}
      <div className="qt-act">
        {comment.captureUrl && (
          <span className="qt-note">
            <Ic n="CropDS" s={14} c="currentColor" />
            {t("Capture included", "اللقطة مرفقة")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="d3-pill" onClick={onClose}>
          {t("Cancel", "إلغاء")}
        </button>
        <button className="d3t-next" disabled={!title.trim() || !project || busy} onClick={() => void create()}>
          {busy ? t("Creating…", "جارٍ الإنشاء…") : t("Create task", "إنشاء المهمة")}
        </button>
      </div>
    </div>
  );
}
