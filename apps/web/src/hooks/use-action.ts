"use client";

import { useCallback, useTransition } from "react";

import { useToast } from "@/components/shared/toast";
import { useAwp } from "@/hooks/use-awp";

/** What one act of a screen does and says. Returning nothing says nothing. */
export type Act = () => Promise<string | null | undefined | void>;

/**
 * Runs one act of a screen and reports what it said.
 *
 * The message it returns is raised as a toast; a refusal — thrown by `orThrow`, or raised
 * anywhere inside the act — is raised as a danger toast in the console's language. The
 * transition is the same one a screen already used to disable its buttons, so `pending`
 * means what it meant before. `run` resolves true once the act completed and false when it
 * was refused, so a dialog says Done only after the server agreed (D355).
 */
export function useAction(): [run: (act: Act) => Promise<boolean>, pending: boolean] {
  const { say } = useToast();
  const { why } = useAwp();
  const [pending, start] = useTransition();

  const run = useCallback(
    (act: Act) =>
      new Promise<boolean>((resolve) =>
        start(async () => {
          try {
            say(await act(), "ok");
            resolve(true);
          } catch (problem) {
            say(why(problem), "bad");
            resolve(false);
          }
        }),
      ),
    [say, why],
  );

  return [run, pending];
}
