import { createAppKit, type AppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createConfig, injected, type Config } from "wagmi";
import { fallback, http } from "viem";
import { arcTestnet, baseSepolia } from "viem/chains";
import { ARC_PUBLIC_RPC_URLS, arcRpcUrl } from "./config";
import { REOWN_METADATA, resolveReownProjectId } from "./reown";

export const REOWN_PROJECT_ID = resolveReownProjectId(process.env.NEXT_PUBLIC_REOWN_PROJECT_ID);
export const isReownConfigured = Boolean(REOWN_PROJECT_ID);

export const configuredArcTestnet = {
  ...arcTestnet,
  rpcUrls: { default: { http: [arcRpcUrl] } },
} as const;

const transports = {
  [arcTestnet.id]: fallback(
    ARC_PUBLIC_RPC_URLS.map((url) => http(url, { retryCount: 1, retryDelay: 250, timeout: 10_000 })),
    { rank: false, retryCount: 1, retryDelay: 300 },
  ),
  [baseSepolia.id]: http(),
} as const;

const supportedNetworks: [typeof configuredArcTestnet, typeof baseSepolia] = [configuredArcTestnet, baseSepolia];

let appKit: AppKit | undefined;
let wagmiConfig: Config;

if (REOWN_PROJECT_ID) {
  const adapter = new WagmiAdapter({ networks: supportedNetworks, projectId: REOWN_PROJECT_ID, ssr: true, transports });
  wagmiConfig = adapter.wagmiConfig;
  appKit = createAppKit({
    adapters: [adapter],
    networks: supportedNetworks,
    defaultNetwork: configuredArcTestnet,
    projectId: REOWN_PROJECT_ID,
    metadata: REOWN_METADATA,
    allowUnsupportedChain: false,
    features: {
      analytics: false,
      email: true,
      socials: ["google"],
      emailShowWallets: false,
      connectMethodsOrder: ["email", "social", "wallet"],
      collapseWallets: true,
      swaps: false,
      onramp: false,
      send: false,
      receive: false,
    },
    themeVariables: { "--w3m-accent": "#7250ff", "--w3m-border-radius-master": "3px" },
  });
} else {
  wagmiConfig = createConfig({
    chains: supportedNetworks,
    connectors: [injected({ shimDisconnect: true })],
    multiInjectedProviderDiscovery: true,
    ssr: true,
    transports,
  });
}

export function createWagmiConfig() { return wagmiConfig; }
export function getAppKit() { return appKit; }
