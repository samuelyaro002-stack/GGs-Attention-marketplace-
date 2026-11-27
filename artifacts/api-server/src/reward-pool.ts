import {
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  type Hex,
} from "viem";

export const REWARD_POOL_CHAIN_ID = 42220;
export const REWARD_POOL_CHAIN_NAME = "Celo";
export const GDOLLAR_TOKEN_ADDRESS =
  "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
export const REWARD_POOL_CONTRACT_ADDRESS =
  process.env.REWARD_POOL_CONTRACT_ADDRESS ?? null;

type DistributionInput = {
  walletAddress: string;
  handle: string;
  xp: number;
};

type MerkleLeaf = DistributionInput & {
  amountRaw: bigint;
  proof: Hex[];
  eligible: true;
};

function hashLeaf(
  campaignId: number,
  walletAddress: string,
  amountRaw: bigint,
): Hex {
  return keccak256(
    encodePacked(
      ["uint256", "address", "uint256"],
      [BigInt(campaignId), getAddress(walletAddress), amountRaw],
    ),
  );
}

function hashPair(left: Hex, right: Hex): Hex {
  return keccak256(
    left.toLowerCase() <= right.toLowerCase()
      ? (`${left}${right.slice(2)}` as Hex)
      : (`${right}${left.slice(2)}` as Hex),
  );
}

function buildMerkleProofs(
  leaves: Array<{ hash: Hex; index: number }>,
): { root: Hex; proofs: Hex[][] } {
  if (leaves.length === 0) {
    throw new Error("Cannot build a Merkle tree without leaves");
  }

  let layer = leaves.map((leaf) => ({
    hash: leaf.hash,
    leafIndices: [leaf.index],
  }));
  const proofs = leaves.map(() => [] as Hex[]);

  while (layer.length > 1) {
    const nextLayer: Array<{ hash: Hex; leafIndices: number[] }> = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1];
      if (!right) {
        nextLayer.push(left);
        continue;
      }

      const pairHash = hashPair(left.hash, right.hash);
      nextLayer.push({
        hash: pairHash,
        leafIndices: [...left.leafIndices, ...right.leafIndices],
      });
      for (const leafIndex of left.leafIndices) {
        proofs[leafIndex].push(right.hash);
      }
      for (const leafIndex of right.leafIndices) {
        proofs[leafIndex].push(left.hash);
      }
    }
    layer = nextLayer;
  }

  return { root: layer[0].hash, proofs };
}

function parseRawAmount(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("Reward pool amounts must be unsigned integer strings");
  }
  return BigInt(value);
}

export function buildRewardDistribution(
  campaignId: number,
  gdPoolRaw: string,
  inputs: DistributionInput[],
) {
  const gdPool = parseRawAmount(gdPoolRaw);
  if (gdPool <= 0n) throw new Error("The campaign has no G$ pool yet");
  if (inputs.length === 0) throw new Error("The campaign has no submissions yet");

  const grouped = new Map<string, DistributionInput>();
  for (const input of inputs) {
    if (!isAddress(input.walletAddress)) {
      throw new Error(
        `Every submission needs a valid wallet address before publishing the root (${input.handle})`,
      );
    }
    const address = getAddress(input.walletAddress).toLowerCase();
    const existing = grouped.get(address);
    grouped.set(address, {
      walletAddress: getAddress(input.walletAddress),
      handle: existing ? existing.handle : input.handle,
      xp: (existing?.xp ?? 0) + input.xp,
    });
  }

  const eligible = Array.from(grouped.values()).sort((a, b) => b.xp - a.xp);
  const totalXp = eligible.reduce((total, item) => total + item.xp, 0);
  let totalAllocated = 0n;
  const leaves: MerkleLeaf[] = eligible.map((item) => {
    const amountRaw = (gdPool * BigInt(item.xp)) / BigInt(totalXp);
    totalAllocated += amountRaw;
    return { ...item, amountRaw, proof: [], eligible: true };
  });

  if (leaves.length > 0) {
    leaves[0].amountRaw += gdPool - totalAllocated;
  }

  const tree = buildMerkleProofs(
    leaves.map((leaf, index) => ({
      hash: hashLeaf(campaignId, leaf.walletAddress, leaf.amountRaw),
      index,
    })),
  );

  return {
    root: tree.root,
    totalAllocatedRaw: leaves
      .reduce((total, leaf) => total + leaf.amountRaw, 0n)
      .toString(),
    leaves: leaves.map((leaf, index) => ({
      walletAddress: leaf.walletAddress,
      handle: leaf.handle,
      amountRaw: leaf.amountRaw.toString(),
      proof: tree.proofs[index],
      eligible: true as const,
    })),
  };
}

export function getRewardClaim(
  campaignId: number,
  gdPoolRaw: string,
  merkleRoot: string,
  inputs: DistributionInput[],
  walletAddress: string,
) {
  const distribution = buildRewardDistribution(campaignId, gdPoolRaw, inputs);
  const wallet = getAddress(walletAddress).toLowerCase();
  const leaf = distribution.leaves.find(
    (candidate) => candidate.walletAddress.toLowerCase() === wallet,
  );
  if (!leaf) throw new Error("No reward allocation found for this wallet");
  if (distribution.root.toLowerCase() !== merkleRoot.toLowerCase()) {
    throw new Error("The stored Merkle root does not match the current scores");
  }
  return {
    walletAddress: leaf.walletAddress,
    amountRaw: leaf.amountRaw,
    proof: leaf.proof,
  };
}