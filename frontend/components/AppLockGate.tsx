"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppLock } from "@/hooks/useAppLock";
import { usePreferences } from "@/hooks/usePreferences";
import { AppLockPinInput } from "./AppLockPinInput";

export function AppLockGate({ children }: { children: ReactNode }) {
  const appLock = useAppLock();
  const { t } = usePreferences();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (appLock.locked) requestAnimationFrame(() => inputRef.current?.focus()); }, [appLock.locked]);
  if (!appLock.initialized) return <main className="app-lock-screen" aria-busy="true"><div className="app-lock-card"><Image src="/makoto/logo-pro-v2.png" alt="" width={76} height={76} priority /><p>{t("appLock.initializing")}</p></div></main>;
  if (!appLock.locked) return children;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const result = await appLock.unlock(pin); setPin("");
    if (result === "wrong") setMessage(t("appLock.wrongPin"));
    if (result === "cooldown") setMessage(t("appLock.tryAgainIn", { seconds: Math.max(1, Math.ceil(((appLock.config?.cooldownUntil ?? Date.now()) - Date.now()) / 1000)) }));
  }
  function reset() { appLock.reset(); setResetOpen(false); }
  return <main className="app-lock-screen"><section className="app-lock-card" aria-labelledby="app-lock-title">
    <Image src="/makoto/logo-pro-v2.png" alt="" width={76} height={76} priority />
    <h1 id="app-lock-title">{t("appLock.lockedTitle")}</h1><p>{t("appLock.enterToContinue")}</p>
    <form autoComplete="off" data-form-type="other" onSubmit={(event) => void submit(event)}><AppLockPinInput ref={inputRef} label={t("appLock.pin")} value={pin} onChange={setPin} describedBy={message ? "app-lock-error" : undefined} /><button type="submit" disabled={pin.length !== 6}>{t("appLock.unlock")}</button></form>
    {message && <p id="app-lock-error" className="app-lock-error" role="alert">{message}</p>}
    <button className="app-lock-link" type="button" onClick={() => setResetOpen(true)}>{t("appLock.forgot")}</button>
    {resetOpen && <div className="app-lock-reset" role="alertdialog" aria-modal="true" aria-labelledby="reset-lock-title"><h2 id="reset-lock-title">{t("appLock.resetTitle")}</h2><p>{t("appLock.resetDisclosure")}</p><div><button type="button" onClick={() => setResetOpen(false)}>{t("common.cancel")}</button><button type="button" onClick={reset}>{t("appLock.confirmReset")}</button></div></div>}
  </section></main>;
}
