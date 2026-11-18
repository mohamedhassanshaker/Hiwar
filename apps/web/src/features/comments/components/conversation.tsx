"use client";

import { useEffect, useRef, useState } from "react";

import { useDirectory } from "@/components/shared/directory";
import { Ic } from "@/components/ui/icon";
import { Who } from "@/components/ui/avatar";
import { deleteComment, editComment } from "@/features/comments/actions";
import type { Comment, CommentThread, Mentionable } from "@/features/comments/types";
import { useAwp } from "@/hooks/use-awp";
import { useAgo } from "@/hooks/use-client-now";
import { workItemStatus } from "@/i18n/vocabulary";
import { useGo } from "@/lib/routes";
import { mentionNames, mentionsIn } from "./composer";
import { MakeTaskForm, soundsLikeARequest } from "./make-task";

/**
 * One card's conversation (handoff v2 sections 5.1 and 5.2).
 *
 * Own comments can be edited or deleted; somebody else's can be turned into a task. A
 * deleted comment leaves a line saying so rather than a hole, because a thread that
 * silently loses a message reads as though the reply below it answers nothing.
 */

/** The text with every `@name` marked, so a mention is visible as one. */
function Marked({ text, people }: { text: string; people: Mentionable[] }) {
  const names = mentionNames(people).map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (names.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(@(?:${names.join("|")}))`, "g");
  return (
    <>
      {text.split(pattern).map((piece, index) =>
        index % 2 ? (
          <span key={index} className="qr-at">
            {piece}
          </span>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/**
 * Renders one card's comments, oldest first, scrolled to the newest. The author may edit or delete
 * their own comment; somebody else's can be turned into a task when the reader may raise tasks,
 * with the offer promoted when the comment reads as a request. Renders nothing for an empty
 * thread; `onChanged` is called after each edit, delete or task.
 */
export function Conversation({
  thread,
  people,
  mayRaiseTasks,
  onChanged,
}: {
  thread: CommentThread;
  people: Mentionable[];
  mayRaiseTasks: boolean;
  onChanged: () => void;
}) {
  const { t, aName } = useAwp();
  const { ago } = useAgo();
  const { me } = useDirectory();
  const go = useGo();
  const list = useRef<HTMLOListElement>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [raising, setRaising] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // A new message belongs at the bottom, in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [thread.comments.length]);

  if (thread.comments.length === 0) return null;

  const save = async (comment: Comment, text: string) => {
    await editComment({ commentId: comment.id, body: text, mentions: mentionsIn(text, people).map((person) => person.id) });
    setEditing(null);
    onChanged();
  };
  const remove = async (comment: Comment) => {
    await deleteComment({ commentId: comment.id });
    setRemoving(null);
    onChanged();
  };

  return (
    <ol
      className={"qr-conv" + (editing || removing || raising ? " is-editing" : "")}
      ref={list}
      aria-label={t("Conversation", "المحادثة")}
    >
      {thread.comments.map((comment) => {
        const mine = comment.authorId === me.id;
        const gone = comment.deletedAt !== null;
        const suggestion = !gone && !mine && !comment.task && soundsLikeARequest(comment.bodyText);
        const canRaise = mayRaiseTasks && !gone && !mine && !comment.task;
        const underEdit = editing?.id === comment.id;
        return (
          <li key={comment.id} className={"qr-msg" + (mine ? " is-me" : "") + (gone ? " is-deleted" : "")}>
            <Who id={comment.authorId} s={32} />
            <div className="qr-msg-b">
              <div className="qr-msg-h">
                <b>{mine ? t("You", "أنت") : aName(comment.authorId)}</b>
                <span className="qr-meta">
                  {comment.editedAt && !gone && (
                    <span className="qr-flag" title={t("Edited", "مُعدّل")}>
                      <Ic n="PencilEdit01" s={12} c="currentColor" />
                      {t("Edited", "مُعدّل")}
                    </span>
                  )}
                  <span>{ago(comment.at)}</span>
                </span>
              </div>

              {!gone && !underEdit && removing !== comment.id && raising !== comment.id && (canRaise || mine) && (
                <div className="qt-acts">
                  {canRaise && !suggestion && (
                    <button className="qt-mk" onClick={() => setRaising(comment.id)}>
                      <Ic n="AddCircle" s={14} c="currentColor" />
                      {t("Make it a task", "حوّله إلى مهمة")}
                    </button>
                  )}
                  {mine && (
                    <button
                      className="qt-ib"
                      onClick={() => {
                        setRemoving(null);
                        setEditing({ id: comment.id, text: comment.bodyText });
                      }}
                      aria-label={t("Edit comment", "تعديل التعليق")}
                      title={t("Edit", "تعديل")}
                    >
                      <Ic n="PencilEdit01" s={16} c="currentColor" />
                    </button>
                  )}
                  {mine && (
                    <button
                      className="qt-ib is-del"
                      onClick={() => {
                        setEditing(null);
                        setRemoving(comment.id);
                      }}
                      aria-label={t("Delete comment", "حذف التعليق")}
                      title={t("Delete", "حذف")}
                    >
                      <Ic n="DeleteDS" s={16} c="currentColor" />
                    </button>
                  )}
                </div>
              )}

              {underEdit ? (
                <div className="qr-ed">
                  <textarea
                    autoFocus
                    value={editing.text}
                    rows={2}
                    aria-label={t("Edit comment", "تعديل التعليق")}
                    onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setEditing(null);
                      }
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && editing.text.trim()) {
                        event.preventDefault();
                        void save(comment, editing.text.trim());
                      }
                    }}
                  />
                  <div className="qr-ed-a">
                    <button className="d3-pill" onClick={() => setEditing(null)}>
                      {t("Cancel", "إلغاء")}
                    </button>
                    <button className="d3t-next" disabled={!editing.text.trim()} onClick={() => void save(comment, editing.text.trim())}>
                      {t("Save", "حفظ")}
                    </button>
                  </div>
                </div>
              ) : gone ? (
                <p className="qr-gone">
                  <Ic n="DeleteDS" s={14} c="currentColor" />
                  {mine
                    ? t("You deleted this comment", "حذفت هذا التعليق")
                    : t(`${aName(comment.authorId)} deleted a comment`, `${aName(comment.authorId)} حذف تعليقاً`)}
                  <span className="qr-gone-t">
                    · {ago(comment.deletedAt as string)}
                  </span>
                </p>
              ) : (
                comment.bodyText && (
                  <p>
                    <Marked text={comment.bodyText} people={people} />
                  </p>
                )
              )}

              {removing === comment.id && (
                <div className="qr-del" role="alertdialog" aria-label={t("Delete this comment?", "حذف هذا التعليق؟")}>
                  <span>{t("Delete this comment? This can’t be undone.", "حذف هذا التعليق؟ لا يمكن التراجع.")}</span>
                  <div className="qr-ed-a">
                    <button
                      className="d3-pill"
                      autoFocus
                      onClick={() => setRemoving(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setRemoving(null);
                        }
                      }}
                    >
                      {t("Cancel", "إلغاء")}
                    </button>
                    <button className="qr-del-b" onClick={() => void remove(comment)}>
                      {t("Delete", "حذف")}
                    </button>
                  </div>
                </div>
              )}

              {comment.captureUrl && (
                <button className="qr-shot" onClick={() => setZoom(comment.captureUrl)} aria-label={t("View captured area", "عرض المنطقة الملتقطة")}>
                  {/* Served by `/api/comments/capture`, which decides who may read it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={comment.captureUrl} alt={t("Captured area of the card", "منطقة ملتقطة من البطاقة")} />
                </button>
              )}

              {suggestion && canRaise && raising !== comment.id && (
                <div className="qt-sug">
                  <span className="qt-sug-t">
                    <Ic n="AssistantDS" s={16} c="var(--icon-brand)" />
                    {t("Sounds like a request", "يبدو أنه طلب")}
                  </span>
                  <button className="qt-sug-b" onClick={() => setRaising(comment.id)}>
                    <Ic n="AddCircle" s={14} c="currentColor" />
                    {t("Make it a task", "حوّله إلى مهمة")}
                  </button>
                </div>
              )}

              {raising === comment.id && (
                <MakeTaskForm
                  comment={comment}
                  people={people}
                  onClose={() => setRaising(null)}
                  onCreated={() => {
                    setRaising(null);
                    onChanged();
                  }}
                />
              )}

              {comment.task && (
                <button
                  className={"qt-tag" + (comment.task.status === "Done" ? " is-done" : "")}
                  onClick={() => go("tasks", { open: comment.task?.key })}
                >
                  <Ic n="TickCircle" s={14} c="currentColor" />
                  {t("Task created", "تم إنشاء مهمة")} · {comment.task.key}
                  {workItemStatus[comment.task.status] ? ` · ${t(...workItemStatus[comment.task.status])}` : ""}
                </button>
              )}
            </div>
          </li>
        );
      })}
      {zoom && (
        <li className="qr-zoom" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt={t("Captured area of the card", "منطقة ملتقطة من البطاقة")} />
          <button className="qr-x" aria-label={t("Close", "إغلاق")} onClick={() => setZoom(null)}>
            <Ic n="Cancel01" s={16} c="#fff" />
          </button>
        </li>
      )}
    </ol>
  );
}
