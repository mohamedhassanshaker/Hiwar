import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { navFor } from "@/components/shared/nav";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider } from "@/components/shared/modal-host";
import { MODAL_REGISTRY } from "@/components/shared/modal-registry";
import { Shell } from "@/components/shared/shell";
import { ToastProvider } from "@/components/shared/toast";
import { CommentsProvider } from "@/features/comments/components/comment-store";
import { CommentHost } from "@/features/comments/components/comment-host";
import { loadThreads, mayRaiseTasks } from "@/features/comments/service";
import { peekItems } from "@/features/inbox/service";
import { loadBranding } from "@/features/governance/service";
import { loadDirectory } from "@/features/organisation/service";
import { signOutDestination } from "@/features/auth/service";
import { endSession } from "@/lib/auth";
import { can, requireSession } from "@/lib/session";

/** Every console screen depends on the signed-in person, so the shell is never prerendered. */
export const instant = false;

/**
 * The console shell: sidebar, top bar, page assistant. `/sign-in` and the other screens before sign-in render
 * outside it. Screens read the query string, so the page slot is suspended here, outside
 * the shell.
 *
 * The directory — the signed-in person, the agents, the people and the projects — is read
 * once here on the server and handed to the client, so no screen has to name a principal
 * from a hard-coded record. The modal host sits inside it, because every modal names
 * principals too.
 *
 * The branding is read here too (`UC-75.2-01`): an uploaded logo and brand colour are what
 * the platform looks like to everyone who signs in, so the shell renders them rather than
 * the design system's own mark whenever one has been uploaded.
 *
 * `COM-07` and `COM-08`: the navigation and the top bar's create buttons are decided here,
 * from the person's grants, and `Shell` renders what it is given. The server actions behind
 * the buttons check the same permissions again, because a hidden button is not security.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const [directory, branding, inbox, commentThreads, raiseTasks, workItems, requests, rooms, settings] = await Promise.all([
    loadDirectory(),
    loadBranding(),
    peekItems(),
    loadThreads(),
    mayRaiseTasks(),
    can("work_items:write"),
    can("requests:write"),
    can("rooms:write"),
    can("settings:read"),
  ]);

  /** Log out: ends the session, and for a UAE PASS session UAE PASS's own too (D387). */
  async function signOut() {
    "use server";
    redirect(signOutDestination(await endSession()));
  }

  return (
    <DirectoryProvider value={directory}>
      <CommentsProvider initial={commentThreads}>
        <ModalProvider registry={MODAL_REGISTRY}>
          {/* Every screen's acts report through this, so a success or a refusal is seen
              where the person is looking rather than at the top of the page. */}
          <ToastProvider>
            <Shell
              nav={navFor(session.principal)}
              branding={branding}
              inbox={inbox}
              commentThreads={commentThreads}
              may={{ workItems, requests, rooms, settings }}
              onSignOut={signOut}
            >
              <Suspense>{children}</Suspense>
            </Shell>
          </ToastProvider>
          {/* The comment popover and the reply toast sit beside the shell, so neither is
              clipped by the card it is about nor unmounted when that card scrolls away. */}
          <CommentHost mayRaiseTasks={raiseTasks} />
        </ModalProvider>
      </CommentsProvider>
    </DirectoryProvider>
  );
}
