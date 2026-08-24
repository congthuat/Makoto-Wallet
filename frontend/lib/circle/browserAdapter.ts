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
export async function verifyProviderChain(provider: EIP1193Provider, expected: number): Promise<boolean> {
  const value = await provider.request({ method: "eth_chainId" });
  return typeof value === "string" && Number.parseInt(value, 16) === expected;
}
export async function createCircleBrowserAdapter(connector: ActiveConnector | undefined, expected: Address) {
  const provider = await getActiveProvider(connector);
  await verifyProviderAccount(provider, expected);
  const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
  return { adapter: await createViemAdapterFromProvider({ provider, capabilities: { addressContext: "user-controlled" } }), provider };
}
