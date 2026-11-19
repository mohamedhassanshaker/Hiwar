"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { PermissionCode } from "@/authz/permissions";
import type { Agent, Directory, Person, Project } from "@/types/directory";

/**
 * The console layout reads the signed-in person, the agents, the people and the projects
 * once on the server and puts them here. `useAwp().aName`, `<Who>`, the project pickers and
 * the shell all read them from this context, so a client component never fetches them and
 * never imports a hard-coded record.
 */
const DirectoryContext = createContext<Directory | null>(null);

/** Provides the directory the console layout loaded on the server to its client components. */
export function DirectoryProvider({ value, children }: { value: Directory; children: ReactNode }) {
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

/** The directory; throws when called outside `DirectoryProvider`. */
export function useDirectory(): Directory {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error("useDirectory must be used inside DirectoryProvider");
  return ctx;
}

/** The directory's agents. */
export function useAgents(): Agent[] {
  return useDirectory().agents;
}

/** The directory's people. */
export function usePeople(): Person[] {
  return useDirectory().people;
}

/** The directory's projects. */
export function useProjects(): Project[] {
  return useDirectory().projects;
}

/**
 * Whether the signed-in person may do something, for deciding whether to render a control.
 *
 * `{may('agents:write') && <Btn label="New Agent" />}` — the scenarios that ask for a
 * control to be "hidden" or "not offered" for a role are these. It answers "somewhere",
 * not "here", so a person who may act in one org unit still sees the control and is
 * refused by the server where they may not.
 */
export function useMay(): (permission: PermissionCode) => boolean {
  const held = useDirectory().may;
  return (permission) => held.includes(permission);
}
