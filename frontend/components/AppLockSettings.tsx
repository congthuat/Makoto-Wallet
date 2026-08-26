"use client";

import { useState } from "react";
import { useDisconnect } from "wagmi";
import { useAppLock } from "@/hooks/useAppLock";
import { usePreferences } from "@/hooks/usePreferences";
import { AUTO_LOCK_OPTIONS, isValidPin, isWeakPin, pinsMatch } from "@/lib/appLock";
import styles from "./MakotoWallet.module.css";
import { AppLockPinInput } from "./AppLockPinInput";

type Flow = "setup" | "change" | "disable" | "reset" | undefined;
export function AppLockSettings() {
  const lock = useAppLock(); const { t } = usePreferences(); const disconnect = useDisconnect();
  const [flow, setFlow] = useState<Flow>(); const [pin, setPin] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState(""); const [autoLockMs, setAutoLockMs] = useState(300_000); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const close = () => { setFlow(undefined); setPin(""); setNext(""); setConfirm(""); setError(""); setBusy(false); };
  async function submit() {
    setError(""); setBusy(true);
    try {
      if (flow === "setup") { if (!pinsMatch(pin, confirm)) throw new Error(t("appLock.pinMismatch")); await lock.setup(pin, autoLockMs); close(); }
      else if (flow === "change") { if (!pinsMatch(next, confirm)) throw new Error(t("appLock.pinMismatch")); if (!(await lock.changePin(pin, next))) throw new Error(t("appLock.wrongPin")); close(); }
      else if (flow === "disable") { if (!(await lock.disable(pin))) throw new Error(t("appLock.wrongPin")); close(); }
      else if (flow === "reset") { lock.reset(); disconnect.mutate(); close(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("appLock.unavailable")); setPin(""); setNext(""); setConfirm(""); setBusy(false); }
  }
  const newPin = flow === "change" ? next : pin;
  return <section className={`${styles.settingsCard} ${styles.settingsWide} ${styles.appLockCard}`}><h2>{t("appLock.title")}</h2>
    {!lock.available ? <p className={styles.settingsMuted}>{t("appLock.unavailable")}</p> : <>
      {lock.enabled && <div className={styles.settingsInfo}><span>{t("appLock.status")}</span><strong>{t("appLock.enabled")}</strong></div>}
      {!lock.enabled && <div className={`${styles.securityAlert} ${styles.securityAlert_attention}`}><strong>{t("appLock.off")}</strong><span>{t("appLock.storageDisclosure")}</span></div>}
      {lock.enabled && <><label className={styles.appLockTiming}>{t("appLock.autoLock")}<select value={lock.config?.autoLockMs ?? 0} onChange={(event) => lock.setAutoLockMs(Number(event.target.value))}>{AUTO_LOCK_OPTIONS.map((value) => <option key={value} value={value}>{autoLabel(value, t)}</option>)}</select></label>
        <div className={styles.appLockSessionSetting}>
          <div><strong id="app-lock-session-label">{t("appLock.keepSession")}</strong><p id="app-lock-session-description">{t("appLock.keepSessionDescription")}</p><small>{t("appLock.keepSessionSecurity")}</small></div>
          <button type="button" role="switch" aria-checked={lock.config?.keepUnlockedSession ?? false} aria-labelledby="app-lock-session-label" aria-describedby="app-lock-session-description" className={styles.appLockSwitch} onClick={() => lock.setKeepUnlockedSession(!(lock.config?.keepUnlockedSession ?? false))}><span aria-hidden="true" /><b>{t(lock.config?.keepUnlockedSession ? "appLock.on" : "appLock.offState")}</b></button>
        </div>
      </>}
      <p className={styles.settingsMuted}>{t("appLock.disclosure")}</p>{lock.enabled && <p className={styles.settingsMuted}>{t("appLock.storageDisclosure")}</p>}
      <div className={styles.settingsActions}>{!lock.enabled ? <button type="button" onClick={() => setFlow("setup")}>{t("appLock.setup")}</button> : <><button type="button" onClick={lock.lock}>{t("appLock.lockNow")}</button><button type="button" onClick={() => setFlow("change")}>{t("appLock.changePin")}</button><button type="button" onClick={() => setFlow("disable")}>{t("appLock.disable")}</button><button type="button" onClick={() => setFlow("reset")}>{t("appLock.forgot")}</button></>}</div>
    </>}
    {flow && <div className={styles.appLockPanel} role="dialog" aria-modal="true" aria-labelledby="app-lock-flow-title"><h3 id="app-lock-flow-title">{t(flow === "setup" ? "appLock.setup" : flow === "change" ? "appLock.changePin" : flow === "disable" ? "appLock.disable" : "appLock.resetTitle")}</h3>
      {(flow === "setup" || flow === "change") && <p>{t("appLock.disclosure")}</p>}{flow === "setup" && <ol><li>{t("appLock.setupStep1")}</li><li>{t("appLock.setupStep2")}</li><li>{t("appLock.setupStep3")}</li><li>{t("appLock.setupStep4")}</li></ol>}
      {flow === "reset" ? <p>{t("appLock.resetDisclosure")}</p> : <div className={styles.appLockFields}>
        {(flow === "change" || flow === "disable") && <PinField label={t("appLock.currentPin")} value={pin} setValue={setPin} />}
        {flow !== "disable" && <><PinField label={t(flow === "change" ? "appLock.newPin" : "appLock.pin")} value={newPin} setValue={flow === "change" ? setNext : setPin} /><PinField label={t("appLock.confirmPin")} value={confirm} setValue={setConfirm} />{isValidPin(newPin) && isWeakPin(newPin) && <p className={styles.settingsMuted} role="status">{t("appLock.weakPin")}</p>}</>}
        {flow === "setup" && <label>{t("appLock.autoLock")}<select value={autoLockMs} onChange={(event) => setAutoLockMs(Number(event.target.value))}>{AUTO_LOCK_OPTIONS.map((value) => <option key={value} value={value}>{autoLabel(value, t)}</option>)}</select></label>}
      </div>}
      {error && <p className={styles.appLockError} role="alert">{error}</p>}<div className={styles.settingsActions}><button type="button" onClick={close}>{t("common.cancel")}</button><button type="button" disabled={busy || (flow !== "reset" && (!isValidPin(pin) || (flow !== "disable" && (!isValidPin(newPin) || !pinsMatch(newPin, confirm)))))} onClick={() => void submit()}>{flow === "reset" ? t("appLock.confirmReset") : t("common.confirm")}</button></div>
    </div>}
  </section>;
}
function PinField({ label, value, setValue }: { label: string; value: string; setValue(value: string): void }) { return <AppLockPinInput label={label} value={value} onChange={setValue} />; }
function autoLabel(value: number, t: ReturnType<typeof usePreferences>["t"]) { return value === 0 ? t("appLock.never") : t(value === 60_000 ? "appLock.oneMinute" : value === 300_000 ? "appLock.fiveMinutes" : value === 900_000 ? "appLock.fifteenMinutes" : "appLock.thirtyMinutes"); }
