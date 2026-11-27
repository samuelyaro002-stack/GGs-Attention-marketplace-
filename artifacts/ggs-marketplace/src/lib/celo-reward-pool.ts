import {
  createPublicClient, createWalletClient, custom, decodeEventLog,
  erc20Abi, getAddress, http, isAddress, keccak256, parseEther,
  type Address, type Hex,
} from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { celoRewardPoolAbi } from '@workspace/celo-contract';
import type { CeloRewardPoolConfig } from '@workspace/api-client-react';
export { celoRewardPoolAbi };

function chainFor(config: CeloRewardPoolConfig) {
  const chain = config.network === 'mainnet' ? celo : config.network === 'sepolia' ? celoSepolia : null;
  if (!chain || chain.id !== config.chainId) throw new Error('The selected Celo network configuration is inconsistent.');
  return chain;
}

function assertReady(config: CeloRewardPoolConfig) {
  if (!config.ready || !config.contractAddress || !config.protocolWallet ||
      !config.ownerWallet || !config.runtimeCodeHash) {
    throw new Error(config.reason ?? 'The selected Celo deployment is not approved.');
  }
  chainFor(config);
}

export function sameApprovedCeloConfig(a: CeloRewardPoolConfig, b: CeloRewardPoolConfig) {
  const sameAddress = (left: string | null, right: string | null) =>
    left?.toLowerCase() === right?.toLowerCase();
  return a.network === b.network && a.chainId === b.chainId && a.chainName === b.chainName &&
    a.rpcUrl === b.rpcUrl && a.explorerUrl === b.explorerUrl &&
    sameAddress(a.tokenAddress, b.tokenAddress) &&
    sameAddress(a.contractAddress, b.contractAddress) &&
    sameAddress(a.protocolWallet, b.protocolWallet) &&
    sameAddress(a.ownerWallet, b.ownerWallet) &&
    a.runtimeCodeHash?.toLowerCase() === b.runtimeCodeHash?.toLowerCase() &&
    a.protocolFeeBps === b.protocolFeeBps;
}

function publicClientFor(config: CeloRewardPoolConfig) {
  return createPublicClient({
    chain: chainFor(config),
    transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }),
  });
}

async function wallet(config: CeloRewardPoolConfig, expectedWallet?: string) {
  assertReady(config);
  const chain = chainFor(config);
  if (!window.ethereum) throw new Error(`Install an EVM wallet to use ${config.chainName}.`);
  const client = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await client.requestAddresses();
  if (!account) throw new Error('Connect a wallet.');
  if (expectedWallet && account.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error('Connect the wallet assigned to this campaign or allocation.');
  }
  try {
    await client.switchChain({ id: config.chainId });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902 &&
        (error as { cause?: { code?: number } }).cause?.code !== 4902) throw error;
    await client.addChain({ chain });
    await client.switchChain({ id: config.chainId });
  }
  if (await client.getChainId() !== config.chainId) throw new Error(`Switch to ${config.chainName}.`);
  return { client, account };
}

async function deployment(config: CeloRewardPoolConfig, address: string, protocolWallet: string) {
  assertReady(config);
  if (!isAddress(address) || !isAddress(protocolWallet) ||
      address.toLowerCase() !== config.contractAddress!.toLowerCase() ||
      protocolWallet.toLowerCase() !== config.protocolWallet!.toLowerCase()) {
    throw new Error('The transaction target does not match the approved Celo deployment.');
  }
  const publicClient = publicClientFor(config);
  const [chainId, code, tokenCode, tokenAddress, recipient, owner, fee] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBytecode({ address }),
    publicClient.getBytecode({ address: config.tokenAddress as Address }),
    publicClient.readContract({ address, abi: celoRewardPoolAbi, functionName: 'CELO' }),
    publicClient.readContract({ address, abi: celoRewardPoolAbi, functionName: 'protocolWallet' }),
    publicClient.readContract({ address, abi: celoRewardPoolAbi, functionName: 'owner' }),
    publicClient.readContract({ address, abi: celoRewardPoolAbi, functionName: 'PROTOCOL_FEE_BPS' }),
  ]);
  if (chainId !== config.chainId || !code || code === '0x' || !tokenCode || tokenCode === '0x' ||
      !config.runtimeCodeHash || keccak256(code) !== config.runtimeCodeHash ||
      tokenAddress.toLowerCase() !== config.tokenAddress.toLowerCase() ||
      owner.toLowerCase() !== config.ownerWallet!.toLowerCase() ||
      recipient.toLowerCase() !== protocolWallet.toLowerCase() || fee !== BigInt(config.protocolFeeBps)) {
    throw new Error('Deployment no longer matches the approved CELO configuration.');
  }
  return { address, publicClient };
}

export async function connectCeloWallet(config: CeloRewardPoolConfig) {
  const { account } = await wallet(config);
  return { address: account };
}

export async function connectCeloAddress(config: CeloRewardPoolConfig) {
  const chain = chainFor(config);
  if (!window.ethereum) throw new Error(`Install an EVM wallet to use ${config.chainName}.`);
  const client = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await client.requestAddresses();
  if (!account) throw new Error('Connect a wallet.');
  return { address: account };
}

export async function getCeloTokenBalance(config: CeloRewardPoolConfig, address: Address) {
  assertReady(config);
  return publicClientFor(config).readContract({
    address: config.tokenAddress as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

export async function fundCeloCampaign(input: {
  config: CeloRewardPoolConfig;
  contractAddress: string; protocolWallet: string; amount: string;
  beforeSignature: () => Promise<void>;
  onApproval?: (txHash: Hex) => void;
  onFundingStep?: () => void;
}) {
  const { address, publicClient } = await deployment(input.config, input.contractAddress, input.protocolWallet);
  const amount = parseEther(input.amount);
  if (amount <= 0n) throw new Error('Enter a positive CELO amount.');
  const { client, account } = await wallet(input.config);
  await input.beforeSignature();
  const allowance = await publicClient.readContract({
    address: input.config.tokenAddress as Address, abi: erc20Abi, functionName: 'allowance', args: [account, address],
  });
  if (allowance < amount) {
    await input.beforeSignature();
    const approval = await client.writeContract({
      account, address: input.config.tokenAddress as Address, abi: erc20Abi, functionName: 'approve', args: [address, amount],
    });
    input.onApproval?.(approval);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== 'success') throw new Error('CELO approval failed.');
  }
  await input.beforeSignature();
  await deployment(input.config, input.contractAddress, input.protocolWallet);
  input.onFundingStep?.();
  const args = [amount, false, 14n * 24n * 60n * 60n] as const;
  const simulation = await publicClient.simulateContract({
    account, address, abi: celoRewardPoolAbi, functionName: 'createCampaign', args,
  });
  await input.beforeSignature();
  // ERC20 transferFrom: never send native value to this nonpayable contract.
  const txHash = await client.writeContract(simulation.request);
  return { txHash, onchainCampaignId: Number(simulation.result) };
}

export async function recoverCeloFunding(txHash: Hex, contractAddress: string, config: CeloRewardPoolConfig) {
  assertReady(config);
  if (contractAddress.toLowerCase() !== config.contractAddress!.toLowerCase()) {
    throw new Error('The pending transaction belongs to a different approved Celo deployment.');
  }
  const publicClient = publicClientFor(config);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('CELO funding failed.');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: celoRewardPoolAbi, ...log });
      if (event.eventName === 'CampaignCreated') {
        const id = Number(event.args.campaignId);
        if (!Number.isSafeInteger(id) || id > 2147483647) throw new Error('Campaign id exceeds supported storage.');
        return { txHash, onchainCampaignId: id };
      }
    } catch { /* Other event emitted by this contract. */ }
  }
  throw new Error('No CELO campaign creation event found.');
}

export async function distributeCeloBatch(
  config: CeloRewardPoolConfig, contractAddress: string, id: number, recipients: string[], amounts: string[], ownerWallet: string,
) {
  if (recipients.length === 0 || recipients.length !== amounts.length ||
      new Set(recipients.map(value => value.toLowerCase())).size !== recipients.length ||
      recipients.some(value => !isAddress(value)) ||
      amounts.some(value => !/^[1-9]\d*$/.test(value))) {
    throw new Error('Payout recipients and positive amounts must match.');
  }
  if (ownerWallet.toLowerCase() !== config.ownerWallet?.toLowerCase()) {
    throw new Error('The selected wallet does not match the approved Celo contract administrator.');
  }
  const { client, account } = await wallet(config, ownerWallet);
  const { address, publicClient } = await deployment(config, contractAddress, config.protocolWallet ?? '');
  const { request } = await publicClient.simulateContract({
    account, address: address as Address, abi: celoRewardPoolAbi, functionName: 'distributeBatch',
    args: [BigInt(id), recipients.map(value => getAddress(value)), amounts.map(value => BigInt(value))],
  });
  return client.writeContract(request);
}

export async function refundCeloReward(
  config: CeloRewardPoolConfig, contractAddress: string, projectWallet: string, id: number,
) {
  const { client, account } = await wallet(config, projectWallet);
  const { address, publicClient } = await deployment(config, contractAddress, config.protocolWallet ?? '');
  const { request } = await publicClient.simulateContract({
    account, address: address as Address, abi: celoRewardPoolAbi,
    functionName: 'withdrawRemaining', args: [BigInt(id)],
  });
  return client.writeContract(request);
}

export async function waitForCeloTransaction(txHash: Hex, config: CeloRewardPoolConfig) {
  assertReady(config);
  const publicClient = publicClientFor(config);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error(`${config.chainName} transaction failed.`);
}