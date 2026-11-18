"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import { AiOrb } from "@/components/shared/ai-orb";
import { MsgBody } from "@/components/shared/message";
import { useModals } from "@/components/shared/modal-host";
import { VoiceButton } from "@/components/shared/voice-button";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { deleteSavedChat, listSavedChats, readAttachment, readSavedChat, renameSavedChat, saveChat } from "@/features/assistant/actions";
import { ATTACHMENT_PICKER_ACCEPT, attachmentRefusal } from "@/features/assistant/attachments";
import { useProjects } from "@/components/shared/directory";
import { stopOwnRun } from "@/features/agents/actions";
import { uploadFile } from "@/features/files/actions";
import { answerAsked, decide, panelApproval } from "@/features/inbox/actions";
import type { ChatTurn, SavedChat } from "@/features/assistant/types";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { withSpoken } from "@/hooks/use-voice-input";
import { screenOfPath, useGo } from "@/lib/routes";
import {
  anyRunning,
  failedResult,
  QuestionForm,
  settleRunning,
  TurnParts,
  withAction,
  withActionChange,
  withText,
  type Part,
  type QuestionField,
} from "./assistant-activity";
import { suggestionsFor, PLACES } from "./assistant-prompts";

/** The agent code the console's assistant runs as, seeded as a platform agent. */
const ASSISTANT_AGENT = "pa";

/** Files one question may carry (D378); the reader cuts each at 30,000 characters. */
const MAX_FILES = 20;

/** What a run waits on, as its AG-UI custom events say (D239, D252). */
type Waiting =
  | { kind: "question"; questionId: string; question: string; options: string[]; fields: QuestionField[] }
  | {
      kind: "approval";
      key: string;
      toolName: string;
      reason: string;
      /** The person's own inbox item when they decide it (D281), and everyone it waits on. */
      inboxItemId: string | null;
      approvers: string[];
      decided: "Approved" | "Rejected" | "ChangesRequested" | null;
    };

/**
 * A turn as the panel draws it: its text, calls and answered questions in the order they
 * happened, shown live and not saved (D252, D292).
 */
type Turn = ChatTurn & { parts?: Part[] };

/** Whether the turn's latest part is text the agent is writing. */
const writing = (turn: Turn) => {
  const last = turn.parts?.at(-1);
  return last?.kind === "text" && last.text.trim() !== "";
};

/** A file read to text, which goes with the next question and is kept as a private file (D266). */
type Attached = { name: string; text: string; truncated: boolean; storable: boolean; dataUrl: string };

/** A question field from the `awp.agent.question` event. */
const fieldOf = (raw: unknown): QuestionField => {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    name: String(value.name ?? ""),
    label: String(value.label ?? ""),
    options: Array.isArray(value.options) ? value.options.map(String) : [],
    default: String(value.default ?? ""),
  };
};

/**
 * The assistant panel's conversation: header controls (saved chats, rename, new chat, full
 * screen, hide), the transcript or the saved-chat history, and the composer with attachments,
 * the project they are kept in, approval mode and Send or Stop.
 *
 * A question runs `pa` over AG-UI, with the panel's transcript as history. Text, tool calls,
 * questions and approvals are drawn as they arrive; the run's question is answered and its
 * approval decided in place, and in approval mode Auto an approval the person decides is
 * approved as it arrives (D282). The chat is saved when asked, when the run waits and when it
 * ends (D239); a failed turn is removed and the panel says the assistant is unavailable
 * (`UC-03.1-05`).
 */
export function Conversation({
  screen,
  expanded,
  onExpand,
  onClose,
}: {
  screen: string;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  const { t, why } = useAwp();
  const { ago } = useAgo();
  const go = useGo();
  const { open } = useModals();
  const assistant = useAgent({ agentId: ASSISTANT_AGENT });
  const [turns, setTurns] = useState<Turn[]>([]);
  // The answer being written stays in view as it streams, unless the reader scrolls up (D288).
  const list = useFollowBottom<HTMLDivElement>(turns.length);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [actions, setActions] = useState(false);
  // D239: a question or an approval the run waits on, shown where it was asked.
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [reply, setReply] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // D239: files whose text goes with the next question.
  const [attached, setAttached] = useState<Attached[]>([]);
  const [reading, setReading] = useState(false);
  // D266: the project attached files are kept in, the person's first project until they choose.
  const projects = useProjects();
  const [keepInChoice, setKeepIn] = useState("");
  const keepIn = keepInChoice || projects[0]?.k || "";
  const [renaming, setRenaming] = useState<string | null>(null);
  // Saves are queued and read the chat id from here, so a save while the run waits and the
  // one after it lands update one conversation rather than creating two.
  const chatRef = useRef<string | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  // Approval mode for this conversation: in Auto an approval the person decides is approved as
  // it arrives (D282). Read through a ref, since the run's event handlers outlive renders.
  const [autoApprove, setAutoApprove] = useState(false);
  const autoApproveRef = useRef(false);
  // The run in flight, so Stop can end it on the server and in this tab (D67).
  const current = useRef<{ stop: () => void; asked?: (question: string, answer: string) => void } | null>(null);

  const dashboard = screenOfPath(screen) === "dashboard";
  const suggestions = suggestionsFor(dashboard, t);

  const refreshHistory = useCallback(async () => {
    try {
      setChats(await listSavedChats());
    } catch {
      // The history is a convenience; failing to list it must not take the panel down.
    }
  }, []);
  useEffect(() => {
    void listSavedChats().then(setChats, () => {
      // The history is a convenience; failing to list it must not take the panel down.
    });
  }, []);

  /**
   * Saves the conversation as it stands. A question is saved when it is asked, again when
   * the run waits on a person and when it ends, so it is in the history whether or not the
   * panel stays open (D239). `null` removes a conversation whose only turn failed.
   */
  const persist = useCallback(
    (saved: Turn[] | null) => {
      saves.current = saves.current
        .then(async () => {
          if (saved === null) {
            if (chatRef.current) await deleteSavedChat({ chatId: chatRef.current });
            chatRef.current = null;
          } else {
            const kept: ChatTurn[] = saved.map(({ role, text }) => ({ role, text }));
            chatRef.current = await saveChat({ chatId: chatRef.current ?? undefined, screen, turns: kept });
          }
          setChatId(chatRef.current);
          await refreshHistory();
        })
        .catch(() => {
          // Saving is not what was asked for; the answer stands either way.
        });
      return saves.current;
    },
    [refreshHistory, screen],
  );

  const ask = useCallback(
    async (text: string) => {
      const typed = text.trim();
      const files = attached;
      // The files' text is the prompt, or goes with it; the transcript names the files only.
      const asked = files.length
        ? `${typed || t("Read the attached files and act on them.", "اقرأ الملفات المرفقة ونفّذ ما فيها.")}\n\n${files.map((file) => `📎 ${file.name}`).join("\n")}`
        : typed;
      const { agent, isReady } = assistant;
      if (!asked || running || !isReady) return;
      let runId: string | null = null;
      let stopped = false;
      current.current = {
        stop: () => {
          stopped = true;
          agent.abortRun();
          if (runId) void stopOwnRun({ runId }).catch(() => undefined);
        },
      };

      setQuestion("");
      setAttached([]);
      setUnavailable(false);
      setProblem(null);
      setWaiting(null);
      setRunning(true);
      setView("chat");
      let answer = "";
      let parts: Part[] = [];
      const started: Turn[] = [...turns, { role: "user", text: asked }];
      setTurns([...started, { role: "assistant", text: "" }]);
      // Deltas and tool calls arrive faster than React re-renders, so the turn is rebuilt
      // from these locals each time rather than from state.
      const show = () => {
        const turn: Turn = { role: "assistant", text: answer, parts };
        setTurns((before) => [...before.slice(0, -1), turn]);
      };
      // An answered question stays in the turn where it was asked, and what follows comes after it.
      if (current.current) {
        current.current.asked = (question, given) => {
          parts = [...parts, { kind: "asked", question, answer: given }];
          show();
        };
      }
      void persist(started);

      // D266: each file is kept as an Only-me file in the chosen project, so the agent can use
      // the whole of it by id; the prompt says what the agent holds and where the file is.
      const kept = await Promise.all(
        files.map(async (file) => {
          if (!file.storable) return "It is not stored on the platform: the file store does not keep this type.";
          const outcome = keepIn
            ? await uploadFile({ projectKey: keepIn, name: file.name, dataUrl: file.dataUrl, scope: "OnlyMe" }).catch(() => null)
            : null;
          if (outcome?.ok) return `It is stored as file ${outcome.value.id} in project ${keepIn}, readable only by the person asking.`;
          return `It is not stored on the platform${outcome && !outcome.ok ? `: ${outcome.reason}` : ""}.`;
        }),
      );
      const prompt = [
        asked,
        ...files.map(
          (file, index) =>
            `--- ${file.name}: ${file.truncated ? `the first ${file.text.length} characters of its text; the rest was not sent` : "its full text"}. ` +
            `${kept[index]} ---\n${file.text}`,
        ),
      ].join("\n\n");
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: prompt });

      let finished = false;
      // A run the agent service refuses ends with a RUN_ERROR event rather than a throw.
      let failed = false;
      try {
        await agent.runAgent(
          // `UC-03.1-02`: which screen the question is about. The agent reads that screen's
          // data under the asker's own permissions. Which context the run gets is the
          // server's to decide from the agent and the surface, not this panel's to send:
          // a client that could name its own context would be choosing its own tools.
          {
            // `history` is the panel's own transcript. The run is assembled fresh each
            // turn, so without this an agent that asked a question never sees the answer
            // and starts over — which is what left a half-asked question hanging.
            forwardedProps: { screen, history: started.slice(-40) },
          },
          {
            onRunStartedEvent({ event }) {
              runId = event.runId;
            },
            /** A streamed text delta, added to the answer and to the turn's latest text part. */
            onTextMessageContentEvent({ event }) {
              // Text after a step starts a new paragraph rather than running on from the last.
              if (answer && parts.at(-1)?.kind !== "text") answer += "\n\n";
              answer += event.delta;
              parts = withText(parts, event.delta);
              show();
            },
            // D252: each call the run makes is a step of the turn's action list. A question
            // is its own card, so `ask_person` is not listed.
            onToolCallStartEvent({ event }) {
              if (event.toolCallName === "ask_person") return;
              parts = withAction(parts, { id: event.toolCallId, name: event.toolCallName, args: {}, state: "running", result: "" });
              show();
            },
            onToolCallEndEvent({ event, toolCallArgs }) {
              parts = withActionChange(parts, event.toolCallId, { args: toolCallArgs });
              show();
            },
            onToolCallResultEvent({ event }) {
              const content = typeof event.content === "string" ? event.content : JSON.stringify(event.content);
              parts = withActionChange(parts, event.toolCallId, { state: failedResult(content) ? "failed" : "done", result: content });
              show();
            },
            onRunErrorEvent() {
              failed = true;
            },
            /**
             * What the run waits on (D239): `awp.agent.question` shows the question card, and
             * `awp.tool.approval` or `awp.tool.confirmation` the approval card, then asks who
             * decides it and, in Auto, approves it when it is this person's. Either saves the
             * conversation as it stands; any other custom event is ignored.
             */
            onCustomEvent({ event }) {
              const value = (event.value ?? {}) as Record<string, unknown>;
              if (event.name === "awp.agent.question") {
                setWaiting({
                  kind: "question",
                  questionId: String(value.questionId ?? ""),
                  question: String(value.question ?? ""),
                  options: Array.isArray(value.options) ? value.options.map(String) : [],
                  fields: Array.isArray(value.fields) ? value.fields.map(fieldOf).filter((field) => field.name) : [],
                });
              } else if (event.name === "awp.tool.approval" || event.name === "awp.tool.confirmation") {
                const key = String(value.approvalKey ?? "");
                setWaiting({
                  kind: "approval",
                  key,
                  toolName: String(value.toolName ?? ""),
                  reason: String(value.reason ?? ""),
                  inboxItemId: null,
                  approvers: [],
                  decided: null,
                });
                // Whether this person decides it here, or who does (D281); in Auto, decided now (D282).
                if (key) {
                  void panelApproval({ key })
                    .then(async (found) => {
                      const auto = !!found?.inboxItemId && autoApproveRef.current;
                      const approved =
                        auto &&
                        (
                          await decide({
                            inboxItemId: found!.inboxItemId!,
                            decision: "Approved",
                            reason: "Approved automatically: approval mode Auto in the assistant panel.",
                          })
                        ).ok;
                      setWaiting((now) =>
                        now?.kind === "approval" && now.key === key && found
                          ? { ...now, inboxItemId: found.inboxItemId, approvers: found.approvers, decided: approved ? "Approved" : null }
                          : now,
                      );
                    })
                    .catch(() => undefined);
                }
              } else {
                return;
              }
              void persist(answer ? [...started, { role: "assistant", text: answer }] : started);
            },
          },
        );
        finished = !failed;
      } catch {
        failed = true;
      } finally {
        current.current = null;
        setRunning(false);
        setWaiting(null);
      }
      // A stopped run keeps what it said, marked as stopped, and is not reported as a failure.
      if (stopped) {
        failed = false;
        finished = true;
        const note = answer ? `\n\n${t("(Stopped.)", "(أُوقف.)")}` : t("Stopped.", "أُوقف.");
        answer += note;
        parts = settleRunning(withText(parts, note), "failed");
        show();
      }
      // A run answers only once every call it made has returned, so a call still shown as
      // running lost its result event on the way; a failed run stopped the rest.
      if (anyRunning(parts)) {
        parts = settleRunning(parts, failed ? "failed" : "done");
        if (!failed) show();
      }
      if (failed) {
        // `UC-03.1-05`: the model route or the agent service is unavailable. The panel says
        // so and the screen behind it is untouched — nothing on the page depended on this.
        // A failed turn is not kept: the question saved when it was asked is taken back.
        setUnavailable(true);
        setTurns(started.slice(0, -1));
        void persist(started.length > 1 ? started.slice(0, -1) : null);
      }

      if (finished) void persist([...started, { role: "assistant", text: answer }]);
    },
    [assistant, attached, keepIn, persist, running, screen, t, turns],
  );

  /** D239: the answer to the run's question, given here rather than in the Inbox. */
  const answerQuestion = async (text: string) => {
    if (!waiting || waiting.kind !== "question" || !text.trim()) return;
    const outcome = await answerAsked({ questionId: waiting.questionId, answer: text.trim() });
    if (!outcome.ok) {
      setProblem(why(outcome));
      return;
    }
    setReply("");
    current.current?.asked?.(waiting.question, text.trim());
    setWaiting(null);
  };

  /**
   * D281: the decision on the run's approval, taken here by the person it waits on. The note
   * reaches the agent with a rejection or a change request (D285).
   */
  const decideHere = async (decision: "Approved" | "Rejected" | "ChangesRequested") => {
    if (!waiting || waiting.kind !== "approval" || !waiting.inboxItemId) return;
    const note = reply.trim();
    const outcome = await decide({
      inboxItemId: waiting.inboxItemId,
      decision,
      ...(note ? { reason: note } : decision === "Rejected" ? { reason: t("Not approved.", "غير معتمد.") } : {}),
    });
    if (!outcome.ok) {
      setProblem(t(outcome.message, outcome.messageAr));
      return;
    }
    setReply("");
    setWaiting({ ...waiting, decided: decision });
  };

  /** D239: files attached to the next question, each read to text on the server. */
  const attach = async (picked: File[]) => {
    const room = MAX_FILES - attached.length;
    if (picked.length === 0) return;
    setProblem(picked.length > room ? t(`A question can carry ${MAX_FILES} files.`, `يمكن أن يحمل السؤال ${MAX_FILES} ملفًا.`) : null);
    setReading(true);
    try {
      for (const file of picked.slice(0, Math.max(room, 0))) {
        // The server checks again; this spares sending a file it would refuse.
        const refusal = attachmentRefusal(file.name, file.size);
        if (refusal) {
          setProblem(`${file.name}: ${t(refusal.en, refusal.ar)}`);
          continue;
        }
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          const read = await readAttachment({ name: file.name, dataUrl });
          if (read.ok) {
            const { text, truncated, storable } = read;
            setAttached((before) => [...before, { name: file.name, text, truncated, storable, dataUrl }]);
          }
          else setProblem(`${file.name}: ${t(read.reason, read.reasonAr)}`);
        } catch {
          setProblem(t(`${file.name} could not be read.`, `تعذّرت قراءة ${file.name}.`));
        }
      }
    } finally {
      setReading(false);
    }
  };

  const rename = async () => {
    const title = (renaming ?? "").trim();
    if (!chatId || !title) return;
    await renameSavedChat({ chatId, title });
    setRenaming(null);
    await refreshHistory();
  };

  const newChat = () => {
    chatRef.current = null;
    setChatId(null);
    setWaiting(null);
    setAttached([]);
    setRenaming(null);
    setTurns([]);
    setAutoApprove(false);
    autoApproveRef.current = false;
    setView("chat");
  };

  const reopen = async (id: string) => {
    const saved = await readSavedChat({ chatId: id });
    if (!saved) return;
    chatRef.current = saved.id;
    setChatId(saved.id);
    setTurns(saved.turns);
    setView("chat");
  };

  const forget = async (id: string) => {
    await deleteSavedChat({ chatId: id });
    if (id === chatRef.current) newChat();
    await refreshHistory();
  };

  const when = (iso: string) => ago(iso);

  return (
    <>
      <div className="awp-card-h">
        <div className="d3a-h">
          <AiOrb size={32} still />
          <div>
            <h3>{t("AI Assistant", "المساعد الذكي")}</h3>
            <span className="d3a-hs">
              {running
                ? t("Thinking…", "يفكّر…")
                : dashboard
                  ? t("Knows this dashboard", "مطّلع على هذه اللوحة")
                  : t("Knows this page", "مطّلع على هذه الصفحة")}
            </span>
          </div>
        </div>
        <span className="d3a-ha">
          <button
            className={"awp-iconbtn" + (view === "history" ? " on" : "")}
            onClick={() => setView(view === "history" ? "chat" : "history")}
            aria-pressed={view === "history"}
            aria-label={t("Saved chats", "المحادثات المحفوظة")}
            title={t("Saved chats", "المحادثات المحفوظة")}
          >
            <Ic n="Chat" s={16} c="currentColor" />
          </button>
          <button
            className="awp-iconbtn"
            disabled={!chatId}
            onClick={() => setRenaming(chats.find((chat) => chat.id === chatId)?.title ?? "")}
            aria-label={t("Name this chat", "تسمية هذه المحادثة")}
            title={t("Name this chat", "تسمية هذه المحادثة")}
          >
            <Ic n="PencilEdit01" s={16} />
          </button>
          <button className="awp-iconbtn" onClick={newChat} aria-label={t("New chat", "محادثة جديدة")} title={t("New chat", "محادثة جديدة")}>
            <Ic n="PlusSignSquare" s={16} />
          </button>
          <button
            className={"awp-iconbtn" + (expanded ? " on" : "")}
            onClick={onExpand}
            aria-pressed={expanded}
            aria-label={t("Full screen", "ملء الشاشة")}
            title={t("Full screen", "ملء الشاشة")}
          >
            <span aria-hidden="true">⤢</span>
          </button>
          {/* Hides the panel; the conversation, and a run still answering, stay. */}
          <button className="awp-iconbtn" onClick={onClose} aria-label={t("Hide", "إخفاء")} title={t("Hide", "إخفاء")}>
            <Ic n="X" s={18} />
          </button>
        </span>
      </div>

      <div className="awp-card-b d3a-b">
        {renaming !== null && (
          <form
            className="d3a-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input
              className="awp-input"
              value={renaming}
              maxLength={120}
              autoFocus
              aria-label={t("Chat name", "اسم المحادثة")}
              onChange={(event) => setRenaming(event.target.value)}
            />
            <button type="submit" className="awp-chip" disabled={!renaming.trim()}>
              {t("Save", "حفظ")}
            </button>
            <button type="button" className="awp-chip" onClick={() => setRenaming(null)}>
              {t("Cancel", "إلغاء")}
            </button>
          </form>
        )}
        {view === "history" ? (
          <div className="d3a-list d3a-hist">
            <span className="d3a-hist-h">{t("Saved chats", "المحادثات المحفوظة")}</span>
            {chats.length === 0 && (
              <p className="d3a-intro">
                {t(
                  "No saved chats yet. Conversations are saved automatically to your account.",
                  "لا توجد محادثات محفوظة بعد. تُحفظ المحادثات تلقائياً في حسابك.",
                )}
              </p>
            )}
            {chats.map((chat) => (
              <div key={chat.id} className={"d3a-hi" + (chat.id === chatId ? " on" : "")}>
                <button className="d3a-hi-b" onClick={() => void reopen(chat.id)}>
                  <b>{chat.title}</b>
                  <span>
                    {when(chat.lastMessageAt)} · {chat.messageCount} {t("messages", "رسائل")}
                  </span>
                </button>
                <button
                  className="awp-iconbtn d3a-hi-x"
                  onClick={() => void forget(chat.id)}
                  aria-label={t("Delete chat", "حذف المحادثة")}
                  title={t("Delete chat", "حذف المحادثة")}
                >
                  <Ic n="X" s={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="d3a-list" aria-live="polite" ref={list}>
              {turns.length === 0 && (
                <>
                  <p className="d3a-intro">
                    {dashboard
                      ? t(
                          "Ask me about runs, costs, budget, work items or discussion rooms. I can take you to any of them.",
                          "اسألني عن العمليات والتكاليف والميزانية وبنود العمل واجتماعات العمل. ويمكنني نقلك إلى أي منها.",
                        )
                      : t("Bound to this page with your permissions.", "مرتبط بهذه الصفحة وبصلاحياتك.")}
                  </p>
                  <div className="d3a-sugg">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.text}
                        className="awp-chip"
                        disabled={running || !assistant.isReady}
                        onClick={() => void ask(suggestion.text)}
                      >
                        {suggestion.text}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {turns.map((turn, index) => (
                <div key={index} className={"d3a-m is-" + turn.role}>
                  {/* D252, D292: a turn drawn as it happened. An answer is Markdown; the
                      person's own text is drawn as typed; a saved chat keeps only the text. */}
                  {turn.role === "user" ? (
                    turn.text
                  ) : turn.parts ? (
                    <TurnParts parts={turn.parts} t={t} />
                  ) : (
                    turn.text && <div className="d3a-md"><MsgBody text={turn.text} /></div>
                  )}
                  {/* The run is working and is not writing text right now. */}
                  {running && index === turns.length - 1 && turn.role === "assistant" && !writing(turn) && !waiting && (
                    <span className="d3a-typing" aria-label={t("Thinking", "يفكّر")}>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
              ))}

              {waiting?.kind === "question" && (
                <div className="d3a-m is-assistant" role="group" aria-label={t("The assistant asks", "يسأل المساعد")}>
                  <b>{waiting.question}</b>
                  {waiting.fields.length > 0 && <QuestionForm fields={waiting.fields} onAnswer={(text) => void answerQuestion(text)} t={t} />}
                  {waiting.options.length > 0 && (
                    <div className="d3a-sugg" style={{ marginTop: 8 }}>
                      {waiting.options.map((option) => (
                        <button key={option} className="awp-chip" onClick={() => void answerQuestion(option)}>
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  {waiting.fields.length === 0 && (
                    <form
                      className="d3a-form"
                      style={{ marginTop: 8 }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void answerQuestion(reply);
                      }}
                    >
                      <input
                        className="awp-input"
                        value={reply}
                        aria-label={t("Your answer", "إجابتك")}
                        placeholder={t("Your answer", "إجابتك")}
                        onChange={(event) => setReply(event.target.value)}
                      />
                      <button type="submit" className="awp-chip" disabled={!reply.trim()}>
                        {t("Answer", "إجابة")}
                      </button>
                    </form>
                  )}
                </div>
              )}
              {waiting?.kind === "approval" && (
                <div className="d3a-m is-assistant" role="status">
                  <b>
                    {waiting.key
                      ? t(`Waiting for approval ${waiting.key}`, `بانتظار الاعتماد ${waiting.key}`)
                      : t("Waiting for approval", "بانتظار الاعتماد")}
                  </b>
                  <div className="awp-small" style={{ marginTop: 4 }}>
                    {waiting.reason || t(`${waiting.toolName} needs a person's approval.`, `تحتاج ${waiting.toolName} إلى اعتماد شخص.`)}
                  </div>
                  {waiting.decided ? (
                    <div className="awp-small awp-muted" style={{ marginTop: 4 }}>
                      {waiting.decided === "Approved"
                        ? t("Approved. The run continues.", "تم الاعتماد. يتابع التشغيل.")
                        : waiting.decided === "ChangesRequested"
                          ? t("Changes requested. The agent is told what to change.", "طُلبت تعديلات. أُبلغ الوكيل بما يجب تعديله.")
                          : t("Rejected. The run is told.", "تم الرفض. أُبلغ التشغيل.")}
                    </div>
                  ) : waiting.inboxItemId ? (
                    <>
                      <input
                        className="awp-input"
                        style={{ marginTop: 8 }}
                        value={reply}
                        aria-label={t("Note for the agent", "ملاحظة للوكيل")}
                        placeholder={t("Note for the agent (needed to request changes)", "ملاحظة للوكيل (مطلوبة لطلب تعديلات)")}
                        onChange={(event) => setReply(event.target.value)}
                      />
                      <div className="d3a-sugg" style={{ marginTop: 8 }}>
                        <button type="button" className="awp-chip" onClick={() => void decideHere("Approved")}>
                          {t("Approve", "اعتماد")}
                        </button>
                        <button type="button" className="awp-chip" disabled={!reply.trim()} onClick={() => void decideHere("ChangesRequested")}>
                          {t("Request changes", "طلب تعديلات")}
                        </button>
                        <button type="button" className="awp-chip" onClick={() => void decideHere("Rejected")}>
                          {t("Reject", "رفض")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="awp-small awp-muted" style={{ marginTop: 4 }}>
                      {waiting.approvers.length
                        ? t(
                            `Waiting on ${waiting.approvers.join(", ")}, who decide it in their Inbox; the answer continues here.`,
                            `بانتظار ${waiting.approvers.join("، ")}، ويقرّرونه في صندوق الوارد؛ وتكمل الإجابة هنا.`,
                          )
                        : t(
                            "An approver decides it in their Inbox; the answer continues here once it is decided.",
                            "يقرّره معتمِد في صندوق الوارد لديه؛ وتكمل الإجابة هنا بعد القرار.",
                          )}
                    </div>
                  )}
                </div>
              )}

              {problem && (
                <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
                  {problem}
                </p>
              )}

              {unavailable && (
                <p role="alert" className="awp-small" style={{ margin: 0, color: "var(--feedback-danger-text)" }}>
                  {t("The assistant is unavailable, try again", "المساعد غير متاح، حاول مرة أخرى")}
                </p>
              )}
            </div>

            {/*
              Handoff v2 lets the assistant open a page, a run or a create form. Those are
              offered here as controls rather than as tools the model calls: a tool the
              browser executes would have to be declared into the run and answered back to
              it, and the run is assembled and executed in the agent service, which has no
              channel back to this tab. The destinations are the same ones either way.
            */}
            {actions && (
              <div className="d3a-sugg">
                {PLACES.map(([id, en, ar]) => (
                  <button
                    key={id}
                    className="awp-chip"
                    onClick={() => {
                      setActions(false);
                      go(id);
                    }}
                  >
                    {t(en, ar)}
                  </button>
                ))}
                {(["workitem", "room", "request"] as const).map((key) => (
                  <button
                    key={key}
                    className="awp-chip"
                    onClick={() => {
                      setActions(false);
                      open(key);
                    }}
                  >
                    {key === "workitem"
                      ? t("New Work Item", "بند عمل جديد")
                      : key === "room"
                        ? t("New Discussion Room", "اجتماع عمل جديد")
                        : t("New Request", "طلب جديد")}
                  </button>
                ))}
              </div>
            )}

            {(attached.length > 0 || reading) && (
              <div className="d3a-files">
                {/* Up to 20 files: the list scrolls so the composer stays in the panel. */}
                {attached.length > 0 && (
                  <div className="d3a-files-l" role="list" aria-label={t(`${attached.length} attached files`, `الملفات المرفقة: ${attached.length}`)}>
                    {attached.map((file, index) => (
                      <span key={`${file.name}-${index}`} className="awp-chip" role="listitem" title={file.name}>
                        📎 {file.name}
                        <button
                          type="button"
                          className="awp-iconbtn"
                          style={{ width: 24, height: 24, marginInlineStart: 6 }}
                          onClick={() => setAttached((before) => before.filter((_, at) => at !== index))}
                          aria-label={t(`Remove ${file.name}`, `إزالة ${file.name}`)}
                        >
                          <Ic n="X" s={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {reading && (
                  <span className="awp-chip" role="status">
                    {t("Reading the file…", "جارٍ قراءة الملف…")}
                  </span>
                )}
                {/* D266: sent files are kept as private files, which the agent can use by id. */}
                {attached.length > 0 &&
                  (projects.length > 0 ? (
                    <PopSelect
                      className="awp-input"
                      style={{ width: 200 }}
                      value={keepIn}
                      onChange={(event) => setKeepIn(event.target.value)}
                      aria-label={t("Keep the files, only for you, in project", "احفظ الملفات، لك وحدك، في المشروع")}
                    >
                      {projects.map((project) => (
                        <option key={project.k} value={project.k}>
                          {t(`Keep in ${project.k}`, `احفظ في ${project.k}`)}
                        </option>
                      ))}
                    </PopSelect>
                  ) : (
                    <span className="awp-small awp-muted">{t("Not kept: you have no project.", "لن تُحفظ: ليس لديك مشروع.")}</span>
                  ))}
              </div>
            )}
            <form
              className="d3a-form d3a-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void ask(question);
              }}
            >
              <button
                type="button"
                className="awp-iconbtn d3a-add"
                style={{ width: 40, height: 40, borderRadius: 999, flexShrink: 0 }}
                aria-expanded={actions}
                onClick={() => setActions(!actions)}
                aria-label={t("Go to a page or start something", "الانتقال إلى صفحة أو بدء شيء")}
                title={t("Go to a page or start something", "الانتقال إلى صفحة أو بدء شيء")}
              >
                <Ic n="AddCircle" s={18} />
              </button>
              <label
                className="awp-iconbtn d3a-file"
                style={{ width: 40, height: 40, borderRadius: 999, flexShrink: 0, cursor: running || reading ? "default" : "pointer" }}
                aria-label={t("Attach a file", "إرفاق ملف")}
                title={t("Attach a file", "إرفاق ملف")}
              >
                <Ic n="AttachL" s={18} />
                <input
                  type="file"
                  multiple
                  accept={ATTACHMENT_PICKER_ACCEPT}
                  style={{ display: "none" }}
                  disabled={running || reading || attached.length >= MAX_FILES}
                  onChange={(event) => {
                    void attach([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </label>
              {/* D386: spoken text joins the question, beside the attached files. */}
              <VoiceButton
                className="d3a-voice"
                disabled={reading}
                onText={(spoken) => {
                  setProblem(null);
                  setQuestion((draft) => withSpoken(draft, spoken));
                }}
                onProblem={setProblem}
              />
              {/* Enter sends and Shift+Enter starts a new line; a key pressed while an input
                  method composes is the method's. */}
              <textarea
                className="awp-input d3a-ta"
                rows={1}
                value={question}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  // While a run works the next question is written, and sent once it ends or is stopped.
                  if (!running) event.currentTarget.form?.requestSubmit();
                }}
                placeholder={dashboard ? t("Ask about this dashboard", "اسأل عن هذه اللوحة") : t("Ask about this page", "اسأل عن هذه الصفحة")}
                aria-label={t("Message", "الرسالة")}
                onChange={(event) => setQuestion(event.target.value)}
              />
              {/* D282: in Auto, an approval this person decides is approved as it arrives, for this conversation. */}
              <span
                className="d3a-mode"
                title={t(
                  "Approvals. Auto approves the approvals you decide as they arrive, for this conversation; Manual asks each time.",
                  "الموافقات. يعتمد الوضع التلقائي الموافقات التي تقرّرها فور وصولها، لهذه المحادثة؛ ويسأل اليدوي في كل مرة.",
                )}
              >
                <PopSelect
                  value={autoApprove ? "Auto" : "Manual"}
                  aria-label={t("Approval mode", "وضع الموافقات")}
                  onChange={(event) => {
                    autoApproveRef.current = event.target.value === "Auto";
                    setAutoApprove(event.target.value === "Auto");
                  }}
                >
                  <option value="Manual">{t("Manual", "يدوي")}</option>
                  <option value="Auto">{t("Auto", "تلقائي")}</option>
                </PopSelect>
              </span>
              {running ? (
                <button
                  type="button"
                  className="d3a-send d3a-stop"
                  onClick={() => current.current?.stop()}
                  aria-label={t("Stop", "إيقاف")}
                  title={t("Stop", "إيقاف")}
                >
                  <i />
                </button>
              ) : (
                <button
                  type="submit"
                  className="d3a-send"
                  disabled={reading || (!question.trim() && attached.length === 0) || !assistant.isReady}
                  aria-label={t("Send", "إرسال")}
                >
                  <Ic n="ArrowUpRightL" s={16} c="currentColor" />
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </>
  );
}
