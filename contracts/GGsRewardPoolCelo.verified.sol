// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGoodDollarIdentity {
    function isWhitelisted(address account) external view returns (bool);
}

/// @title GGsRewardPoolCelo
/// @notice Pure-CELO reward pool -- no swaps, no bridged assets, no DEX
/// dependency. Projects fund a campaign directly in CELO (using Celo's
/// token-duality precompile, which treats the CELO ERC20 balance as
/// interchangeable with native CELO -- see
/// https://docs.celo.org/home/protocol/celo-token). A fixed 10% protocol fee
/// is taken immediately at creation, in the same transaction, before the
/// remaining 90% becomes the creator-claimable pool. Nothing ever changes
/// form between funding and payout, so every number in the pool is exactly
/// what it looks like on day one -- no slippage, no swap risk, no dependency
/// on a DEX having deep enough liquidity.
///
/// Verified address (Celo Mainnet, confirmed against
/// https://docs.celo.org/tooling/contracts/core-contracts as of this
/// writing -- reconfirm before deploying, addresses can change):
///   CELO (GoldToken): 0x471EcE3750Da237f93B8E339c536989b8978a438
/// On Celo Sepolia the same address is used (confirmed in Celo's own
/// Sepolia core-contracts table -- CELO's address is identical across
/// mainnet and this testnet).
contract GGsRewardPoolCelo is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_FEE_BPS = 1000; // fixed 10%, not owner-adjustable by design
    uint256 private constant BPS_DENOMINATOR = 10000;

    IERC20 public immutable CELO;
    IGoodDollarIdentity public identityRegistry;
    address public protocolWallet;

    struct Campaign {
        address project;
        uint256 grossDeposit;
        uint256 protocolFee;
        uint256 celoPool;       // grossDeposit - protocolFee -- the creator-claimable amount
        uint256 celoClaimed;
        bytes32 merkleRoot;
        bool requireIdentity;
        bool finalized;         // true once the Merkle root is published
        uint64 claimDeadline;
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event CampaignCreated(uint256 indexed campaignId, address indexed project, uint256 grossDeposit, uint256 protocolFee, uint256 celoPool, bool requireIdentity);
    event RootPublished(uint256 indexed campaignId, bytes32 merkleRoot);
    event Claimed(uint256 indexed campaignId, address indexed creator, uint256 amount);
    event UnclaimedWithdrawn(uint256 indexed campaignId, uint256 amount);
    event ProtocolWalletUpdated(address indexed newWallet);

    constructor(
        address _celo,
        address _identityRegistry,
        address _protocolWallet
    ) Ownable(msg.sender) {
        require(_protocolWallet != address(0), "protocol wallet required");
        CELO = IERC20(_celo);
        identityRegistry = IGoodDollarIdentity(_identityRegistry); // address(0) disables the identity gate option
        protocolWallet = _protocolWallet;
    }

    /// @notice Project registers a campaign and deposits CELO. The 10% fee
    /// is taken and the creator pool is locked in, in this same transaction
    /// -- no separate settlement step, nothing left pending. Project must
    /// approve() this contract for `amount` on the CELO token beforehand.
    function createCampaign(
        uint256 amount,
        bool requireIdentity,
        uint64 claimWindowSeconds
    ) external returns (uint256 campaignId) {
        require(amount > 0, "pool must be > 0");
        if (requireIdentity) {
            require(address(identityRegistry) != address(0), "identity registry not set");
        }

        CELO.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorPool = amount - fee;

        campaignId = campaignCount++;
        campaigns[campaignId] = Campaign({
            project: msg.sender,
            grossDeposit: amount,
            protocolFee: fee,
            celoPool: creatorPool,
            celoClaimed: 0,
            merkleRoot: bytes32(0),
            requireIdentity: requireIdentity,
            finalized: false,
            claimDeadline: uint64(block.timestamp) + claimWindowSeconds
        });

        if (fee > 0) {
            CELO.safeTransfer(protocolWallet, fee);
        }

        emit CampaignCreated(campaignId, msg.sender, amount, fee, creatorPool, requireIdentity);
    }

    /// @notice Publishes the final XP-based CELO distribution as a Merkle root.
    function publishRoot(uint256 campaignId, bytes32 merkleRoot) external {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(!c.finalized, "root already published");
        c.merkleRoot = merkleRoot;
        c.finalized = true;
        emit RootPublished(campaignId, merkleRoot);
    }

    /// @notice Creator claims their CELO share. leaf = keccak256(abi.encodePacked(campaignId, creator, amount)).
    function claim(uint256 campaignId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        require(c.finalized, "distribution not published yet");
        require(!hasClaimed[campaignId][msg.sender], "already claimed");
        require(block.timestamp <= c.claimDeadline, "claim window closed");

        if (c.requireIdentity) {
            require(identityRegistry.isWhitelisted(msg.sender), "wallet not verified as unique human");
        }

        bytes32 leaf = keccak256(abi.encodePacked(campaignId, msg.sender, amount));
        require(MerkleProof.verify(proof, c.merkleRoot, leaf), "invalid proof");

        hasClaimed[campaignId][msg.sender] = true;
        c.celoClaimed += amount;
        require(c.celoClaimed <= c.celoPool, "exceeds pool");

        CELO.safeTransfer(msg.sender, amount);
        emit Claimed(campaignId, msg.sender, amount);
    }

    /// @notice After the claim window closes, the project reclaims unclaimed CELO.
    function withdrawUnclaimed(uint256 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(block.timestamp > c.claimDeadline, "claim window still open");
        uint256 remaining = c.celoPool - c.celoClaimed;
        require(remaining > 0, "nothing left to withdraw");
        c.celoClaimed = c.celoPool;
        CELO.safeTransfer(c.project, remaining);
        emit UnclaimedWithdrawn(campaignId, remaining);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        identityRegistry = IGoodDollarIdentity(_identityRegistry);
    }

    function setProtocolWallet(address _protocolWallet) external onlyOwner {
        require(_protocolWallet != address(0), "zero address");
        protocolWallet = _protocolWallet;
        emit ProtocolWalletUpdated(_protocolWallet);
    }
}
