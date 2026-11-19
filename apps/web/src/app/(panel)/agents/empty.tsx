"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { newAgentAction } from "./actions";

export function EmptyAgents() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <div className="page-head">
        <div className="t">
          <h1 className="h1">Agents</h1>
          <p className="lead">Set the persona, knowledge, tools and guardrails once. Publish a version and pin it to any deployment.</p>
        </div>
      </div>
      <div className="empty">
        <span className="b">No agents yet</span>
        <span className="sm muted">Create your first agent, test it with the console, then publish it.</span>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await newAgentAction();
              if (r.ok && r.data) router.push(`/agents/${r.data}`);
            })
          }
        >
          <i className="i i-plus" /> New agent
        </button>
      </div>
    </>
  );
}
