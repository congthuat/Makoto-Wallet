"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
import styles from "./OverviewFoundation.module.css";

/** Native modal supplies inert background and focus containment; no auth ownership. */
export function CreateWalletGuide({ children, onClose }: { children: (dismiss: () => void) => ReactNode; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  function dismiss(event?: SyntheticEvent<HTMLElement>) {
    // Explicit dismissal returns focus through the native dialog close algorithm.
    event?.currentTarget.closest("dialog")?.close();
    onClose();
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    // React autoFocus runs before showModal, while the dialog is still hidden.
    dialog.querySelector<HTMLElement>("[data-guide-initial-focus]")?.focus({ preventScroll: true });
    return () => {
      // React has removed the dialog on unmount; removal releases its modal state.
      // Only close a still-mounted dialog (e.g. Strict Mode effect replay).
      // Never restore focus after an auth handoff has unmounted this guide.
      if (dialog.isConnected) dialog.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return <dialog ref={dialogRef} className={styles.guide} aria-labelledby="create-guide-title"
    onCancel={(event) => { event.preventDefault(); dismiss(event); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]',
      )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled")
        && !element.closest("[inert]") && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss(event);
    }}>{children(dismiss)}</dialog>;
}
