// Functions and events used by the marketplace from the user-supplied v3 ABI.
// The complete supplied ABI is retained in attached_assets for comparison.
export const celoRewardPoolAbi = [
  { type: "function", name: "createCampaign", stateMutability: "nonpayable", inputs: [
    { name: "amount", type: "uint256" }, { name: "requireIdentity", type: "bool" },
    { name: "payoutWindowSeconds", type: "uint64" },
  ], outputs: [{ name: "campaignId", type: "uint256" }] },
  { type: "function", name: "distributeBatch", stateMutability: "nonpayable", inputs: [
    { name: "campaignId", type: "uint256" }, { name: "recipients", type: "address[]" },
    { name: "amounts", type: "uint256[]" },
  ], outputs: [] },
  { type: "function", name: "withdrawRemaining", stateMutability: "nonpayable",
    inputs: [{ name: "campaignId", type: "uint256" }], outputs: [] },
  { type: "function", name: "campaigns", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }], outputs: [
      { name: "project", type: "address" }, { name: "grossDeposit", type: "uint256" },
      { name: "protocolFee", type: "uint256" }, { name: "celoPool", type: "uint256" },
      { name: "celoDistributed", type: "uint256" }, { name: "requireIdentity", type: "bool" },
      { name: "payoutDeadline", type: "uint64" },
    ] },
  { type: "function", name: "hasBeenPaid", stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "CELO", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "protocolWallet", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "owner", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "PROTOCOL_FEE_BPS", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "CampaignCreated", inputs: [
    { name: "campaignId", type: "uint256", indexed: true },
    { name: "project", type: "address", indexed: true },
    { name: "grossDeposit", type: "uint256", indexed: false },
    { name: "protocolFee", type: "uint256", indexed: false },
    { name: "celoPool", type: "uint256", indexed: false },
    { name: "requireIdentity", type: "bool", indexed: false },
  ] },
  { type: "event", name: "Distributed", inputs: [
    { name: "campaignId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "RemainingWithdrawn", inputs: [
    { name: "campaignId", type: "uint256", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
] as const;
