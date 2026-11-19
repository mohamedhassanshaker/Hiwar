"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Dialog } from "@/components/dialog";
import { createAction } from "./actions";

export function NewDeployment({ agents, label = "New deployment" }: { agents: { id: string; name: string }[]; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <i className="i i-plus" /> {label}
      </button>
      <Dialog
        open={open}
        title="New deployment"
        description="A deployment installs one agent on one website. It starts as Draft."
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn outline" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="btn"
              disabled={pending || !name.trim() || !agentId}
              onClick={() =>
                start(async () => {
                  const r = await createAction(name, agentId);
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  router.push(`/deployments/${r.data}`);
                })
              }
            >
              Create
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="nd-name">Name</label>
          <input id="nd-name" className="input" placeholder="Order site · Dubai" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nd-agent">Agent</label>
          <select id="nd-agent" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {error && <p className="err">{error}</p>}
      </Dialog>
    </>
  );
}
