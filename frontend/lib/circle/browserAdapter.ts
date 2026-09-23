import { getAddress, type Address, type EIP1193Provider } from "viem";

export type ActiveConnector = { getProvider(): Promise<unknown> };
export async function getActiveProvider(connector?: ActiveConnector): Promise<EIP1193Provider> {
  if (!connector) throw new Error("Wallet not connected");
  const provider = await connector.getProvider() as EIP1193Provider | undefined;
  if (!provider?.request) throw new Error("Active wallet provider unavailable");
  return provider;
}
export async function verifyProviderAccount(provider: EIP1193Provider, expected: Address): Promise<Address> {
  const accounts = await provider.request({ method: "eth_accounts" }) as unknown;
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Wallet account unavailable");
  const actual = getAddress(accounts[0]);
  if (actual !== getAddress(expected)) throw new Error("Connected account changed");
  return actual;
}
export function normalizeProviderChainId(value: unknown): number {
  let chainId: bigint;
  if (typeof value === "bigint") chainId = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid provider chain ID");
    chainId = BigInt(value);
  } else if (typeof value === "string") {
    const normalized = value.trim();
    if (/^0x[0-9a-f]+$/i.test(normalized) || /^\d+$/.test(normalized)) chainId = BigInt(normalized);
    else throw new Error("Invalid provider chain ID");
  } else throw new Error("Invalid provider chain ID");
  if (chainId <= 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid provider chain ID");
  return Number(chainId);
}
export async function verifyProviderChain(provider: EIP1193Provider, expected: number): Promise<boolean> {
  const value = await provider.request({ method: "eth_chainId" });
  return normalizeProviderChainId(value) === expected;
}
export async function verifyProviderReadyForEstimate({ provider, expectedChainId, expectedAccount, switchChain, onSwitching, onReady, wrongNetworkError = "Wallet is still on the wrong network" }: {
  provider: EIP1193Provider;
  expectedChainId: number;
  expectedAccount: Address;
  switchChain(): Promise<unknown>;
  onSwitching(): void;
  onReady(): void;
  wrongNetworkError?: string;
}): Promise<void> {
  if (!(await verifyProviderChain(provider, expectedChainId))) {
    onSwitching();
    await switchChain();
  }
  if (!(await verifyProviderChain(provider, expectedChainId))) throw new Error(wrongNetworkError);
  await verifyProviderAccount(provider, expectedAccount);
  onReady();
}
export async function runSingleFlight(flag: { current: boolean }, operation: () => Promise<void>): Promise<boolean> {
  if (flag.current) return false;
  flag.current = true;
  try {
    await operation();
    return true;
  } finally {
    flag.current = false;
  }
}
export async function createCircleBrowserAdapter(connector: ActiveConnector | undefined, expected: Address) {
  const provider = await getActiveProvider(connector);
  await verifyProviderAccount(provider, expected);
  const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
  return { adapter: await createViemAdapterFromProvider({ provider, capabilities: { addressContext: "user-controlled" } }), provider };
}
