/**
 * The two server errors the console renders as their own screen rather than as `COM-06`'s
 * banner. Next.js replaces a server error's message before it reaches the client boundary
 * but keeps a `digest` the thrower set, so these constants are how `NotPermitted` and
 * `StaleWriteError` cross that line. They are opaque labels, never shown to anyone.
 */
export const NOT_PERMITTED_DIGEST = "AWP_NOT_PERMITTED";
export const STALE_WRITE_DIGEST = "AWP_STALE_WRITE";
