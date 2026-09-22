"use client";

import type { ReactNode } from "react";
import { useConnection } from "wagmi";
import { AppHeader } from "./AppHeader";
import { useHydrated } from "@/hooks/useHydrated";
import { usePreferences } from "@/hooks/usePreferences";
import styles from "./AppShell.module.css";

/** Presentation only: providers and all route-owned controllers stay in place. */
export function AppShell({ children, legacyClassName }: { children: ReactNode; legacyClassName?: string }) {
  const { locale } = usePreferences();
  const hydrated = useHydrated();
  const connection = useConnection();
  const shellMode = hydrated && connection.isConnected ? "connected" : "disconnected";
  return <div className={`${styles.page} ${styles[`${shellMode}Shell`]} ${legacyClassName ?? ""}`.trim()} data-shell-mode={shellMode}>
    <a className={styles.skipLink} href="#main-content">{locale === "vi" ? "Đến nội dung chính" : "Skip to main content"}</a>
    <AppHeader />
    <main id="main-content" className={styles.content} tabIndex={-1}>{children}</main>
  </div>;
}
