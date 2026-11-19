"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { checkField, type FieldSpec } from "@/features/engage/fields";
import type { FieldPrompt, Input, Lang } from "@/features/engage/protocol";
import type { VoiceState } from "@/hooks/use-voice-input";

/** The embedded widget's composer: free text, or the control for the field a step asks for. */

export function Composer({
  input,
  step,
  disabled,
  title,
  lang,
  t,
  draft,
  setDraft,
  composerRef,
  voice,
  voiceState,
  onMic,
  onSend,
  onField,
  onUpload,
  onOtp,
  onResend,
  onCancel,
}: {
  input: Input;
  step: string | null;
  disabled: boolean;
  title: string;
  lang: Lang;
  t: (en: string, ar: string) => string;
  draft: string;
  setDraft: (text: string) => void;
  composerRef: RefObject<HTMLInputElement | null>;
  voice: boolean;
  voiceState: VoiceState;
  onMic: () => void;
  onSend: (text: string) => void;
  onField: (field: string, value: string) => void;
  onUpload: (name: string, dataUrl: string) => Promise<string | null>;
  onOtp: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  if (input.mode === "locked") {
    return (
      <div className="awp-wf-composer awp-wf-locked" role="status">
        {input.reason}
      </div>
    );
  }
  const free = (
    <form
      className="awp-wf-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onSend(draft.trim());
      }}
    >
      <input
        ref={composerRef}
        className="awp-wf-input"
        value={draft}
        disabled={disabled}
        maxLength={4000}
        placeholder={t(`Ask ${title}`, `اسأل ${title}`)}
        aria-label={t(`Ask ${title}`, `اسأل ${title}`)}
        onChange={(event) => setDraft(event.target.value)}
      />
      {/* D386: the microphone sits beside Send, so a spoken message can be edited or added to. */}
      {voice && (
        <button
          type="button"
          className={"awp-wf-send awp-wf-mic" + (voiceState === "recording" ? " on" : "")}
          disabled={disabled || voiceState === "transcribing"}
          aria-pressed={voiceState === "recording"}
          aria-busy={voiceState === "transcribing"}
          aria-label={voiceState === "recording" ? t("Stop recording", "إيقاف التسجيل") : voiceState === "transcribing" ? t("Turning your speech into text", "جارٍ تحويل كلامك إلى نص") : t("Speak", "تحدث")}
          onClick={onMic}
        >
          <span aria-hidden="true">{voiceState === "recording" ? "■" : "🎤"}</span>
        </button>
      )}
      {draft.trim() && (
        <button type="submit" className="awp-wf-send" disabled={disabled} aria-label={t("Send", "إرسال")}>
          <span aria-hidden="true">{lang === "ar" ? "◀" : "▶"}</span>
        </button>
      )}
    </form>
  );
  if (input.mode === "free") return free;

  const field = input.field;
  return (
    <div className="awp-wf-field-area">
      <FieldControl key={`${step}:${field.id}`} field={field} disabled={disabled} lang={lang} t={t} onSubmit={(value) => onField(field.id, value)} onUpload={onUpload} onOtp={onOtp} onResend={onResend} onCancel={onCancel} />
      {field.type !== "otp" && field.allowFreeText !== false && free}
    </div>
  );
}

/**
 * The control for one field prompt: six OTP boxes with a resend countdown, a consent button,
 * chips or a searchable list, checkboxes, a file picker, a multi-field form, or a typed input.
 * Values are checked here first only to show a hint; the server checks again. The composer keys
 * it by step and field, so its state starts empty for each new prompt.
 */
function FieldControl({
  field,
  disabled,
  lang,
  t,
  onSubmit,
  onUpload,
  onOtp,
  onResend,
  onCancel,
}: {
  field: FieldPrompt;
  disabled: boolean;
  lang: Lang;
  t: (en: string, ar: string) => string;
  onSubmit: (value: string) => void;
  onUpload: (name: string, dataUrl: string) => Promise<string | null>;
  onOtp: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [wait, setWait] = useState(field.resendAfterSeconds ?? 60);
  const [countryCode, setCountryCode] = useState("+971");
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (field.type !== "otp" || wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [field.type, wait]);

  const options = field.options ?? [];
  // The widget's own check only helps; the server decides (specification 10.2).
  const submit = (raw: string) => {
    const spec = { ...field, type: field.type === "form" ? "text" : field.type } as FieldSpec;
    const checked = checkField(spec, raw, options.map((option) => ({ value: option.value, en: option.label, ar: option.label })));
    if (!checked.ok) {
      setHint(lang === "ar" ? checked.ar : checked.en);
      return;
    }
    setHint(null);
    onSubmit(raw.trim());
  };
  const help = field.help ? <div className="awp-wf-muted">{field.help}</div> : null;
  const error = hint ? (
    <div className="awp-wf-hint" role="alert">
      {hint}
    </div>
  ) : null;

  switch (field.type) {
    case "otp": {
      const joined = code.join("");
      return (
        <div className="awp-wf-otp">
          <div className="awp-wf-muted">
            {field.maskedTarget ? t(`We sent a 6-digit code to ${field.maskedTarget}.`, `أرسلنا رمزاً من 6 أرقام إلى ${field.maskedTarget}.`) : t("Enter the 6-digit code.", "أدخل الرمز المكوّن من 6 أرقام.")}
          </div>
          <div className="awp-wf-otp-boxes" dir="ltr">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  boxes.current[index] = element;
                }}
                className="awp-wf-otp-box"
                value={digit}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={index === 0 ? 6 : 1}
                aria-label={t(`Digit ${index + 1}`, `الرقم ${index + 1}`)}
                disabled={disabled}
                onChange={(event) => {
                  const typed = event.target.value.replace(/\D/g, "");
                  const next = [...code];
                  // A pasted or autofilled code fills the boxes from the first; six digits submit.
                  if (typed.length > 1) {
                    typed.slice(0, 6).split("").forEach((one, at) => (next[at] = one));
                  } else next[index] = typed;
                  setCode(next);
                  if (typed && index < 5) boxes.current[Math.min(5, index + typed.length)]?.focus();
                  if (next.join("").length === 6) onOtp(next.join(""));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !code[index] && index > 0) boxes.current[index - 1]?.focus();
                }}
              />
            ))}
          </div>
          <div className="awp-wf-row">
            <button type="button" className="awp-wf-chip" disabled={disabled || joined.length !== 6} onClick={() => onOtp(joined)}>
              {t("Verify", "تحقق")}
            </button>
            <button type="button" className="awp-wf-link" disabled={wait > 0} onClick={() => { setWait(field.resendAfterSeconds ?? 60); onResend(); }}>
              {wait > 0 ? t(`Resend code in 0:${String(wait).padStart(2, "0")}`, `إعادة الإرسال بعد 0:${String(wait).padStart(2, "0")}`) : t("Resend code", "إعادة إرسال الرمز")}
            </button>
            <button type="button" className="awp-wf-link" onClick={onCancel}>
              {t("Cancel", "إلغاء")}
            </button>
          </div>
        </div>
      );
    }
    case "consent":
      return (
        <div className="awp-wf-consent">
          {help}
          <button type="button" className="awp-wf-chip awp-wf-primary" disabled={disabled} onClick={() => onSubmit("agree")}>
            {t("I agree", "أوافق")}
          </button>
          <button type="button" className="awp-wf-link" onClick={onCancel}>
            {t("Cancel", "إلغاء")}
          </button>
        </div>
      );
    case "select": {
      const shownOptions = options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase()));
      return (
        <div className="awp-wf-col">
          {help}
          {options.length > 6 && <input className="awp-wf-input" type="search" value={filter} placeholder={t("Search", "بحث")} aria-label={t("Search the options", "ابحث في الخيارات")} onChange={(event) => setFilter(event.target.value)} />}
          <div className={options.length > 6 ? "awp-wf-options" : "awp-wf-chips"}>
            {shownOptions.map((option) => (
              <button key={option.value} type="button" className="awp-wf-chip" disabled={disabled} onClick={() => onSubmit(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "multiselect":
      return (
        <div className="awp-wf-col">
          {help}
          {options.map((option) => (
            <label key={option.value} className="awp-wf-check">
              <input type="checkbox" checked={picked.includes(option.value)} disabled={disabled} onChange={() => setPicked(picked.includes(option.value) ? picked.filter((one) => one !== option.value) : [...picked, option.value])} />
              {option.label}
            </label>
          ))}
          {error}
          <button type="button" className="awp-wf-chip awp-wf-primary" disabled={disabled || picked.length === 0} onClick={() => submit(picked.join(","))}>
            {t("Done", "تم")}
          </button>
        </div>
      );
    case "file":
      return (
        <div className="awp-wf-col">
          {help}
          <label className="awp-wf-chip awp-wf-primary">
            {t("Upload a file", "رفع ملف")}
            <input
              type="file"
              hidden
              disabled={disabled}
              accept={field.accept?.join(",")}
              capture={undefined}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (!chosen) return;
                if (field.maxSizeMb && chosen.size > field.maxSizeMb * 1024 * 1024) {
                  setHint(t(`This file is larger than ${field.maxSizeMb} MB. Upload a smaller file or a photo.`, `هذا الملف أكبر من ${field.maxSizeMb} ميغابايت. ارفع ملفاً أصغر أو صورة.`));
                  return;
                }
                const reader = new FileReader();
                reader.onload = async () => {
                  const id = await onUpload(chosen.name, String(reader.result));
                  if (id) onSubmit(id);
                };
                reader.readAsDataURL(chosen);
              }}
            />
          </label>
          {error}
        </div>
      );
    case "form":
      return (
        <form
          className="awp-wf-col"
          onSubmit={(event) => {
            event.preventDefault();
            const missing = (field.fields ?? []).filter((one) => one.required && !values[one.key]?.trim());
            if (missing.length) {
              setHint(t(`Fill in ${missing.map((one) => one.label).join(", ")}.`, `املأ ${missing.map((one) => one.label).join("، ")}.`));
              return;
            }
            setHint(null);
            onSubmit(JSON.stringify(values));
          }}
        >
          {(field.fields ?? []).map((one) => (
            <label key={one.key} className="awp-wf-col">
              <span className="awp-wf-muted">
                {one.label}
                {one.required ? " *" : ""}
              </span>
              {one.options?.length ? (
                <select className="awp-wf-input" value={values[one.key] ?? ""} disabled={disabled} onChange={(event) => setValues({ ...values, [one.key]: event.target.value })}>
                  <option value="">{t("Choose…", "اختر…")}</option>
                  {one.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="awp-wf-input" value={values[one.key] ?? ""} placeholder={one.label} disabled={disabled} onChange={(event) => setValues({ ...values, [one.key]: event.target.value })} />
              )}
            </label>
          ))}
          {error}
          <button type="submit" className="awp-wf-chip awp-wf-primary" disabled={disabled}>
            {t("Send", "إرسال")}
          </button>
        </form>
      );
    default: {
      const kind =
        field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "time" ? "time" : field.type === "datetime" ? "datetime-local" : "text";
      const numeric = field.type === "number" || field.type === "amount";
      const control = (
        field.type === "textarea" ? (
          <textarea className="awp-wf-input" rows={3} value={value} maxLength={field.maxLength} placeholder={field.placeholder} disabled={disabled} aria-label={field.labelEn ?? field.id} onChange={(event) => setValue(event.target.value)} />
        ) : (
          <input
            className="awp-wf-input"
            type={kind}
            inputMode={numeric ? "decimal" : field.type === "phone" ? "tel" : undefined}
            value={value}
            min={typeof field.min === "string" || typeof field.min === "number" ? String(field.min) : undefined}
            max={typeof field.max === "string" || typeof field.max === "number" ? String(field.max) : undefined}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            disabled={disabled}
            aria-label={field.labelEn ?? field.id}
            onChange={(event) => setValue(event.target.value)}
          />
        )
      );
      return (
        <form
          className="awp-wf-col"
          onSubmit={(event) => {
            event.preventDefault();
            // A phone without `+` takes the chosen country code, less a leading 0; a date and
            // time gains the seconds the input leaves out.
            const raw = field.type === "phone" && !value.trim().startsWith("+") ? `${countryCode}${value.trim().replace(/^0/, "")}` : field.type === "datetime" && value ? `${value}:00` : value;
            submit(raw);
          }}
        >
          {help}
          <div className="awp-wf-row">
            {field.type === "phone" && (
              <select className="awp-wf-input awp-wf-cc" value={countryCode} aria-label={t("Country code", "رمز الدولة")} onChange={(event) => setCountryCode(event.target.value)}>
                {["+971", "+966", "+968", "+973", "+974", "+965", "+20", "+91", "+92", "+44", "+1"].map((cc) => (
                  <option key={cc} value={cc}>
                    {cc}
                  </option>
                ))}
              </select>
            )}
            {control}
            {field.type === "amount" && <span className="awp-wf-muted">{t("AED", "د.إ")}</span>}
            <button type="submit" className="awp-wf-send" disabled={disabled || !value.trim()} aria-label={t("Send", "إرسال")}>
              <span aria-hidden="true">{lang === "ar" ? "◀" : "▶"}</span>
            </button>
          </div>
          {field.type === "textarea" && field.maxLength && <div className="awp-wf-muted">{`${value.length} / ${field.maxLength}`}</div>}
          {error}
          {field.example && (
            <button type="button" className="awp-wf-link" onClick={() => setHint(t(`For example: ${field.example}`, `مثال: ${field.example}`))}>
              {t("Show me an example", "أرني مثالاً")}
            </button>
          )}
        </form>
      );
    }
  }
}
