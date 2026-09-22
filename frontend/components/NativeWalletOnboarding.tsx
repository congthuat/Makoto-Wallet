"use client";

import { useMemo, useState, type SyntheticEvent } from "react";
import type { Address } from "viem";
import { usePreferences } from "@/hooks/usePreferences";
import { useLocalWalletControls } from "@/hooks/useWalletAccount";
import {
  deleteLocalWallet,
  encryptLocalWallet,
  generateLocalWallet,
  hasLocalWalletKeystoreRecord,
  loadLocalWalletKeystore,
  restoreLocalWallet,
  saveLocalWalletKeystore,
  validateLocalWalletMnemonic,
  type LocalWalletSecretMaterial,
  type MakotoKeystoreV1,
} from "@/lib/localWalletKeystore";
import {
  canContinueRecoveryPhrase,
  canPersistLocalWallet,
  createRecoveryChallenge,
  validateWalletPassword,
  verifyRecoveryChallenge,
} from "@/lib/onboarding";
import styles from "./NativeWalletOnboarding.module.css";

type Stage =
  | "intro"
  | "phrase"
  | "verify"
  | "restore"
  | "restore-confirm"
  | "password"
  | "saving"
  | "success"
  | "existing"
  | "unlock"
  | "replace-confirm"
  | "delete-confirm";

type WalletMode = "create" | "restore";

export function NativeWalletOnboarding({ onClose }: { onClose(): void }) {
  const { t } = usePreferences();
  const localWallet = useLocalWalletControls();
  const [initial] = useState(() => {
    const stored = loadLocalWalletKeystore();
    const hasRecord = hasLocalWalletKeystoreRecord();
    return { hasRecord, stored, stage: hasRecord ? "existing" as const : "intro" as const };
  });
  const [stage, setStage] = useState<Stage>(initial.stage);
  const [mode, setMode] = useState<WalletMode>("create");
  const [existing, setExisting] = useState<MakotoKeystoreV1 | undefined>(initial.stored);
  const [hasExistingRecord, setHasExistingRecord] = useState(initial.hasRecord);
  const [secret, setSecret] = useState<LocalWalletSecretMaterial>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [challenge, setChallenge] = useState<readonly number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [phraseInput, setPhraseInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [replacementAddress, setReplacementAddress] = useState<Address>();
  const [unreadableReplacementConfirmed, setUnreadableReplacementConfirmed] = useState(false);
  const [completedAddress, setCompletedAddress] = useState<Address>();
  const [error, setError] = useState<string>();
  const [unlocking, setUnlocking] = useState(false);

  const title = useMemo(() => {
    if (stage === "phrase") return t("onboarding.recoveryPhrase");
    if (stage === "verify") return t("onboarding.verifyBackup");
    if (stage === "restore" || stage === "restore-confirm") return t("onboarding.restoreTitle");
    if (stage === "password" || stage === "saving") return t("onboarding.walletPassword");
    if (stage === "success") return mode === "create" ? t("onboarding.walletCreated") : t("onboarding.walletRestored");
    if (stage === "unlock") return t("onboarding.unlockWallet");
    if (stage === "existing") return t("onboarding.localWalletFound");
    if (stage === "replace-confirm") return t("onboarding.replaceTitle");
    if (stage === "delete-confirm") return t("onboarding.deleteWallet");
    return t("onboarding.createGuideTitle");
  }, [mode, stage, t]);

  function resetTransientSecrets() {
    setSecret(undefined);
    setPhraseInput("");
    setPassword("");
    setConfirmation("");
    setChallenge([]);
    setAnswers({});
    setAcknowledged(false);
    setShowPassword(false);
    setError(undefined);
  }

  function close() {
    resetTransientSecrets();
    onClose();
  }

  function startCreate() {
    const stored = loadLocalWalletKeystore();
    const hasRecord = hasLocalWalletKeystoreRecord();
    if (hasRecord) {
      setExisting(stored);
      setHasExistingRecord(true);
      setStage("existing");
      return;
    }
    resetTransientSecrets();
    setMode("create");
    setSecret(generateLocalWallet());
    setStage("phrase");
  }

  function startRestore() {
    resetTransientSecrets();
    setMode("restore");
    setStage("restore");
  }

  function beginVerification() {
    if (!secret || !canContinueRecoveryPhrase(acknowledged)) return;
    setChallenge(createRecoveryChallenge());
    setAnswers({});
    setError(undefined);
    setStage("verify");
  }

  function checkVerification(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret || !verifyRecoveryChallenge(secret.mnemonic, challenge, answers)) {
      setAnswers({});
      setError(t("onboarding.verificationError"));
      return;
    }
    setAnswers({});
    setChallenge([]);
    setError(undefined);
    setStage("password");
  }

  function reviewRestore(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateLocalWalletMnemonic(phraseInput)) {
      setError(t("onboarding.invalidPhrase"));
      return;
    }
    const restored = restoreLocalWallet(phraseInput);
    setPhraseInput("");
    setSecret(restored);
    setError(undefined);
    setStage("restore-confirm");
  }

  async function saveWallet(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret) return;
    const passwordError = validateWalletPassword(password, confirmation);
    if (passwordError) {
      setError(t(passwordError === "too-short" ? "onboarding.passwordTooShort" : "onboarding.passwordMismatch"));
      return;
    }

    const stored = loadLocalWalletKeystore();
    const hasRecord = hasLocalWalletKeystoreRecord();
    const replacementConfirmed = stored
      ? Boolean(replacementAddress && stored.account.address === replacementAddress)
      : hasRecord && unreadableReplacementConfirmed;
    if (!canPersistLocalWallet(hasRecord, replacementConfirmed)) {
      resetTransientSecrets();
      setReplacementAddress(undefined);
      setUnreadableReplacementConfirmed(false);
      setExisting(stored);
      setHasExistingRecord(hasRecord);
      setStage(hasRecord ? "existing" : "intro");
      return;
    }

    setStage("saving");
    setError(undefined);
    try {
      const keystore = await encryptLocalWallet(secret, password);
      saveLocalWalletKeystore(keystore);
      localWallet.refresh();
      setExisting(keystore);
      setCompletedAddress(keystore.account.address);
      setSecret(undefined);
      setPassword("");
      setConfirmation("");
      setReplacementAddress(undefined);
      setUnreadableReplacementConfirmed(false);
      setHasExistingRecord(true);
      setStage("success");
    } catch {
      setPassword("");
      setConfirmation("");
      setError(t("onboarding.storageError"));
      setStage("password");
    }
  }

  function confirmReplacement() {
    if (!confirmationChecked || !hasExistingRecord) return;
    localWallet.lock();
    setReplacementAddress(existing?.account.address);
    setUnreadableReplacementConfirmed(!existing);
    setConfirmationChecked(false);
    startRestore();
    setReplacementAddress(existing?.account.address);
    setUnreadableReplacementConfirmed(!existing);
  }

  function confirmDelete() {
    if (!confirmationChecked || !hasExistingRecord) return;
    const current = loadLocalWalletKeystore();
    const currentHasRecord = hasLocalWalletKeystoreRecord();
    const recordChanged = existing
      ? !current || current.account.address !== existing.account.address
      : Boolean(current) || !currentHasRecord;
    if (recordChanged) {
      setExisting(current);
      setHasExistingRecord(currentHasRecord);
      setConfirmationChecked(false);
      setStage(currentHasRecord ? "existing" : "intro");
      return;
    }
    localWallet.lock();
    deleteLocalWallet();
    localWallet.refresh();
    resetTransientSecrets();
    setExisting(undefined);
    setHasExistingRecord(false);
    setCompletedAddress(undefined);
    setReplacementAddress(undefined);
    setConfirmationChecked(false);
    setStage("intro");
  }

  async function unlockWallet(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unlocking) return;
    const passwordError = validateWalletPassword(password, password);
    if (passwordError) {
      setError(t("onboarding.passwordTooShort"));
      return;
    }
    setUnlocking(true);
    setError(undefined);
    try {
      await localWallet.unlock(password);
    } catch {
      setPassword("");
      setError(t("onboarding.unlockFailed"));
      setUnlocking(false);
      return;
    }
    setPassword("");
    setShowPassword(false);
    setUnlocking(false);
    onClose();
  }

  return <div className={styles.root}>
    <header className={styles.header}>
      <div>
        <span>MAKOTO WALLET · ARC TESTNET</span>
        <h2 id="create-guide-title">{title}</h2>
      </div>
      <button type="button" className={styles.close} onClick={close} aria-label={t("common.close")}>×</button>
    </header>

    {stage === "intro" && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t("onboarding.securityIntro")}</p>
      <ul className={styles.securityList}>
        <li>{t("onboarding.selfCustody")}</li>
        <li>{t("onboarding.cannotRecover")}</li>
        <li>{t("onboarding.neverShare")}</li>
      </ul>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={startCreate} autoFocus data-guide-initial-focus>{t("onboarding.createNew")}</button>
        <button type="button" className={styles.secondary} onClick={startRestore}>{t("onboarding.importWallet")}</button>
      </div>
    </section>}

    {stage === "phrase" && secret && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t("onboarding.recoveryIntro")}</p>
      <div className={styles.warning} role="note">{t("onboarding.recoveryWarning")}</div>
      <ol className={styles.phraseGrid} aria-label={t("onboarding.recoveryPhrase")}>
        {secret.mnemonic.split(" ").map((word, index) => <li key={index}><span>{index + 1}</span><strong>{word}</strong></li>)}
      </ol>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>{t("onboarding.savedAcknowledgement")}</span>
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!canContinueRecoveryPhrase(acknowledged)} onClick={beginVerification}>{t("onboarding.verifyBackup")}</button>
        <button type="button" className={styles.secondary} onClick={() => { resetTransientSecrets(); setStage("intro"); }}>{t("onboarding.back")}</button>
      </div>
    </section>}

    {stage === "verify" && <form className={styles.stage} onSubmit={checkVerification}>
      <p className={styles.lead}>{t("onboarding.verifyIntro")}</p>
      <div className={styles.challengeGrid}>
        {challenge.map((position) => <label key={position}>
          <span>{t("onboarding.wordNumber", { position })}</span>
          <input value={answers[position] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [position]: event.target.value }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" required aria-invalid={Boolean(error)} />
        </label>)}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>{t("onboarding.continue")}</button>
        <button type="button" className={styles.secondary} onClick={() => { setError(undefined); setStage("phrase"); }}>{t("onboarding.back")}</button>
      </div>
    </form>}

    {stage === "restore" && <form className={styles.stage} onSubmit={reviewRestore}>
      <p className={styles.lead}>{t("onboarding.restoreIntro")}</p>
      <label className={styles.field}>
        <span>{t("onboarding.phraseLabel")}</span>
        <textarea value={phraseInput} onChange={(event) => { setPhraseInput(event.target.value); setError(undefined); }} placeholder={t("onboarding.phrasePlaceholder")} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" rows={5} aria-invalid={Boolean(error)} aria-describedby={error ? "restore-phrase-error" : undefined} />
      </label>
      {error && <p id="restore-phrase-error" className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>{t("onboarding.validatePhrase")}</button>
        <button type="button" className={styles.secondary} onClick={() => { resetTransientSecrets(); setStage(existing ? "existing" : "intro"); }}>{t("onboarding.back")}</button>
      </div>
    </form>}

    {stage === "restore-confirm" && secret && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t("onboarding.restoreAddress")}</p>
      <div className={styles.addressCard}><span>{t("onboarding.walletAddress")}</span><strong>{secret.address}</strong></div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => setStage("password")}>{t("onboarding.confirmAddress")}</button>
        <button type="button" className={styles.secondary} onClick={() => { setSecret(undefined); setStage("restore"); }}>{t("onboarding.back")}</button>
      </div>
    </section>}

    {(stage === "password" || stage === "saving") && <form className={styles.stage} onSubmit={(event) => void saveWallet(event)}>
      <p className={styles.lead}>{t("onboarding.passwordIntro")}</p>
      <p className={styles.support}>{t("onboarding.passwordRecovery")}</p>
      <label className={styles.field}>
        <span>{t("onboarding.passwordLabel")}</span>
        <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(undefined); }} autoComplete="new-password" minLength={8} required disabled={stage === "saving"} aria-invalid={Boolean(error)} />
      </label>
      <label className={styles.field}>
        <span>{t("onboarding.confirmPassword")}</span>
        <input type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(undefined); }} autoComplete="new-password" minLength={8} required disabled={stage === "saving"} aria-invalid={Boolean(error)} />
      </label>
      <button type="button" className={styles.textButton} onClick={() => setShowPassword((current) => !current)} disabled={stage === "saving"}>{t(showPassword ? "onboarding.hidePassword" : "onboarding.showPassword")}</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={stage === "saving"}>{t(stage === "saving" ? "onboarding.saving" : "onboarding.saveWallet")}</button>
        <button type="button" className={styles.secondary} disabled={stage === "saving"} onClick={() => { setPassword(""); setConfirmation(""); setError(undefined); setStage(mode === "restore" ? "restore-confirm" : "verify"); }}>{t("onboarding.back")}</button>
      </div>
    </form>}

    {stage === "success" && completedAddress && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t("onboarding.successCopy")}</p>
      <dl className={styles.summary}>
        <div><dt>{t("onboarding.walletAddress")}</dt><dd>{completedAddress}</dd></div>
        <div><dt>{t("onboarding.network")}</dt><dd>Arc Testnet · 5042002</dd></div>
        <div><dt>{t("onboarding.securityState")}</dt><dd>{t("onboarding.localWalletSaved")} · {t("onboarding.locked")}</dd></div>
      </dl>
      <p className={styles.support}>{t("onboarding.unlockPrompt")}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => setStage("unlock")}>{t("onboarding.unlock")}</button>
        <button type="button" className={styles.secondary} onClick={close}>{t("onboarding.backToWallet")}</button>
      </div>
    </section>}

    {stage === "existing" && hasExistingRecord && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t(existing ? "onboarding.existingCopy" : "onboarding.existingUnreadable")}</p>
      {existing && <div className={styles.addressCard}><span>{t("onboarding.walletAddress")}</span><strong>{existing.account.address}</strong><small>{t(localWallet.wallet.status === "connected" ? "onboarding.unlocked" : "onboarding.locked")}</small></div>}
      <p className={styles.support}>{t(localWallet.wallet.status === "connected" ? "onboarding.sendOnlyDisclosure" : "onboarding.unlockPrompt")}</p>
      <div className={styles.actions}>
        {localWallet.wallet.status === "connected"
          ? <button type="button" className={styles.primary} onClick={() => { localWallet.lock(); close(); }}>{t("onboarding.lock")}</button>
          : <button type="button" className={styles.primary} onClick={() => setStage("unlock")}>{t("onboarding.unlock")}</button>}
        <button type="button" className={styles.secondary} onClick={() => { setConfirmationChecked(false); setStage("replace-confirm"); }}>{t("onboarding.restoreAnother")}</button>
        <button type="button" className={styles.danger} onClick={() => { setConfirmationChecked(false); setStage("delete-confirm"); }}>{t("onboarding.deleteWallet")}</button>
      </div>
    </section>}

    {stage === "unlock" && <form className={styles.stage} onSubmit={(event) => void unlockWallet(event)}>
      <p className={styles.lead}>{t("onboarding.unlockIntro")}</p>
      <label className={styles.field}>
        <span>{t("onboarding.passwordLabel")}</span>
        <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(undefined); }} autoComplete="current-password" minLength={8} required disabled={unlocking} aria-invalid={Boolean(error)} autoFocus />
      </label>
      <button type="button" className={styles.textButton} onClick={() => setShowPassword((current) => !current)} disabled={unlocking}>{t(showPassword ? "onboarding.hidePassword" : "onboarding.showPassword")}</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={unlocking}>{t(unlocking ? "onboarding.unlocking" : "onboarding.unlock")}</button>
        <button type="button" className={styles.secondary} disabled={unlocking} onClick={() => { setPassword(""); setError(undefined); setStage("existing"); }}>{t("onboarding.cancel")}</button>
      </div>
    </form>}

    {stage === "replace-confirm" && <section className={styles.stage} aria-labelledby="create-guide-title">
      <p className={styles.lead}>{t("onboarding.replaceCopy")}</p>
      <div className={styles.warning}>{t("onboarding.deleteWarning")}</div>
      <label className={styles.checkRow}><input type="checkbox" checked={confirmationChecked} onChange={(event) => setConfirmationChecked(event.target.checked)} /><span>{t("onboarding.confirmReplace")}</span></label>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!confirmationChecked} onClick={confirmReplacement}>{t("onboarding.continueRestore")}</button>
        <button type="button" className={styles.secondary} onClick={() => setStage("existing")}>{t("onboarding.cancel")}</button>
      </div>
    </section>}

    {stage === "delete-confirm" && <section className={styles.stage} aria-labelledby="create-guide-title">
      <div className={styles.dangerNotice} role="alert">{t("onboarding.deleteWarning")}</div>
      <p className={styles.support}>{t("onboarding.forensicDisclosure")}</p>
      <label className={styles.checkRow}><input type="checkbox" checked={confirmationChecked} onChange={(event) => setConfirmationChecked(event.target.checked)} /><span>{t("onboarding.confirmDelete")}</span></label>
      <div className={styles.actions}>
        <button type="button" className={styles.danger} disabled={!confirmationChecked} onClick={confirmDelete}>{t("onboarding.deleteConfirmed")}</button>
        <button type="button" className={styles.secondary} onClick={() => setStage("existing")}>{t("onboarding.cancel")}</button>
      </div>
    </section>}
  </div>;
}
