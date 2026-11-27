import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  formatUnits,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { celo } from 'viem/chains';
import {
  isRewardSwapQuoteFresh,
  minimumReceivedFromQuote,
  parseSlippageBps,
  type RewardSwapQuote,
} from './reward-quote';

export const REWARD_POOL_CHAIN_ID = 42220;
export const GDOLLAR_TOKEN_ADDRESS = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' as Address;
export const CELO_NATIVE_TOKEN_ADDRESS = '0x471EcE3750Da237f93B8E339c536989b8978a438' as Address;
export const CELO_SWAP_ROUTER02_ADDRESS = '0x5615CDAb10dc425a742d643d949a7F474C01abc4' as Address;
export const CELO_QUOTER_V2_ADDRESS = '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8' as Address;
export const REWARD_POOL_CONTRACT_ADDRESS = (import.meta.env.VITE_REWARD_POOL_CONTRACT_ADDRESS || '') as Address | '';
export const CLAIM_WINDOW_SECONDS = 60n * 60n * 24n * 14n;

const gdollarTokenAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

const identityAbi = [
  {
    type: 'function',
    name: 'isWhitelisted',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const quoterV2Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'fee', type: 'uint24' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const rewardPoolAbi = [
  {
    type: 'function',
    name: 'createCampaign',
    stateMutability: 'payable',
    inputs: [
      { name: 'requireIdentity', type: 'bool' },
      { name: 'claimWindowSeconds', type: 'uint64' },
    ],
    outputs: [{ name: 'campaignId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'finalizeSwap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'minGdOut', type: 'uint256' },
      { name: 'quoteDeadline', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'publishRoot',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawUnclaimed',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'swapRouter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'gdPoolFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'identityRegistry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'campaigns',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'project', type: 'address' },
      { name: 'ethDeposited', type: 'uint256' },
      { name: 'gdPool', type: 'uint256' },
      { name: 'gdClaimed', type: 'uint256' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'requireIdentity', type: 'bool' },
      { name: 'swapped', type: 'bool' },
      { name: 'finalized', type: 'bool' },
      { name: 'claimDeadline', type: 'uint64' },
    ],
  },
  {
    type: 'event',
    name: 'CampaignCreated',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'project', type: 'address' },
      { indexed: false, name: 'ethDeposited', type: 'uint256' },
      { indexed: false, name: 'requireIdentity', type: 'bool' },
    ],
  },
  {
    type: 'event',
    name: 'UnclaimedWithdrawn',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
] as const;

export const isRewardPoolConfigured = () => Boolean(REWARD_POOL_CONTRACT_ADDRESS && isAddress(REWARD_POOL_CONTRACT_ADDRESS));

function getConfiguredContractAddress(): Address {
  if (!REWARD_POOL_CONTRACT_ADDRESS || !isAddress(REWARD_POOL_CONTRACT_ADDRESS)) {
    throw new Error('The reward-pool contract address is not configured.');
  }
  return REWARD_POOL_CONTRACT_ADDRESS;
}

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

export function getWalletClient() {
  if (!window.ethereum) {
    throw new Error('Install a browser wallet to use the G$ reward pool.');
  }
  return createWalletClient({
    chain: celo,
    transport: custom(window.ethereum),
  });
}

export async function connectWallet() {
  const walletClient = getWalletClient();
  const [address] = await walletClient.requestAddresses();
  if (!address) throw new Error('No wallet account was selected.');
  const chainId = await walletClient.getChainId();
  if (chainId !== REWARD_POOL_CHAIN_ID) {
    try {
      await walletClient.switchChain({ id: REWARD_POOL_CHAIN_ID });
    } catch {
      throw new Error('Switch your wallet to Celo Mainnet (42220), not Sepolia, before continuing.');
    }
  }
  if (await walletClient.getChainId() !== REWARD_POOL_CHAIN_ID) {
    throw new Error('Your wallet did not switch to Celo Mainnet (42220). No transaction was requested.');
  }
  return { walletClient, address };
}

export async function createOnchainCampaign(celoAmount: string) {
  const contractAddress = getConfiguredContractAddress();
  const amount = parseEther(celoAmount);
  if (amount <= 0n) throw new Error('Enter a CELO funding amount greater than zero.');
  const { walletClient, address } = await connectWallet();
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'createCampaign',
    args: [true, CLAIM_WINDOW_SECONDS],
    account: address,
    value: amount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The funding transaction reverted.');
  const createdLog = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
    try {
      return decodeEventLog({ abi: rewardPoolAbi, data: log.data, topics: log.topics }).eventName === 'CampaignCreated';
    } catch {
      return false;
    }
  });
  if (!createdLog) throw new Error('The funding transaction completed without a campaign id.');
  const decoded = decodeEventLog({ abi: rewardPoolAbi, data: createdLog.data, topics: createdLog.topics });
  return { hash, address, onchainCampaignId: Number(decoded.args.campaignId) };
}

export async function quoteOnchainSwap(
  onchainCampaignId: number,
  expectedCeloRaw: string,
  slippageValue: string,
): Promise<RewardSwapQuote> {
  const contractAddress = getConfiguredContractAddress();
  const slippageBps = parseSlippageBps(slippageValue);
  if (!/^[1-9][0-9]*$/.test(expectedCeloRaw)) {
    throw new Error('The campaign funding amount is not valid.');
  }
  if (await publicClient.getChainId() !== REWARD_POOL_CHAIN_ID) {
    throw new Error('The quote service is not connected to Celo.');
  }
  const blockNumber = await publicClient.getBlockNumber();
  const quoteBlock = await publicClient.getBlock({ blockNumber });
  const campaign = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'campaigns',
    args: [BigInt(onchainCampaignId)],
    blockNumber,
  });
  if (
    campaign[1].toString() !== expectedCeloRaw ||
    campaign[5] !== true ||
    campaign[6] ||
    campaign[7]
  ) {
    throw new Error('The onchain campaign state no longer matches this funding record.');
  }
  const [routerAddress, fee, decimals] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: rewardPoolAbi,
      functionName: 'swapRouter',
      blockNumber,
    }),
    publicClient.readContract({
      address: contractAddress,
      abi: rewardPoolAbi,
      functionName: 'gdPoolFee',
      blockNumber,
    }),
    publicClient.readContract({
      address: GDOLLAR_TOKEN_ADDRESS,
      abi: gdollarTokenAbi,
      functionName: 'decimals',
      blockNumber,
    }),
  ]);
  if (
    !isAddress(routerAddress) ||
    routerAddress.toLowerCase() !== CELO_SWAP_ROUTER02_ADDRESS.toLowerCase() ||
    fee === 0
  ) {
    throw new Error('The deployed reward pool has no usable Celo swap route configured.');
  }
  const quote = await publicClient.simulateContract({
    address: CELO_QUOTER_V2_ADDRESS,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn: CELO_NATIVE_TOKEN_ADDRESS,
      tokenOut: GDOLLAR_TOKEN_ADDRESS,
      amountIn: campaign[1],
      fee,
      sqrtPriceLimitX96: 0n,
    }],
    blockNumber,
  });
  const quotedGdRaw = quote.result[0].toString();
  const minimumGdRaw = minimumReceivedFromQuote(quotedGdRaw, slippageBps);
  return {
    amountInRaw: campaign[1].toString(),
    quotedGdRaw,
    minimumGdRaw,
    slippageBps,
    tokenDecimals: decimals,
    blockNumber: blockNumber.toString(),
    deadlineTimestamp: (quoteBlock.timestamp + 60n).toString(),
    quotedAt: Date.now(),
  };
}

export function formatGdollarAmount(raw: string, decimals: number): string {
  return formatUnits(BigInt(raw), decimals);
}

export async function finalizeOnchainSwap(
  onchainCampaignId: number,
  expectedCeloRaw: string,
  quote: RewardSwapQuote,
) {
  const contractAddress = getConfiguredContractAddress();
  if (!isRewardSwapQuoteFresh(quote)) {
    throw new Error('The swap quote expired. Request a new quote before confirming.');
  }
  if (quote.amountInRaw !== expectedCeloRaw) {
    throw new Error('The quote no longer matches the recorded CELO funding amount.');
  }
  if (
    minimumReceivedFromQuote(quote.quotedGdRaw, quote.slippageBps) !==
    quote.minimumGdRaw
  ) {
    throw new Error('The quote minimum is invalid. Request a fresh quote.');
  }
  const quoteDeadline = BigInt(quote.deadlineTimestamp);
  const currentBlock = await publicClient.getBlock();
  if (
    quoteDeadline < currentBlock.timestamp ||
    quoteDeadline > currentBlock.timestamp + 60n
  ) {
    throw new Error('The onchain quote deadline passed. Request a fresh quote.');
  }
  const { walletClient, address } = await connectWallet();
  const campaign = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'campaigns',
    args: [BigInt(onchainCampaignId)],
  });
  if (
    campaign[0].toLowerCase() !== address.toLowerCase() ||
    campaign[1].toString() !== expectedCeloRaw ||
    campaign[5] !== true ||
    campaign[6] ||
    campaign[7]
  ) {
    throw new Error('Only the funding wallet can swap this unchanged eligible campaign.');
  }
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'finalizeSwap',
    args: [BigInt(onchainCampaignId), BigInt(quote.minimumGdRaw), quoteDeadline],
    account: address,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The swap transaction reverted.');
  const onchainCampaign = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'campaigns',
    args: [BigInt(onchainCampaignId)],
  });
  return { hash, gdPoolRaw: onchainCampaign[2].toString() };
}

export async function publishOnchainRoot(onchainCampaignId: number, merkleRoot: Hex) {
  const contractAddress = getConfiguredContractAddress();
  const { walletClient, address } = await connectWallet();
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'publishRoot',
    args: [BigInt(onchainCampaignId), merkleRoot],
    account: address,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The root publication transaction reverted.');
  return { hash };
}

export async function claimOnchainReward(onchainCampaignId: number, amountRaw: string, proof: string[], expectedWallet?: string) {
  const contractAddress = getConfiguredContractAddress();
  const { walletClient, address } = await connectWallet();
  if (expectedWallet && address.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error('Connect the wallet that owns this allocation before claiming.');
  }
  const campaign = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'campaigns',
    args: [BigInt(onchainCampaignId)],
  });
  if (campaign[5] !== true) {
    throw new Error('This campaign does not require verified GoodDollar identity.');
  }
  const identityRegistry = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'identityRegistry',
  });
  const isVerified = await publicClient.readContract({
    address: identityRegistry,
    abi: identityAbi,
    functionName: 'isWhitelisted',
    args: [address],
  });
  if (!isVerified) {
    throw new Error('Verify this wallet with GoodDollar before claiming.');
  }
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'claim',
    args: [BigInt(onchainCampaignId), BigInt(amountRaw), proof as Hex[]],
    account: address,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The reward claim transaction reverted.');
  return { hash, address };
}

export async function withdrawUnclaimedOnchainReward(onchainCampaignId: number) {
  const contractAddress = getConfiguredContractAddress();
  const { walletClient, address } = await connectWallet();
  const campaign = await publicClient.readContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'campaigns',
    args: [BigInt(onchainCampaignId)],
  });
  if (campaign[0].toLowerCase() !== address.toLowerCase()) {
    throw new Error('Connect the project wallet that funded this campaign to reclaim G$.');
  }
  if (!campaign[7] || campaign[8] === 0n) {
    throw new Error('The claim window has not started.');
  }
  const block = await publicClient.getBlock();
  if (block.timestamp <= campaign[8]) {
    throw new Error('The claim window is still open.');
  }
  if (campaign[2] <= campaign[3]) {
    throw new Error('There are no unclaimed G$ tokens left to reclaim.');
  }
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: rewardPoolAbi,
    functionName: 'withdrawUnclaimed',
    args: [BigInt(onchainCampaignId)],
    account: address,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The unclaimed G$ withdrawal reverted.');
  const withdrawalLog = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
    try {
      return decodeEventLog({
        abi: rewardPoolAbi,
        data: log.data,
        topics: log.topics,
      }).eventName === 'UnclaimedWithdrawn';
    } catch {
      return false;
    }
  });
  if (!withdrawalLog) throw new Error('The withdrawal completed without a verified refund event.');
  const decoded = decodeEventLog({
    abi: rewardPoolAbi,
    data: withdrawalLog.data,
    topics: withdrawalLog.topics,
  });
  if (
    decoded.eventName !== 'UnclaimedWithdrawn' ||
    decoded.args.campaignId !== BigInt(onchainCampaignId)
  ) {
    throw new Error('The refund event does not match this campaign.');
  }
  return { hash, amountRaw: decoded.args.amount.toString() };
}