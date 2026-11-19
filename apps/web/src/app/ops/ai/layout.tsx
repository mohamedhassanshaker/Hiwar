import { Suspense, type ReactNode } from "react";

import "@/app/ai.css";
import "@/lib/zod-config";
import { DirectoryProvider } from "@/components/shared/directory";
import { ModalProvider } from "@/components/shared/modal-host";
import { MODAL_REGISTRY } from "@/components/shared/modal-registry";
import { ToastProvider } from "@/components/shared/toast";
import { loadDirectory } from "@/features/organisation/service";
import { PreferencesProvider } from "@/lib/preferences";
import { requireSession } from "@/lib/session";

/** AI capabilities read the signed-in operator on every request, so nothing here is prerendered. */
export const dynamic = "force-dynamic";

/**
 * The AI capabilities (the TAWP module's screens) inside the operator portal. The operator
 * layout above has already required a staff account with 2-step sign-in; this adds the
 * contexts the module's screens read: language, the directory of agents and people, the modal
 * host and the toast host. `.ai-scope` applies the module's layout classes on Hiwar's tokens.
 */
export default async function AiLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const directory = await loadDirectory();
  return (
    <PreferencesProvider>
      <DirectoryProvider value={directory}>
        <ModalProvider registry={MODAL_REGISTRY}>
          <ToastProvider>
            <div className="ai-scope">
              <Suspense>{children}</Suspense>
            </div>
          </ToastProvider>
        </ModalProvider>
      </DirectoryProvider>
    </PreferencesProvider>
  );
}
