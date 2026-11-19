"use client";

import { useState } from "react";

import { MsgBody } from "@/components/shared/message";
import { Ic } from "@/components/ui/icon";
import { platformToolName } from "@/features/connectors/tool-name";

/** One tool call of a run, from AG-UI's tool-call events (D252). */
export type Action = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: "running" | "done" | "failed";
  result: string;
};

/**
 * A turn as it happened, in order (D292): what the agent wrote, a run of calls, a question the
 * person answered, then the next text or calls after it.
 */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "steps"; id: string; actions: Action[] }
  | { kind: "asked"; question: string; answer: string };

/** Text joins the text before it; after anything else it starts a part of its own. */
export function withText(parts: Part[], delta: string): Part[] {
  const last = parts.at(-1);
  return last?.kind === "text" ? [...parts.slice(0, -1), { kind: "text", text: last.text + delta }] : [...parts, { kind: "text", text: delta }];
}

/** A call joins the run of calls before it; after text or a question it starts a new list. */
export function withAction(parts: Part[], action: Action): Part[] {
  const last = parts.at(-1);
  return last?.kind === "steps"
    ? [...parts.slice(0, -1), { ...last, actions: [...last.actions, action] }]
    : [...parts, { kind: "steps", id: action.id, actions: [action] }];
}

/** The parts with `change` applied to the call whose id is `id`, wherever it is; the rest unchanged. */
export function withActionChange(parts: Part[], id: string, change: Partial<Action>): Part[] {
  return parts.map((part) =>
    part.kind === "steps" && part.actions.some((action) => action.id === id)
      ? { ...part, actions: part.actions.map((action) => (action.id === id ? { ...action, ...change } : action)) }
      : part,
  );
}

/** Every call still shown as running, given the state the run ended it in. */
export function settleRunning(parts: Part[], state: "done" | "failed"): Part[] {
  return parts.map((part) =>
    part.kind === "steps" ? { ...part, actions: part.actions.map((action) => (action.state === "running" ? { ...action, state } : action)) } : part,
  );
}

/** Whether any call in the turn is still running. */
export const anyRunning = (parts: Part[]) =>
  parts.some((part) => part.kind === "steps" && part.actions.some((action) => action.state === "running"));

/** One value a question asks for, drawn as a field of a form (D252). */
export type QuestionField = { name: string; label: string; options: string[]; default: string };

type T = (en: string, ar: string) => string;

/** A refused call reaches the model as Pydantic AI's retry prompt, which ends with this. */
const RETRY_SUFFIX = "Fix the errors and try again.";

/** Whether a call's result is the retry prompt of a refused call, so the call reads as Refused. */
export const failedResult = (content: string) => content.trimEnd().endsWith(RETRY_SUFFIX);

/** The verbs of the catalogue's naming convention (D61), as a person reads them. */
const VERBS: Record<string, [string, string]> = {
  list: ["List", "عرض"],
  get: ["Read", "قراءة"],
  read: ["Read", "قراءة"],
  search: ["Search", "بحث"],
  create: ["Create", "إنشاء"],
  edit: ["Update", "تعديل"],
  delete: ["Delete", "حذف"],
  publish: ["Publish", "نشر"],
  run: ["Run", "تشغيل"],
  write: ["Save", "حفظ"],
  save: ["Save", "حفظ"],
};

/** "project_create" with `{ nameEn: "Ledger" }` reads "Create project · Ledger". */
export function actionTitle(action: Pick<Action, "name" | "args">, t: T): string {
  // A connector tool is listed as `<connector>__<tool>` (D223, D363); the tool names the action.
  const platform = platformToolName(action.name);
  const name = platform.includes("/") ? platform.slice(platform.indexOf("/") + 1) : platform;
  const words = name.split(/[_/.-]/).filter(Boolean);
  const verb = VERBS[words[words.length - 1] ?? ""];
  const subject = (verb ? words.slice(0, -1) : words).join(" ");
  const base = verb ? `${t(verb[0], verb[1])} ${subject}` : subject.charAt(0).toUpperCase() + subject.slice(1);
  const args = action.args;
  const target = [args.nameEn, args.name, args.title, args.key, args.code, args.query].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return target ? `${base} · ${target}` : base;
}

/** How many calls a list shows, newest first, before Show all (D292). */
const LATEST = 6;

/**
 * The calls a run made, each with its state; a call's arguments and result open on a click.
 * `folded` starts the list as its one-line count, as a room's finished messages do (D352).
 */
export function ActionList({ actions, t, folded = false }: { actions: Action[]; t: T; folded?: boolean }) {
  const running = actions.some((action) => action.state === "running");
  const failed = actions.filter((action) => action.state === "failed").length;
  const [count, countAr] = actions.length === 1 ? ["1 step", "خطوة واحدة"] : [`${actions.length} steps`, `${actions.length} خطوات`];
  // Open unless the person folds it: the steps are what the run did, so they stay in view.
  const [shown, setOpen] = useState(!folded);
  const [all, setAll] = useState(false);
  const newest = [...actions].reverse();
  return (
    <div className="d3a-acts">
      <button type="button" className="d3a-acts-h" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span>
          {running
            ? t(`Working · ${count}`, `جارٍ العمل · ${countAr}`)
            : t(`${count} done`, `اكتملت ${countAr}`) +
              (failed ? t(` · ${failed} refused`, ` · ${failed} مرفوضة`) : "")}
        </span>
        <Ic n="ChevronDown" s={14} />
      </button>
      {shown && (
        <ol className="d3a-acts-l">
          {(all ? newest : newest.slice(0, LATEST)).map((action) => (
            <ActionRow key={action.id} action={action} t={t} />
          ))}
        </ol>
      )}
      {shown && actions.length > LATEST && (
        <button type="button" className="d3a-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t("Show the latest 6", "عرض آخر 6") : t(`Show all ${actions.length}`, `عرض الكل (${actions.length})`)}
        </button>
      )}
    </div>
  );
}

/** One call: its state and title, opening on a click onto its arguments as JSON and its result. */
function ActionRow({ action, t }: { action: Action; t: T }) {
  const [open, setOpen] = useState(false);
  const state =
    action.state === "running" ? t("Running", "قيد التنفيذ") : action.state === "done" ? t("Done", "تم") : t("Refused", "مرفوض");
  return (
    <li className={"d3a-act is-" + action.state}>
      <button type="button" className="d3a-act-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="d3a-act-s" role="img" aria-label={state} title={state} />
        <span className="d3a-act-t">{actionTitle(action, t)}</span>
      </button>
      {open && (
        <pre className="d3a-act-d">
          {JSON.stringify(action.args, null, 2)}
          {action.result ? `\n\n${action.result}` : ""}
        </pre>
      )}
    </li>
  );
}

/** A turn in the order it happened: text, a list of calls, a question and its answer, and so on (D292). */
export function TurnParts({ parts, t }: { parts: Part[]; t: T }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "steps" ? (
          <ActionList key={part.id} actions={part.actions} t={t} />
        ) : part.kind === "asked" ? (
          <div key={index} className="d3a-asked">
            <b>{part.question}</b>
            <span>{part.answer}</span>
          </div>
        ) : (
          part.text.trim() && (
            <div key={index} className="d3a-md">
              <MsgBody text={part.text.trim()} />
            </div>
          )
        ),
      )}
    </>
  );
}

/** Several values a question asks for at once; the answer is one "label: value" line each. */
export function QuestionForm({ fields, onAnswer, t }: { fields: QuestionField[]; onAnswer: (text: string) => void; t: T }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.default || field.options[0] || ""])),
  );
  const labelOf = (field: QuestionField) => field.label || field.name;
  return (
    <form
      className="d3a-qf"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(fields.map((field) => `${labelOf(field)}: ${(values[field.name] ?? "").trim()}`).join("\n"));
      }}
    >
      {fields.map((field) => (
        <label key={field.name} className="d3a-qf-f">
          <span>{labelOf(field)}</span>
          {field.options.length > 0 ? (
            <select
              className="awp-input"
              value={values[field.name]}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            >
              {field.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              className="awp-input"
              value={values[field.name]}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          )}
        </label>
      ))}
      <button type="submit" className="awp-chip" disabled={fields.some((field) => !(values[field.name] ?? "").trim())}>
        {t("Send", "إرسال")}
      </button>
    </form>
  );
}
