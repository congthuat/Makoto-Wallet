import type { Jar } from "./types.ts";

export type JarDepositIneligibility = "closed" | "unlocked";

export function jarDepositIneligibility(jar: Jar, nowSeconds = BigInt(Math.floor(Date.now() / 1000))): JarDepositIneligibility | undefined {
  if (jar.closed) return "closed";
  if (nowSeconds >= jar.unlockTime) return "unlocked";
  return undefined;
}

export function canJarAcceptDeposits(jar: Jar, nowSeconds?: bigint) {
  return jarDepositIneligibility(jar, nowSeconds) === undefined;
}

export class JarDepositEligibilityError extends Error {
  readonly code: JarDepositIneligibility;
  constructor(code: JarDepositIneligibility) {
    super(code === "closed" ? "This Vault goal is closed and cannot receive deposits." : "This Vault goal has reached its unlock time and cannot receive deposits.");
    this.name = "JarDepositEligibilityError";
    this.code = code;
  }
}

export function assertJarAcceptsDeposits(jar: Jar, nowSeconds?: bigint): void {
  const reason = jarDepositIneligibility(jar, nowSeconds);
  if (reason) throw new JarDepositEligibilityError(reason);
}
