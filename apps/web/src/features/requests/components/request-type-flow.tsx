"use client";

import dagre from "@dagrejs/dagre";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";

import { Modal } from "@/components/ui/overlay";
import type { RequestStep } from "@/features/requests/types";
import { useAwp } from "@/hooks/use-awp";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 72;

type StepNode = Node<{ order: number; name: string; who: string; terminal: boolean }, "step">;

/** One step: its place in the order, its name and who acts on it, or that it ends the request. */
function StepBox({ data }: NodeProps<StepNode>) {
  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        padding: "10px 14px",
        borderRadius: 12,
        border: `1px solid ${data.terminal ? "var(--border-divider)" : "var(--border-selected)"}`,
        background: data.terminal ? "var(--surface-sunken)" : "var(--surface-card)",
        color: "var(--text-primary)",
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
      <div style={{ fontWeight: 500 }} dir="auto">
        <span className="awp-mono awp-muted">{data.order} </span>
        {data.name}
      </div>
      <div className="awp-small awp-muted" dir="auto">{data.who}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { step: StepBox };

/**
 * D317: the request type's steps as nodes and its routing rules as labelled arrows, laid out top
 * to bottom from the first step. Read only: it is drawn from the version the designer shows. It
 * opens on the first steps at a readable size; the controls fit the whole flow.
 */
export function RequestTypeFlow({ steps, onClose }: { steps: RequestStep[]; onClose: () => void }) {
  const { t } = useAwp();
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 72 });
  graph.setDefaultEdgeLabel(() => ({}));
  steps.forEach((step) => graph.setNode(step.n, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  const rules = steps.flatMap((step) =>
    step.out.filter(([, , to]) => steps.some((one) => one.n === to)).map(([when, , to], index) => ({ id: `${step.n}#${index}`, from: step.n, to, when })),
  );
  rules.forEach((rule) => graph.setEdge(rule.from, rule.to));
  dagre.layout(graph);

  const nodes: StepNode[] = steps.map((step, index) => {
    const { x, y } = graph.node(step.n);
    const terminal = step.isTerminal || (step.aud.length === 0 && step.out.length === 0);
    return {
      id: step.n,
      type: "step",
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: {
        order: index + 1,
        name: t(step.n, step.nAr),
        who: terminal ? t("Ends the request", "ينهي الطلب") : step.aud.map(([en, ar]) => t(en, ar)).join(", "),
        terminal,
      },
    };
  });
  const edges: Edge[] = rules.map((rule) => ({
    id: rule.id,
    source: rule.from,
    target: rule.to,
    label: rule.when,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--icon-secondary)" },
    style: { stroke: "var(--icon-secondary)" },
    labelStyle: { fill: "var(--text-secondary)", fontSize: 12 },
    labelBgStyle: { fill: "var(--surface-card)" },
  }));

  return (
    <Modal title={t("Workflow", "سير العمل")} onClose={onClose} w={1100}>
      <div style={{ height: "min(70vh, 680px)", borderRadius: 12, background: "var(--surface-page)" }} dir="ltr">
        {steps.length === 0 ? (
          <p className="awp-muted" style={{ margin: 0, padding: 20 }}>{t("This version has no steps yet.", "لا توجد خطوات في هذا الإصدار بعد.")}</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            fitView
            fitViewOptions={{ nodes: nodes.slice(0, 4), maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background color="var(--border-divider)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </Modal>
  );
}
