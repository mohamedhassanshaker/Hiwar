"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { Tg } from "@/components/ui/tag";
import { answerAsked } from "@/features/inbox/actions";
import type { RoomQuestion } from "@/features/rooms/types";
import { useAwp } from "@/hooks/use-awp";

/**
 * The question card an agent posts into a room when its run asks the person it acts for (`UC-12.2-01`). The answer is
 * the same one the Inbox and the assistant panel record (`answerAsked`), so a question answered here and one answered
 * there cannot disagree, and the run resumes either way. Everyone else in the room reads who it is waiting on.
 */
export function QuestionCard({ question }: { question: RoomQuestion }) {
  const { t, why } = useAwp();
  const [answered, setAnswered] = useState<string | null>(question.answer);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (text: string) =>
    start(async () => {
      setError(null);
      const outcome = await answerAsked({ questionId: question.id, answer: text });
      if (outcome.ok) setAnswered(text);
      else setError(why(outcome));
    });

  return (
    <div className="awp-card" data-question={question.id} style={{ marginTop: 10, padding: 16, background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="awp-row">
        <Ic n="InformationDiamond" c="var(--icon-brand)" />
        <b style={{ flex: 1 }}>{t("Agent question", "سؤال من الوكيل")}</b>
      </div>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{question.question}</p>
      {answered !== null ? (
        <div className="awp-col" style={{ gap: 6 }}>
          <Tg tone="success" dot size="md" label={t("Answered · the run continues", "تمت الإجابة · تتابع العملية")} />
          <p className="awp-small awp-muted" style={{ margin: 0 }}>
            {(question.answeredBy ?? t("You", "أنت")) + ": " + answered}
          </p>
        </div>
      ) : question.mayAnswer ? (
        <>
          {question.options.length > 0 && (
            <div className="awp-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {question.options.map((option) => (
                <Btn key={option} type="secondary" label={option} disabled={pending} onClick={() => send(option)} />
              ))}
            </div>
          )}
          <textarea
            className="awp-input"
            aria-label={t("Your answer", "إجابتك")}
            placeholder={t("Your answer resumes the run", "إجابتك تستأنف العملية")}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="awp-row">
            <Btn label={t("Send answer", "إرسال الإجابة")} disabled={pending || !draft.trim()} onClick={() => send(draft.trim())} />
          </div>
        </>
      ) : (
        <Tg tone="warning" dot size="md" label={t(`Waiting for ${question.askedTo ?? "the person asked"} to answer`, `بانتظار إجابة ${question.askedTo ?? "الشخص المسؤول"}`)} />
      )}
      {error && (
        <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--text-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
