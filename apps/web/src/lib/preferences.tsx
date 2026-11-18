"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { dirOf, translate, type Lang, type Translate } from "@/i18n";

export type Theme = "light" | "dark";

export const LANG_KEY = "awp.lang";
export const THEME_KEY = "awp.theme";

type Snapshot = { lang: Lang; theme: Theme };

type Preferences = Snapshot & {
  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  t: Translate;
};

/**
 * `<html>` is the store: the inline boot script puts the stored language and theme on it
 * before the first paint, and the toggles write back to it and to localStorage. Reading
 * through `useSyncExternalStore` lets the server and the hydration pass use the defaults
 * and the client re-read straight afterwards, so there is no hydration mismatch.
 */
const SERVER_SNAPSHOT: Snapshot = { lang: "en", theme: "light" };
let snapshot: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

/** Adds a listener that `write` calls, and returns its removal. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The language and theme on `<html>`. The same object is returned until either changes, as
 * `useSyncExternalStore` requires.
 */
function getSnapshot(): Snapshot {
  const html = document.documentElement;
  const lang: Lang = html.lang === "ar" ? "ar" : "en";
  const theme: Theme = html.dataset.theme === "dark" ? "dark" : "light";
  if (snapshot.lang !== lang || snapshot.theme !== theme) snapshot = { lang, theme };
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

/** Stores a preference in localStorage when it can, and notifies the subscribers. */
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the document attributes still carry the preference.
  }
  listeners.forEach((listener) => listener());
}

const PreferencesContext = createContext<Preferences | null>(null);

/**
 * Provides the language, the theme, their setters and the translator. A setter writes the value to
 * `<html>` and localStorage. On mount it shows the document the boot script may have hidden.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { lang, theme } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // The boot script hides the document when the stored values differ from the defaults.
  useEffect(() => {
    document.documentElement.style.visibility = "";
  }, []);

  const setLang = useCallback((next: Lang) => {
    const html = document.documentElement;
    html.lang = next;
    html.dir = dirOf(next);
    write(LANG_KEY, next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    write(THEME_KEY, next);
  }, []);

  const t = useMemo<Translate>(() => translate(lang), [lang]);

  const value = useMemo(() => ({ lang, theme, setLang, setTheme, t }), [lang, theme, setLang, setTheme, t]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/** The preferences context. Throws outside `PreferencesProvider`. */
export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
