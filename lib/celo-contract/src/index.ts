export { isPositiveCeloAmount } from "./amount";
export { celoRewardPoolAbi } from "./abi-v3";
export { celoRewardPoolAbi as legacyCeloRewardPoolAbi } from "./abi";

export const CELO_DEPLOYMENT = {
  chainId: 11142220,
  contractAddress: "0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc",
  tokenAddress: "0x471EcE3750Da237f93B8E339c536989b8978a438",
  protocolWallet: "0x0d8C36615D9026d8658da26C9A1E1C44B469865D",
  ownerWallet: "0x91b2D43890e6Ace6b1D104c51212965E8925a015",
  runtimeCodeHash: "0x7b2322fbd2e22d0dfffbe03e18926cfa4f3d4ad48bd235e69cde660dcbc27fb9",
  sourceVerificationUrl: "https://celo-sepolia.blockscout.com/address/0xCC38DF5ce9D64E18e37d790368FcC9a63459f4Bc?tab=contract",
} as const;