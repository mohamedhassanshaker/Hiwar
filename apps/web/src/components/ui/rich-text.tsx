"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMemo, useState } from "react";

import { useAwp } from "@/hooks/use-awp";

// Built once: `useEditor` compares its options on every render, and a changed option resets
// the editor's state onto the page, which moved the caret away from where a person clicked.
const EXTENSIONS = [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } })];

/**
 * A rich text field (D247): bold, italic, underline, a heading, lists and links, with
 * `{{placeholder}}` chips that insert at the caret. It edits HTML; whoever stores the HTML
 * sanitises it, because the field cannot stop anybody posting what they like.
 */
export function RichText({
  value,
  onChange,
  label,
  dir,
  placeholders = [],
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  dir?: "rtl" | "ltr";
  placeholders?: string[];
}) {
  const { t } = useAwp();
  // The value the field opens with; later values come from the editor itself.
  const [initial] = useState(value);
  const editorProps = useMemo(() => ({ attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true", ...(dir ? { dir } : {}) } }), [label, dir]);
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial,
    // The console renders on the server first, where there is no editor to draw.
    immediatelyRender: false,
    editorProps,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      heading: current?.isActive("heading", { level: 2 }) ?? false,
      bullets: current?.isActive("bulletList") ?? false,
      numbers: current?.isActive("orderedList") ?? false,
      link: current?.isActive("link") ?? false,
    }),
  });

  const link = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt(t("Link address", "عنوان الرابط"), "https://");
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const tools: [keyof NonNullable<typeof active>, string, string, () => void][] = editor
    ? [
        ["bold", "B", t("Bold", "غامق"), () => editor.chain().focus().toggleBold().run()],
        ["italic", "I", t("Italic", "مائل"), () => editor.chain().focus().toggleItalic().run()],
        ["underline", "U", t("Underline", "تسطير"), () => editor.chain().focus().toggleUnderline().run()],
        ["heading", "H", t("Heading", "عنوان"), () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
        ["bullets", "•", t("Bulleted list", "قائمة نقطية"), () => editor.chain().focus().toggleBulletList().run()],
        ["numbers", "1.", t("Numbered list", "قائمة مرقمة"), () => editor.chain().focus().toggleOrderedList().run()],
        ["link", t("Link", "رابط"), t("Link", "رابط"), link],
      ]
    : [];

  return (
    <div className="awp-rich">
      <div className="awp-rich-bar" role="toolbar" aria-label={label}>
        {tools.map(([key, glyph, name, run]) => (
          <button key={key} type="button" className={active?.[key] ? "on" : ""} aria-label={name} aria-pressed={active?.[key] ?? false} title={name} onClick={run}>
            {glyph}
          </button>
        ))}
        {placeholders.map((name) => (
          <button key={name} type="button" className="awp-mono" title={t("Insert", "إدراج")} onClick={() => editor?.chain().focus().insertContent(`{{${name}}}`).run()}>
            {`{{${name}}}`}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
