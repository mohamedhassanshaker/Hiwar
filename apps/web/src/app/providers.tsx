"use client";

import type { ReactNode } from "react";

import "@/lib/zod-config";
import { PreferencesProvider } from "@/lib/preferences";

/** Language and theme, which every page needs — signed in or not. */
export function Providers({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}
