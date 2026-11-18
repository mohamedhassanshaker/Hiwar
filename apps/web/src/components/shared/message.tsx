"use client";

import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDirectory } from "@/components/shared/directory";
import { Tg } from "@/components/ui/tag";
import { Who } from "@/components/ui/avatar";
import { useAwp } from "@/hooks/use-awp";

/**
 * Styled inline rather than through `globals.css`: that file is a verbatim copy of the
 * design handoff's own style block (`tests/handoff-delta.test.ts`), so a console-only need
 * like Markdown spacing has to live beside the component that needs it.
 */
const MARKDOWN_COMPONENTS: Components = {
  p: (props: ComponentProps<"p">) => <p {...props} style={{ margin: "0 0 10px" }} />,
  h1: (props: ComponentProps<"h1">) => <h1 {...props} style={{ margin: "16px 0 8px", fontSize: 20, fontWeight: 900, lineHeight: 1.3 }} />,
  h2: (props: ComponentProps<"h2">) => <h2 {...props} style={{ margin: "16px 0 8px", fontSize: 17, fontWeight: 900, lineHeight: 1.3 }} />,
  h3: (props: ComponentProps<"h3">) => <h3 {...props} style={{ margin: "16px 0 8px", fontSize: 15, fontWeight: 900, lineHeight: 1.3 }} />,
  ul: (props: ComponentProps<"ul">) => <ul {...props} style={{ margin: "0 0 10px", paddingInlineStart: 22 }} />,
  ol: (props: ComponentProps<"ol">) => <ol {...props} style={{ margin: "0 0 10px", paddingInlineStart: 22 }} />,
  li: (props: ComponentProps<"li">) => <li {...props} style={{ margin: "2px 0" }} />,
  blockquote: (props: ComponentProps<"blockquote">) => (
    <blockquote
      {...props}
      style={{ margin: "0 0 10px", paddingInlineStart: 12, borderInlineStart: "3px solid var(--border-divider)", color: "var(--text-secondary)" }}
    />
  ),
  pre: (props: ComponentProps<"pre">) => (
    <pre {...props} style={{ margin: "0 0 10px", background: "var(--surface-sunken)", padding: "10px 12px", borderRadius: 8, overflow: "auto" }} />
  ),
  table: (props: ComponentProps<"table">) => <table {...props} className="awp-tbl" style={{ marginBottom: 10 }} />,
};

/** An agent's reply is Markdown; a plain string from a person reads the same either way. */
export function MsgBody({ text }: { text: string }) {
  return (
    <div style={{ lineHeight: 1.7 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A chat bubble in a discussion room. */
export function Msg({ who, time, children, meta }: { who: string; time: ReactNode; children?: ReactNode; meta?: ReactNode }) {
  const { t, aName } = useAwp();
  const { agents } = useDirectory();
  const isAgent = !!agents.find((a) => a.id === who);
  return (
    <div className="awp-row" style={{ alignItems: "flex-start", gap: 12 }}>
      <Who id={who} s={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="awp-row" style={{ gap: 8 }}>
          <b>{aName(who)}</b>
          {isAgent && <Tg tone="brand" label={t("Agent", "وكيل")} />}
          <span className="awp-small awp-muted">{time}</span>
        </div>
        <div style={{ marginTop: 4 }}>{children}</div>
        {meta}
      </div>
    </div>
  );
}
