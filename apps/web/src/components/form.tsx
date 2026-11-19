"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";

type State = { error?: string; fields?: Record<string, string[] | undefined>; done?: string } | undefined;
type Kept = (State & { values?: Record<string, string>; round?: number }) | undefined;

const Values = createContext<{ values: Record<string, string>; fields: Record<string, string[] | undefined> }>({
  values: {},
  fields: {},
});

/** Fields whose value is never sent back to the browser after a failed submit. */
const SECRET = /password|code|token/i;

/**
 * A form bound to a server action. After a failed submit it keeps what the user typed
 * (React resets the form) and shows the errors next to the fields (PLT-008 FR-008).
 */
export function ActionForm({
  action,
  children,
  submit,
  hidden,
}: {
  action: (state: State, form: FormData) => Promise<State>;
  children: ReactNode;
  submit: string;
  hidden?: Record<string, string>;
}) {
  const [state, run, pending] = useActionState<Kept, FormData>(async (previous, form) => {
    const result = await action(previous, form);
    const values = Object.fromEntries(
      [...form.entries()].filter(([name, value]) => typeof value === "string" && !SECRET.test(name)) as [string, string][],
    );
    return { ...result, values, round: (previous?.round ?? 0) + 1 };
  }, undefined);
  if (state?.done) return <p role="status">{state.done}</p>;
  return (
    <Values.Provider value={{ values: state?.values ?? {}, fields: state?.fields ?? {} }}>
      <form key={state?.round ?? 0} action={run} className="form" noValidate>
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Please wait…" : submit}
        </button>
      </form>
    </Values.Provider>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
}) {
  const { values, fields } = useContext(Values);
  const problems = fields[name];
  return (
    <div className="field">
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        className="input"
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={values[name] ?? defaultValue}
        aria-invalid={problems ? true : undefined}
        aria-describedby={problems ? `${name}-err` : undefined}
      />
      {problems ? (
        <span className="err" id={`${name}-err`}>
          {problems.join(" ")}
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  );
}
