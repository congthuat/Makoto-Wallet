const ARC_TESTNET_NAME = "Arc Testnet";
const ARC_TESTNET_NETWORK = "arcTestnet";
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.io";
const ARC_TESTNET_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

async function assertArcTestnet(hre) {
  const network = await hre.ethers.provider.getNetwork();
  if (hre.network.name !== ARC_TESTNET_NETWORK) {
    throw new Error(`Use --network ${ARC_TESTNET_NETWORK}; received ${hre.network.name}`);
  }
  if (network.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
    throw new Error(
      `Arc Testnet chain ID mismatch: expected ${ARC_TESTNET_CHAIN_ID}, received ${network.chainId}`
    );
  }
  return network;
}

module.exports = {
  ARC_TESTNET_NAME,
  ARC_TESTNET_NETWORK,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_USDC_ADDRESS,
  assertArcTestnet,
};
