"use client";

import { useEffect, useRef, useState } from "react";

import { useAgents, usePeople } from "@/components/shared/directory";
import { LiveRegion } from "@/components/shared/live-region";
import { Msg, MsgBody } from "@/components/shared/message";
import { useModals } from "@/components/shared/modal-host";
import { useToast } from "@/components/shared/toast";
import { VoiceButton } from "@/components/shared/voice-button";
import { Btn, Lnk } from "@/components/ui/button";
import { Ic } from "@/components/ui/icon";
import { PopSelect } from "@/components/ui/pop-select";
import { Tg } from "@/components/ui/tag";
import { ActionList } from "@/features/assistant/components/assistant-activity";
import {
  closeRoom,
  createWorkItemFromMessage,
  deleteRoom,
  forkRoom,
  postMessage,
  setParticipant,
  setTurnTaking,
} from "@/features/rooms/actions";
import { ROOM_MESSAGE_MAX, ROOM_MESSAGE_WINDOW, type RoomDetail } from "@/features/rooms/types";
import { attachHeld, searchHeld } from "@/features/files/actions";
import type { HeldItem } from "@/features/files/service";
import { orThrow } from "@/lib/outcome";
import { useAction } from "@/hooks/use-action";
import { useAwp } from "@/hooks/use-awp";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { withSpoken } from "@/hooks/use-voice-input";
import { formatTime } from "@/i18n";
import { sesAr, sesTone } from "@/i18n/vocabulary";
import { useFilterQuery } from "@/hooks/use-filter-query";
import { useBack, useGo } from "@/lib/routes";
import { humanSize } from "@/lib/utils";
import { MirrorRoom } from "./mirror-room-modal";
import { AgentMeta } from "./agent-meta";
import { ApprovalCard } from "./approval-card";
import { ContextPanel } from "./context-panel";
import { ParticipantsPanel } from "./participants-panel";
import { QuestionCard } from "./question-card";
import { StreamingReply } from "./streaming-reply";

/** What S-23 is given: the room, plus what this person has already said about it. */
export type RoomScreen = RoomDetail & {
  /** `UC-23.1-05`: this person's verdict on each message, by message id. */
  feedback: Record<string, string>;
  /** `UC-23.1-11`: why the composer is disabled, in both languages, or null when it is not. */
  postRefusal: { en: string; ar: string } | null;
  mayModerate: boolean;
  /** D392: an admin of the room, or a moderator: adds and removes participants, sets turn-taking. */
  mayManage: boolean;
};

const TURN_TAKING: [string, string, string][] = [
  ["MentionOnly", "Mention only", "عند الإشارة فقط"],
  ["Autonomous", "Autonomous", "مستقل"],
];

/** S-23: one discussion room. */
export function SessionRoom({ detail }: { detail: RoomScreen }) {
  const { t, lang, aName } = useAwp();
  const { act, open } = useModals();
  const go = useGo();
  const back = useBack("sessions");
  const people = usePeople();
  const agents = useAgents();
  const ses = detail.room;
  const policy = TURN_TAKING.find(([value]) => value === detail.turnTaking);
  const [draft, setDraft] = useState("");
  /** The draft text a picker was dismissed on, so Escape and a pick both close it. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState(false);
  const [run, pending] = useAction();
  const toast = useToast();
  // `UC-23.1-07`: the agents a run was just started for, shown in the thread itself until
  // their reply lands. A new message is what clears it — that is the one event that means
  // the run actually finished, one way or another.
  const [working, setWorking] = useState<string[]>([]);
  // The screen holds the room's latest messages, so a new one shows as a new last `seq`.
  const lastSeq = detail.messages.at(-1)?.seq ?? 0;
  const [seenSeq, setSeenSeq] = useState(lastSeq);
  if (lastSeq !== seenSeq) {
    setSeenSeq(lastSeq);
    setWorking([]);
  }
  const filter = useFilterQuery();
  // The server's own view of who has a run still in flight for this room — correct the
  // moment the screen opens or refreshes, not only right after this tab sent a message.
  const workingAgents = [
    ...new Set([...working, ...detail.participants.filter((participant) => participant.working).map((participant) => participant.id)]),
  ];

  // The thread opens on its latest message and moves to each new one, a person's or an
  // agent's. While a reply streams in, it stays at the bottom unless the reader scrolled up.
  const thread = useFollowBottom<HTMLDivElement>(`${lastSeq}:${workingAgents.length}`);

  /**
   * The `@` or `#` being typed: its sigil, where it starts, and what has been typed since.
   * Read from the draft rather than tracked separately, so deleting back into a word
   * reopens the picker the same way typing into it opened it.
   */
  const token = (() => {
    if (draft === dismissed) return null;
    const match = /(^|\s)([@#])([^\s@#]*)$/.exec(draft);
    if (!match) return null;
    return { sigil: match[2] as "@" | "#", at: draft.length - match[3].length - 1, query: match[3].toLowerCase() };
  })();

  type Suggestion = { kind: "Participant" | "Person" | "Agent" | "Artifact" | "File"; value: string; label: string; hint: string };

  /**
   * What `@` writes for a person or an agent: a person's e-mail name, as a comment mention
   * does, or an agent's code, so the message reads as a name rather than an id (D163).
   */
  const handleOf = (id: string) => people.find((person) => person.id === id)?.email.split("@")[0] ?? id;
  /** Older messages named people by id; they read as names too. */
  const named = (text: string) =>
    text.replace(/@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, (whole, id: string) => {
      const name = aName(id);
      return name === id ? whole : `@${name}`;
    });

  // `UC-23.1-07`: what `#` may bring in, searched on the server among the artifacts and
  // project files this person may read, a moment after they stop typing.
  const heldQuery = token?.sigil === "#" ? token.query : null;
  const [held, setHeld] = useState<HeldItem[]>([]);
  useEffect(() => {
    if (heldQuery === null) return;
    let current = true;
    const timer = setTimeout(async () => {
      const [artifacts, projectFiles] = await Promise.all([
        searchHeld({ kind: "Artifact", q: heldQuery }),
        searchHeld({ kind: "File", q: heldQuery }),
      ]);
      if (!current) return;
      setHeld([...(artifacts.ok ? artifacts.value : []), ...(projectFiles.ok ? projectFiles.value : [])]);
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [heldQuery]);

  const suggestions: Suggestion[] = (() => {
    if (!token) return [];
    if (token.sigil === "@") {
      const inRoom = new Set(detail.participants.map((participant) => participant.id));
      const present: Suggestion[] = detail.participants.map((participant) => ({
        kind: "Participant",
        value: participant.id,
        label: aName(participant.id),
        hint: t("In this room", "في هذه الغرفة"),
      }));
      // An admin can tag someone outside the room: choosing them adds them, because a mention
      // that reaches nobody is the one outcome the picker must not produce. Anyone else
      // cannot add people (D392), so for them the picker lists only who is in the room.
      const absent: Suggestion[] = detail.mayManage
        ? [
            ...people.filter((person) => !inRoom.has(person.id)).map<Suggestion>((person) => ({
              kind: "Person",
              value: person.id,
              label: t(person.name, person.nameAr),
              hint: t("Add to room", "إضافة إلى الغرفة"),
            })),
            ...agents.filter((agent) => !inRoom.has(agent.id)).map<Suggestion>((agent) => ({
              kind: "Agent",
              value: agent.id,
              label: t(agent.name, agent.nameAr),
              hint: t("Add to room", "إضافة إلى الغرفة"),
            })),
          ]
        : [];
      return [...present, ...absent]
        .filter((one) => `${one.value} ${one.label}`.toLowerCase().includes(token.query))
        .slice(0, 8);
    }
    return held.slice(0, 8).map<Suggestion>((one) => ({
      kind: one.kind,
      value: one.id,
      label: one.name,
      hint: `${one.project} · ${one.kind === "Artifact" ? t("Artifact", "مخرَج") : t("File", "ملف")}`,
    }));
  })();

  const composer = useRef<HTMLInputElement>(null);

  /** Replaces the half-typed token with the chosen one, and does what choosing it means. */
  const choose = (option: Suggestion) => {
    if (!token) return;
    const sigil = token.sigil;
    const replacement = sigil === "@" ? handleOf(option.value) : option.label.replace(/\s+/g, "_");
    const next = `${draft.slice(0, token.at)}${sigil}${replacement} `;
    setDraft(next);
    setDismissed(next);
    // Typing goes on after what was chosen: a click on the list took the focus, and the
    // caret was left at the start of the box (D168).
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(next.length, next.length);
    });
    if (option.kind === "Person" || option.kind === "Agent") {
      run(async () => {
        orThrow(await setParticipant({ roomKey: ses.key, principal: option.value, action: "Add" }));
        return t(`${option.label} was added to the room.`, `أُضيف ${option.label} إلى الغرفة.`);
      });
      return;
    }
    if (option.kind === "Artifact" || option.kind === "File") {
      run(async () => {
        orThrow(await attachHeld({ ownerType: "Room", ownerKey: ses.key, kind: option.kind as "Artifact" | "File", id: option.value }));
        return t(`${option.label} was attached.`, `أُرفق ${option.label}.`);
      });
    }
  };

  /** `UC-23.1-01` and `-02`: the message is posted, and whoever answers it is brought in. */
  const send = () =>
    run(async () => {
      if (!draft.trim()) return null;
      const outcome = orThrow(await postMessage({ roomKey: ses.key, text: draft }));
      setDraft("");
      setWorking(outcome.started);
      return outcome.note;
    });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", height: "100%", overflow: "hidden" }} className="awp-room">
      <LiveRegion path={`/api/sse/rooms/${ses.key}`} />
      {mirroring && <MirrorRoom roomKey={ses.key} onClose={() => setMirroring(false)} />}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-divider)", background: "var(--surface-raised)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* `UC-23.3-07`: the rooms list opens with the earlier filters kept. */}
          <button className="awp-iconbtn" onClick={back} aria-label={t("Back", "رجوع")}>
            <Ic n={lang === "ar" ? "ArrowRight01Round" : "ArrowLeft01Round"} />
          </button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="awp-row">
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{t(ses.t, ses.tAr)}</h2>
              <Tg tone={sesTone[ses.st]} dot label={t(ses.st, sesAr[ses.st])} />
            </div>
            <div className="awp-small awp-muted">
              <span className="awp-mono">{ses.key}</span> ·{" "}
              {t(
                `Project ${ses.p} — ${detail.projectNameEn} · ${ses.type} · ${policy?.[1] ?? detail.turnTaking} policy`,
                `المشروع ${ses.p} — ${detail.projectNameAr} · ${sesAr[ses.type] ?? ses.type} · سياسة ${policy?.[2] ?? detail.turnTaking}`,
              )}
            </div>
          </div>
          {/* `UC-23.3-05`: a fork is a new room linked to this one. */}
          <Btn
            type="secondary"
            label={t("Fork", "تفرّع")}
            disabled={pending}
            onClick={() =>
              act({
                title: t("Fork this room", "تفريع هذا الاجتماع"),
                desc: t(
                  "A new room is created, linked to this one, carrying over the last of what was said.",
                  "يُنشأ اجتماع جديد مرتبط بهذا، وينقل آخر ما قيل فيه.",
                ),
                fields: [
                  [t("New title", "العنوان الجديد"), `${t(ses.t, ses.tAr)} — ${t("fork", "تفرّع")}`],
                  [t("What should change?", "ما الذي يجب أن يتغير؟"), "", "area"],
                ],
                confirm: t("Fork", "تفرّع"),
                onDone: (values) =>
                  run(async () => {
                    const title = values?.[0]?.trim() || `${ses.t} — fork`;
                    const whatShouldChange =
                      values?.[1]?.trim() || t("Carried over from the original room.", "منقول من الاجتماع الأصلي.");
                    const key = orThrow(await forkRoom({
                      roomKey: ses.key,
                      titleEn: title,
                      titleAr: title,
                      whatShouldChange,
                    }));
                    go("session", { key });
                    return null;
                  }),
              })
            }
          />
          {/* `UC-23.1-13`: a mirrored room carries its messages both ways. */}
          {detail.mayModerate && ses.st !== "Closed" && (
            <Btn type="secondary" label={t("Mirror to a channel", "عكس على قناة")} onClick={() => setMirroring(true)} />
          )}
          {/* `UC-23.3-06`: closing writes the handoff that is the room's final state. */}
          {detail.mayModerate && ses.st !== "Closed" && (
            <Btn
              type="secondary"
              label={t("Close room", "إغلاق الاجتماع")}
              disabled={pending}
              onClick={() =>
                act({
                  title: t("Close room", "إغلاق الاجتماع"),
                  desc: t(
                    "The final context handoff is written and no more messages are taken.",
                    "يُكتب تسليم السياق النهائي ولا تُقبل رسائل بعده.",
                  ),
                  confirm: t("Close room", "إغلاق الاجتماع"),
                  danger: true,
                  onDone: () =>
                    run(async () => {
                      orThrow(await closeRoom({ roomKey: ses.key }));
                      return t("Room closed.", "أُغلق الاجتماع.");
                    }),
                })
              }
            />
          )}
          {detail.mayModerate && (
            <Btn
              type="danger"
              label={t("Delete room", "حذف الاجتماع")}
              disabled={pending}
              onClick={() =>
                act({
                  title: t("Delete room", "حذف الاجتماع"),
                  desc: t(
                    "Every message, participant and work-item link goes with it. Refused while another room was forked from it, a request was raised from it, or a deployment conversation is mirrored into it.",
                    "تُحذف كل رسالة ومشارك وربط ببند عمل معها. يُرفض الحذف إذا تفرّعت منها غرفة أخرى، أو أُنشئ منها طلب، أو ارتبطت بها محادثة نشر.",
                  ),
                  confirm: t("Delete", "حذف"),
                  danger: true,
                  onDone: () =>
                    run(async () => {
                      orThrow(await deleteRoom({ roomKey: ses.key }));
                      go("sessions");
                      return t("Room deleted.", "حُذف الاجتماع.");
                    }),
                })
              }
            />
          )}
        </div>
        <div ref={thread} style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
          {detail.earlier &&
            (detail.messages.length < ROOM_MESSAGE_MAX ? (
              <div style={{ textAlign: "center" }}>
                <Btn
                  type="secondary"
                  label={t("Show earlier messages", "عرض الرسائل السابقة")}
                  disabled={filter.pending}
                  onClick={() => filter.set("show", String(detail.messages.length + ROOM_MESSAGE_WINDOW))}
                />
              </div>
            ) : (
              <p className="awp-small awp-muted" style={{ margin: 0, textAlign: "center" }}>
                {t(
                  `Showing the latest ${ROOM_MESSAGE_MAX} messages.`,
                  `تُعرض آخر ${ROOM_MESSAGE_MAX} رسالة.`,
                )}
              </p>
            ))}
          {detail.messages.map((message) => (
            <Msg
              key={message.id}
              who={message.sender}
              time={formatTime(lang, new Date(message.at))}
              meta={
                message.agentMeta ? (
                  <AgentMeta
                    messageId={message.id}
                    ver={message.agentMeta.version}
                    runKey={message.agentMeta.runKey}
                    given={detail.feedback[message.id] ?? null}
                  />
                ) : undefined
              }
            >
              {message.steps.length > 0 && <ActionList actions={message.steps} t={t} folded />}
              <MsgBody text={named(t(message.en, message.ar))} />
              {message.artifact && (
                <div className="awp-card" style={{ marginTop: 10, padding: 14, display: "flex", gap: 12, alignItems: "center", background: "var(--surface-card)" }}>
                  <Ic n="File01" c="var(--icon-brand)" s={24} />
                  <div style={{ flex: 1 }}>
                    <b>{message.artifact.name}</b>
                    <div className="awp-small awp-muted">{t(message.artifact.noteEn, message.artifact.noteAr)}</div>
                  </div>
                  <Btn
                    type="ghost"
                    label={t("Open", "فتح")}
                    onClick={() => open("preview", { item: { n: message.artifact!.name, w: message.sender, p: ses.p, l: ses.key, s: "—" }, viewOnly: true })}
                  />
                </div>
              )}
              {message.attachment && (
                <div className="awp-card" style={{ marginTop: 10, padding: 14, display: "flex", gap: 12, alignItems: "center", background: "var(--surface-card)" }}>
                  <Ic n="File01" c="var(--icon-brand)" s={24} />
                  <div style={{ flex: 1 }}>
                    <b>{message.attachment.name}</b>
                  </div>
                  <Btn
                    type="ghost"
                    label={t("Open", "فتح")}
                    onClick={() =>
                      open("preview", {
                        item: { n: message.attachment!.name, w: message.sender, p: ses.p, l: ses.key, s: "—" },
                        owner: { type: "Room", key: ses.key },
                        viewOnly: true,
                      })
                    }
                  />
                </div>
              )}
              {message.approval && <ApprovalCard approval={message.approval} mayDecide={message.approval.mayDecide} />}
              {message.question && <QuestionCard question={message.question} />}
              {/* `UC-23.4-03`: a message is where a piece of work is often decided on, whether a
                  person or an agent wrote it (D392). A system note, which has no sender, is not. */}
              {message.sender !== "" && message.en.trim() !== "" && (
                <div className="awp-row" style={{ marginTop: 8, gap: 12 }}>
                  <Lnk
                    onClick={() =>
                      run(async () => {
                        const key = orThrow(await createWorkItemFromMessage({
                          roomKey: ses.key,
                          messageId: message.id,
                          titleEn: message.en.slice(0, 120),
                          titleAr: message.ar.slice(0, 120),
                          descriptionEn: message.en,
                        }));
                        return t(`Created ${key}.`, `أُنشئ ${key}.`);
                      })
                    }
                  >
                    {t("Create work item", "إنشاء بند عمل")}
                  </Lnk>
                  {/* D392: the request form opens with the message as its title and description,
                      and the request keeps this room as its origin. */}
                  <Lnk
                    onClick={() =>
                      open("request", {
                        owner: { type: "Room", key: ses.key },
                        prefill: { projectKey: ses.p, title: message.en.slice(0, 120), description: message.en.slice(0, 4000) },
                      })
                    }
                  >
                    {t("Create request", "إنشاء طلب")}
                  </Lnk>
                </div>
              )}
            </Msg>
          ))}
          {workingAgents.map((agentCode) => {
            const runId = detail.participants.find((participant) => participant.id === agentCode)?.runId ?? null;
            return (
              <Msg key={agentCode} who={agentCode} time="">
                {runId ? (
                  <StreamingReply key={runId} runId={runId} agentName={aName(agentCode)} />
                ) : (
                  <p className="awp-muted" style={{ margin: 0, fontStyle: "italic" }}>
                    {t(`${aName(agentCode)} is working…`, `${aName(agentCode)} يعمل…`)}
                  </p>
                )}
              </Msg>
            );
          })}
          {detail.waitingQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
          {!detail.messages.length && !workingAgents.length && (
            <p className="awp-muted" style={{ margin: 0 }}>{t("No messages yet. Mention an agent in the room to address it.", "لا توجد رسائل بعد. أشر إلى وكيل في الغرفة لمخاطبته.")}</p>
          )}
        </div>
        <div className="awp-fab-clear" style={{ paddingBlock: 16, paddingInlineStart: 16, borderTop: "1px solid var(--border-divider)", background: "var(--surface-raised)" }}>
          <div className="awp-row" style={{ gap: 10, position: "relative" }}>
            {/* `UC-23.1-06` and `-07`: `@` names who the message reaches, `#` brings in
                something the platform already holds. Both are pickers rather than a
                convention a person has to know and spell exactly. */}
            {token && (
              <div
                className="awp-card"
                role="listbox"
                aria-label={token.sigil === "@" ? t("Mention", "إشارة") : t("Embed", "تضمين")}
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 5,
                  minWidth: 280,
                  maxHeight: 260,
                  overflow: "auto",
                  padding: 4,
                }}
              >
                {suggestions.length === 0 && (
                  <p className="awp-small awp-muted" style={{ margin: 0, padding: 10 }}>
                    {t("Nothing matches.", "لا شيء يطابق.")}
                  </p>
                )}
                {suggestions.map((option) => (
                  <button
                    key={`${option.kind}:${option.value}`}
                    role="option"
                    aria-selected={false}
                    className="awp-row"
                    style={{ width: "100%", gap: 8, padding: "8px 10px", border: 0, background: "transparent", cursor: "pointer", textAlign: "start" }}
                    onClick={() => choose(option)}
                  >
                    <Ic n={option.kind === "File" || option.kind === "Artifact" ? "File01" : "User"} s={16} />
                    <span style={{ flex: 1 }}>{option.label}</span>
                    <span className="awp-small awp-muted">{option.hint}</span>
                  </button>
                ))}
              </div>
            )}
            {/* `UC-23.1-07`: a file reaches the room's board the same way a message does: from
                this computer, or one the platform already holds, as `#` embeds it. */}
            <button
              className="awp-iconbtn"
              disabled={detail.postRefusal !== null}
              aria-label={t("Add attachment", "إضافة مرفق")}
              title={t("Add attachment", "إضافة مرفق")}
              onClick={() =>
                open("upload", { owner: { type: "Room", key: ses.key } })
              }
            >
              <Ic n="AttachL" />
            </button>
            {/* D386: spoken text joins the draft, which is sent like typed text. */}
            <VoiceButton
              disabled={detail.postRefusal !== null}
              onText={(spoken) => setDraft((current) => withSpoken(current, spoken))}
              onProblem={(message) => toast.say(message, "bad")}
            />
            <input
              ref={composer}
              className="awp-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && token) {
                  e.preventDefault();
                  setDismissed(draft);
                  return;
                }
                if (e.key === "Enter") {
                  if (token && suggestions.length > 0) {
                    e.preventDefault();
                    choose(suggestions[0]);
                    return;
                  }
                  send();
                }
              }}
              disabled={detail.postRefusal !== null}
              aria-label={t("Message the room", "اكتب رسالة")}
              placeholder={
                // `UC-23.1-11`: the composer says why it is disabled rather than just being so.
                (detail.postRefusal && t(detail.postRefusal.en, detail.postRefusal.ar)) ??
                t(
                  "Message the room — @ to tag a person or agent, # to embed a file",
                  "اكتب رسالة — @ للإشارة إلى شخص أو وكيل، # لتضمين ملف",
                )
              }
            />
            <Btn label={t("Send", "إرسال")} disabled={pending || detail.postRefusal !== null || draft.trim() === ""} onClick={send} />
          </div>
        </div>
      </div>
      <aside style={{ borderInlineStart: "1px solid var(--border-divider)", background: "var(--surface-raised)", overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
        <ParticipantsPanel roomKey={ses.key} participants={detail.participants} mayManage={detail.mayManage} />
        <div>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900 }}>{t("Turn-taking", "تبادل الأدوار")}</h4>
          {/* `UC-23.3-01` … `-03`: the room's admins set it (D392); everybody else reads the policy. */}
          <PopSelect
            className="awp-input"
            value={detail.turnTaking}
            disabled={!detail.mayManage || pending}
            aria-label={t("Turn-taking", "تبادل الأدوار")}
            onChange={(event) =>
              run(async () => {
                orThrow(await setTurnTaking({ roomKey: ses.key, turnTaking: event.target.value, version: ses.version }));
                return t("Turn-taking saved.", "تم حفظ تبادل الأدوار.");
              })
            }
          >
            {TURN_TAKING.map(([value, en, ar]) => (
              <option key={value} value={value}>
                {t(en, ar)}
              </option>
            ))}
          </PopSelect>
        </div>
        <ContextPanel usage={detail.contextUsage} />
        <div>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900 }}>{t("Linked work items", "بنود العمل المرتبطة")}</h4>
          {detail.linkedWorkItems.length ? (
            detail.linkedWorkItems.map((item) => (
              <button
                key={item.key}
                className="awp-card"
                onClick={() => go("tasks", { open: item.key })}
                style={{ width: "100%", padding: 12, textAlign: "start", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}
              >
                <span className="awp-mono awp-muted">{item.key}</span>
                <span style={{ flex: 1 }}>{t(item.titleEn, item.titleAr)}</span>
              </button>
            ))
          ) : (
            <span className="awp-muted awp-small">{t("None yet.", "لا شيء بعد.")}</span>
          )}
        </div>
        <div>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 900 }}>{t("Files", "الملفات")}</h4>
          {detail.files.length ? (
            <div className="awp-col" style={{ gap: 8 }}>
              {detail.files.map((file) => (
                <button
                  key={`${file.kind}-${file.name}`}
                  className="awp-card"
                  style={{ width: "100%", padding: 10, textAlign: "start", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}
                  onClick={() =>
                    open("preview", {
                      item: {
                        n: file.name,
                        kind: file.kind,
                        w: file.by ? aName(file.by) : "—",
                        p: ses.p,
                        l: ses.key,
                        s: file.size ? humanSize(file.size) : "—",
                        mimeType: file.mimeType ?? undefined,
                      },
                      ...(file.kind === "attachment" ? { owner: { type: "Room" as const, key: ses.key } } : {}),
                      viewOnly: true,
                    })
                  }
                >
                  <Ic n="File01" c="var(--icon-brand)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                    <div className="awp-small awp-muted">
                      {file.kind === "artifact" ? t("Generated", "مُولَّد") : t("Uploaded", "مرفوع")}
                      {file.by ? ` · ${aName(file.by)}` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <span className="awp-muted awp-small">{t("None yet.", "لا شيء بعد.")}</span>
          )}
        </div>
      </aside>
    </div>
  );
}
