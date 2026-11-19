/**
 * Whether an ingestion run is over, from the stage its progress query reports.
 *
 * `"done"` is the workflow's own terminal stage; `"idle"` is what the agent service reports
 * once the run has aged out of Temporal and there is nothing left to query. A poller that
 * waits for only one of the two leaves a finished run polled forever the moment the other is
 * what actually comes back.
 */
export function ingestionFinished(stage: string): boolean {
  return stage === "idle" || stage === "done";
}
