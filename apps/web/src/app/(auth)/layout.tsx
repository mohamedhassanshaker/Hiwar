import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Brand />
        {children}
      </div>
    </main>
  );
}
