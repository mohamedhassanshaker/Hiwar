import { channels, liveUpdatesConfigured, publish } from "./valkey";

/**
 * The live path of the console (stack specification 7.2), from the writing side.
 *
 * A screen that shows a number somebody else changes — the dashboard's cards, the inbox
 * badge — cannot wait for the person to reload. The act that changed the number says so on
 * a channel, and the browser attached to that channel re-reads the screen.
 *
 * What travels is a reason, not the new value: the browser re-reads under its own
 * permissions, so a person is never sent a number they may not see. A dropped ping is a
 * late screen, never a failed write, which is why nothing here throws.
 */

/** The one dashboard channel. The platform is single-tenant, so every console watches it. */
export const DASHBOARD_SCOPE = "all";

/** Say that something the dashboard counts has changed. */
export async function notifyDashboard(reason: string): Promise<void> {
  if (!liveUpdatesConfigured()) return;
  await publish(channels.dashboard(DASHBOARD_SCOPE), { reason, at: new Date().toISOString() });
}

/** Say that one person's inbox has changed. */
export async function notifyInbox(personId: string, reason: string): Promise<void> {
  if (!liveUpdatesConfigured()) return;
  await publish(channels.inbox(personId), { reason, at: new Date().toISOString() });
}
