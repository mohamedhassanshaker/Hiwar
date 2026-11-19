"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { useGo, type Go, type ScreenId } from "@/lib/routes";

/** An item shown by the preview modal (artifacts, files and attachments). */
export type PreviewItem = {
  n: string;
  /** Which store it came from. An attachment is read through the item it is on. */
  kind?: "artifact" | "file" | "attachment";
  s: string;
  p: string;
  w: string;
  l?: string;
  /** A project file's scope of use, and for `Selected` its grants as names and as ids. */
  scope?: string;
  grants?: string[];
  grantIds?: string[];
  st?: string;
  /** `UC-32.1-06`: what the bytes are, which decides whether the preview can draw them. */
  mimeType?: string;
  /** `UC-32.1-03`: the run that produced an artifact, and the agent that ran it. */
  runKey?: string;
  runAgent?: string;
};

export type ActionField = [label: string, value: string, kind?: "area" | "select", options?: string[]];

/** The shape `ACTS` entries and ad-hoc `act(...)` callers build. */
export type ActionDef = {
  title: string;
  desc?: string;
  danger?: boolean;
  confirm?: string;
  fields?: ActionField[];
  checks?: string[];
  result?: string[];
  code?: string;
  upload?: boolean;
  preview?: boolean;
  body?: ReactNode;
  go?: ScreenId;
  // `fields`, in the order given, as the person left them when they confirmed — empty for
  // an action with no fields, since nothing was there to type into.
  // `false` (a refused `useAction` act) keeps the dialog open instead of saying Done.
  onDone?: (values?: string[]) => void | Promise<boolean>;
};

/** The modals the AI capabilities open by key. */
export type ModalKey = "act" | "importSkill" | "skill";

export type ModalExtras = {
  /** The record the modal is about, when it opens on one rather than on a blank form. */
  id?: string;
  label?: string;
  def?: ActionDef;
  name?: string;
  item?: PreviewItem;
  /** The request, work item or room a modal is about, when it opens on one (`UC-25.1-03`). */
  owner?: { type: "Request" | "WorkItem" | "Room"; key: string };
  /** A New request opened on a room message: the project, title and description it starts with. */
  prefill?: { projectKey: string; title: string; description: string };
  /** A preview opened to read the file, not to manage it: no details, status or delete. */
  viewOnly?: boolean;
  onCreate?: (name: string) => void;
  /** The New request type modal's answer: everything it asked for, not only the name. */
  onCreateRequestType?: (input: { name: string; code: string; categoryEn: string; decomposition: string }) => void;
};

export type ModalProps = ModalExtras & { onClose: () => void; go: Go };
export type ModalRegistry = Record<ModalKey, ComponentType<ModalProps>>;

type Modals = {
  open: (key: ModalKey | null, props?: ModalExtras) => void;
  act: (label: string | ActionDef) => void;
};

const ModalsContext = createContext<Modals | null>(null);

/**
 * Holds the one open modal and renders it from `registry` after its children. Provides `open`
 * and `act` (the generic action dialog), and
 * returns focus to the element that had it when the modal closes.
 */
export function ModalProvider({ registry, children }: { registry: ModalRegistry; children: ReactNode }) {
  const [current, setCurrent] = useState<{ k: ModalKey; p: ModalExtras } | null>(null);
  const go = useGo();
  // COM-16: whatever had the keyboard when a modal opened gets it back when it closes.
  const opener = useRef<Element | null>(null);

  const open = useCallback<Modals["open"]>((key, props) => {
    if (key) opener.current = document.activeElement;
    setCurrent(key ? { k: key, p: props || {} } : null);
  }, []);

  const act = useCallback<Modals["act"]>(
    (label) => open("act", typeof label === "string" ? { label } : { def: label }),
    [open],
  );

  const close = useCallback(() => {
    setCurrent(null);
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }, []);
  const value = useMemo(() => ({ open, act }), [open, act]);
  const Modal = current && registry[current.k];

  return (
    <ModalsContext.Provider value={value}>
      {children}
      {Modal && <Modal {...current.p} onClose={close} go={go} />}
    </ModalsContext.Provider>
  );
}

/** The modal controls; throws when called outside `ModalProvider`. */
export function useModals(): Modals {
  const ctx = useContext(ModalsContext);
  if (!ctx) throw new Error("useModals must be used inside ModalProvider");
  return ctx;
}
