import type { CircleCapabilityMap } from "./types.ts";

export const ARC_DOMAIN = 26;
export const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const;
let kitPromise: Promise<import("@circle-fin/app-kit").AppKit> | undefined;
export function getCircleAppKit() {
  kitPromise ??= import("@circle-fin/app-kit").then(({ AppKit }) => new AppKit());
  return kitPromise;
}

export function circleCapabilities(config: { appKitConfigured: boolean; gatewayConfigured: boolean }): CircleCapabilityMap {
  return {
    send: "supported",
    bridge: config.appKitConfigured ? "supported" : "configuration-required",
    swap: config.appKitConfigured ? "supported" : "configuration-required",
    unifiedBalance: "supported",
  };
}
