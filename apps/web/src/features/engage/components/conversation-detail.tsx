"use client";

import { useState } from "react";

import { useMay } from "@/components/shared/directory";
import { LiveRegion } from "@/components/shared/live-region";
import { MsgBody } from "@/components/shared/message";
import { PageHead } from "@/components/shared/page-head";
import { Btn, Lnk } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tg } from "@/components/ui/tag";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { formatDate, formatTime } from "@/i18n";
import { orThrow } from "@/lib/outcome";
import { useGo } from "@/lib/routes";
import {
  endConversationByPerson,
  resumeConversationAgent,
  sendConversationMessage,
  takeOverConversation,
} from "@/features/engage/actions";
import type {
  ActiveConversation,
  ConversationSummary,
  TranscriptLine,
} from "@/features/engage/types";
import { ActiveConversations } from "./active-conversations";
import { StatusTag } from "./conversations";

/** What one transcript line says, as text a person reads; null for a line with nothing to show. */
function lineText(
  line: TranscriptLine,
  t: (en: string, ar: string) => string,
): string | null {
  const text = t(line.textEn ?? "", line.textAr ?? line.textEn ?? "");
  switch (line.kind) {
    case "QuickReplies": {
      const choices = (line.payload.choices ?? []) as {
        en: string;
        ar: string;
      }[];
      return `${t("Offered", "عُرض")}: ${choices.map((choice) => t(choice.en, choice.ar || choice.en)).join(" · ")}`;
    }
    case "FormPrompt": {
      const fields = (line.payload.fields ?? []) as {
        labelEn: string;
        labelAr: string;
      }[];
      return `${t("Asked for", "طُلب")}: ${fields.map((field) => t(field.labelEn, field.labelAr || field.labelEn)).join(" · ")}`;
    }
    case "Form": {
      const values = (line.payload.values ?? {}) as Record<string, string>;
      return Object.entries(values)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" · ");
    }
    case "Otp":
      return "••••••";
    case "OtpPrompt":
      return t("Asked for a one-time code.", "طُلب رمز تحقق.");
    case "Verified":
      return t("Identity verified.", "تم التحقق من الهوية.");
    case "Blocks":
      return t("Showed a tool's result.", "عرض نتيجة أداة.");
    case "Ended":
      return `${t("Ended", "انتهت")}: ${String(line.payload.outcome ?? "")}`;
    default:
      return text || null;
  }
}

const SIDE: Record<string, [string, string]> = {
  Visitor: ["Visitor", "الزائر"],
  Agent: ["Agent", "الوكيل"],
  HumanAgent: ["Team", "الفريق"],
  System: ["System", "النظام"],
};

/**
 * D342: one visitor conversation, followed live. A person holding `conversations:answer` takes it
 * over (the agent stops answering), writes to the visitor, hands it back to the agent, or ends
 * it. The server decides each; the buttons only offer what the status allows.
 */
export function ConversationDetail({
  summary,
  lines,
  active,
}: {
  summary: ConversationSummary;
  lines: TranscriptLine[];
  active: ActiveConversation[];
}) {
  const { t, lang } = useAwp();
  const mayWrite = useMay()("conversations:answer");
  const go = useGo();
  const [run, pending] = useAction();
  const [draft, setDraft] = useState("");
  const thread = useFollowBottom<HTMLDivElement>(lines.length);
  const open = summary.outcome === null;
  const paused = summary.status === "AgentPaused";
  const at = (value: string) =>
    `${formatDate(lang, new Date(value))} ${formatTime(lang, new Date(value))}`;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    run(async () => {
      orThrow(await sendConversationMessage({ id: summary.id, text }));
      setDraft("");
    });
  };

  return (
    <div className="awp-page">
      <LiveRegion path={`/api/sse/conversations/${summary.id}`} />
      <PageHead
        crumb={
          <Lnk onClick={() => go("conversations")}>
            {t("Conversations", "المحادثات")}
          </Lnk>
        }
        title={t(
          summary.deploymentNameEn,
          summary.deploymentNameAr || summary.deploymentNameEn,
        )}
        sub={`${t("Started", "بدأت")} ${at(summary.startedAt)}${summary.lastAt ? ` · ${t("last activity", "آخر نشاط")} ${at(summary.lastAt)}` : ""}`}
      >
        <StatusTag status={summary.status} />
        {mayWrite && open && !paused && (
          <Btn
            label={t("Take over", "تولَّ المحادثة")}
            disabled={pending}
            onClick={() =>
              run(
                async () => (
                  orThrow(await takeOverConversation({ id: summary.id })),
                  t(
                    "The agent is paused. You are answering the visitor.",
                    "أُوقف الوكيل. أنت من يجيب الزائر.",
                  )
                ),
              )
            }
          />
        )}
        {mayWrite && open && paused && (
          <Btn
            type="secondary"
            label={t("Resume agent", "استئناف الوكيل")}
            disabled={pending}
            onClick={() =>
              run(
                async () => (
                  orThrow(await resumeConversationAgent({ id: summary.id })),
                  t("The agent is answering again.", "عاد الوكيل للإجابة.")
                ),
              )
            }
          />
        )}
        {mayWrite && open && (
          <Btn
            type="secondary"
            label={t("End conversation", "إنهاء المحادثة")}
            disabled={pending}
            onClick={() =>
              run(
                async () => (
                  orThrow(await endConversationByPerson({ id: summary.id })),
                  t("The conversation has ended.", "انتهت المحادثة.")
                ),
              )
            }
          />
        )}
      </PageHead>
      <div className="awp-row" style={{ flexWrap: "wrap", gap: 8 }}>
        {summary.channelType && (
          <Tg tone="neutral" label={summary.channelType} />
        )}
        {paused && summary.pausedBy && (
          <Tg
            tone="warning"
            label={t(
              `Taken over by ${summary.pausedBy}`,
              `تولّاها ${summary.pausedBy}`,
            )}
          />
        )}
        {summary.rating && (
          <Tg
            tone="info"
            label={t(
              `Rated ${summary.rating} / 5`,
              `التقييم ${summary.rating} / 5`,
            )}
          />
        )}
        {summary.requestKey && (
          <Lnk
            onClick={() =>
              go("requests", { open: summary.requestKey ?? undefined })
            }
          >
            {summary.requestKey}
          </Lnk>
        )}
        {summary.roomKey && (
          <Lnk onClick={() => go("session", { key: summary.roomKey ?? "" })}>
            {summary.roomKey}
          </Lnk>
        )}
      </div>
      <div
        className="awp-inbox"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px,300px) minmax(0,1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <ActiveConversations items={active} currentId={summary.id} />
        <Card pad={false}>
          <div
            ref={thread}
            style={{
              maxHeight: "60vh",
              overflow: "auto",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {lines.map((line, index) => {
              const text = lineText(line, t);
              if (!text) return null;
              const [en, ar] = SIDE[line.role] ?? [line.role, line.role];
              const author =
                line.role === "HumanAgent" &&
                typeof line.payload.author === "string"
                  ? line.payload.author
                  : t(en, ar);
              return (
                <div
                  key={line.seq ?? index}
                  className="awp-col"
                  style={{
                    gap: 4,
                    alignItems:
                      line.role === "Visitor" ? "flex-end" : "flex-start",
                  }}
                >
                  <div className="awp-row" style={{ gap: 8 }}>
                    <b className="awp-small">{author}</b>
                    {line.at && (
                      <span className="awp-small awp-muted">
                        {formatTime(lang, new Date(line.at))}
                      </span>
                    )}
                  </div>
                  <div
                    style={{ maxWidth: "80%" }}
                    className={
                      line.role === "System" ? "awp-small awp-muted" : undefined
                    }
                  >
                    <MsgBody text={text} />
                  </div>
                </div>
              );
            })}
            {!lines.length && (
              <p className="awp-muted" style={{ margin: 0 }}>
                {t("Nothing has been said yet.", "لم يُقل شيء بعد.")}
              </p>
            )}
          </div>
          {mayWrite && open && (
            <div
              className="awp-row awp-fab-clear awp-fab-always"
              style={{
                gap: 8,
                paddingBlock: 16,
                paddingInlineStart: 16,
                borderTop: "1px solid var(--border-subtle)",
                alignItems: "flex-end",
              }}
            >
              <textarea
                className="awp-input"
                rows={2}
                style={{ flex: 1, resize: "vertical" }}
                value={draft}
                maxLength={4000}
                disabled={!paused || pending}
                placeholder={
                  paused
                    ? t("Write to the visitor", "اكتب إلى الزائر")
                    : t(
                        "Take the conversation over to write to the visitor.",
                        "تولَّ المحادثة لتكتب إلى الزائر.",
                      )
                }
                aria-label={t("Message to the visitor", "رسالة إلى الزائر")}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <Btn
                label={t("Send", "إرسال")}
                disabled={!paused || pending || !draft.trim()}
                onClick={send}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
