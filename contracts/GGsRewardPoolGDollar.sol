// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

interface IGoodDollarIdentity {
    function isWhitelisted(address account) external view returns (bool);
}

/// @title GGsRewardPoolGDollar
/// @notice Projects fund campaigns with native CELO, swap the pool to G$, then
/// publish an XP-based Merkle distribution for creators to claim.
///
/// This contract is deployment-ready, but the router, WETH, identity registry,
/// fee tier, and contract address must be configured and verified per chain.
/// Review and audit before sending real funds.
contract GGsRewardPoolGDollar is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Celo's native CELO token also implements ERC-20. It is not WETH
    /// and must not be wrapped with a WETH9 deposit call.
    IERC20 public immutable CELO;
    IERC20 public immutable GDOLLAR;
    ISwapRouter02 public immutable swapRouter;
    IGoodDollarIdentity public identityRegistry;
    uint24 public gdPoolFee;

    struct Campaign {
        address project;
        // Legacy field name: on Celo this is the native CELO amount in wei.
        uint256 ethDeposited;
        uint256 gdPool;
        uint256 gdClaimed;
        bytes32 merkleRoot;
        bool requireIdentity;
        bool swapped;
        bool finalized;
        uint64 claimDeadline;
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => uint64) public campaignClaimDurations;

    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed project,
        uint256 ethDeposited,
        bool requireIdentity
    );
    event Swapped(uint256 indexed campaignId, uint256 ethIn, uint256 gdOut);
    event RootPublished(uint256 indexed campaignId, bytes32 merkleRoot);
    event Claimed(uint256 indexed campaignId, address indexed creator, uint256 amount);
    event UnclaimedWithdrawn(uint256 indexed campaignId, uint256 amount);

    constructor(
        address _celoToken,
        address _gDollar,
        address _swapRouter,
        address _identityRegistry,
        uint24 _gdPoolFee
    ) Ownable(msg.sender) {
        require(_celoToken != address(0), "CELO token required");
        require(_gDollar != address(0), "G$ token required");
        require(_swapRouter != address(0), "swap router required");
        require(_identityRegistry != address(0), "identity registry required");
        CELO = IERC20(_celoToken);
        GDOLLAR = IERC20(_gDollar);
        swapRouter = ISwapRouter02(_swapRouter);
        identityRegistry = IGoodDollarIdentity(_identityRegistry);
        gdPoolFee = _gdPoolFee;
    }

    function createCampaign(
        bool requireIdentity,
        uint64 claimWindowSeconds
    ) external payable returns (uint256 campaignId) {
        require(msg.value > 0, "must deposit CELO");
        require(
            claimWindowSeconds >= 1 days && claimWindowSeconds <= 90 days,
            "claim window must be 1-90 days"
        );
        if (requireIdentity) {
            require(
                address(identityRegistry) != address(0),
                "identity registry not set on this chain"
            );
        }

        campaignId = campaignCount++;
        campaigns[campaignId] = Campaign({
            project: msg.sender,
            ethDeposited: msg.value,
            gdPool: 0,
            gdClaimed: 0,
            merkleRoot: bytes32(0),
            requireIdentity: requireIdentity,
            swapped: false,
            finalized: false,
            claimDeadline: 0
        });
        campaignClaimDurations[campaignId] = claimWindowSeconds;
        emit CampaignCreated(campaignId, msg.sender, msg.value, requireIdentity);
    }

    function finalizeSwap(
        uint256 campaignId,
        uint256 minGdOut,
        uint64 quoteDeadline
    )
        external
        nonReentrant
    {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(!c.swapped, "already swapped");
        require(minGdOut > 0, "minimum output required");
        require(
            quoteDeadline >= block.timestamp &&
                quoteDeadline <= block.timestamp + 60,
            "swap quote expired"
        );

        // CELO is dual-native/ERC-20 on Celo. The payable funding transfer is
        // already reflected in this contract's CELO balance; no wrapping step
        // is needed or supported.
        CELO.forceApprove(address(swapRouter), c.ethDeposited);

        ISwapRouter02.ExactInputSingleParams memory params =
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(CELO),
                tokenOut: address(GDOLLAR),
                fee: gdPoolFee,
                recipient: address(this),
                amountIn: c.ethDeposited,
                amountOutMinimum: minGdOut,
                sqrtPriceLimitX96: 0
            });

        uint256 gdOut = swapRouter.exactInputSingle(params);
        require(gdOut > 0, "swap returned no G$");
        CELO.forceApprove(address(swapRouter), 0);
        c.gdPool = gdOut;
        c.swapped = true;
        emit Swapped(campaignId, c.ethDeposited, gdOut);
    }

    function publishRoot(uint256 campaignId, bytes32 merkleRoot) external {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(c.swapped, "swap to G$ first");
        require(!c.finalized, "root already published");
        require(merkleRoot != bytes32(0), "empty merkle root");
        c.merkleRoot = merkleRoot;
        c.claimDeadline = uint64(block.timestamp) + campaignClaimDurations[campaignId];
        c.finalized = true;
        emit RootPublished(campaignId, merkleRoot);
    }

    function claim(
        uint256 campaignId,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        require(c.finalized, "distribution not published yet");
        require(!hasClaimed[campaignId][msg.sender], "already claimed");
        require(c.claimDeadline != 0, "claim window not started");
        require(block.timestamp <= c.claimDeadline, "claim window closed");

        if (c.requireIdentity) {
            require(
                identityRegistry.isWhitelisted(msg.sender),
                "wallet not verified as unique human"
            );
        }

        bytes32 leaf = keccak256(abi.encodePacked(campaignId, msg.sender, amount));
        require(MerkleProof.verify(proof, c.merkleRoot, leaf), "invalid proof");

        hasClaimed[campaignId][msg.sender] = true;
        c.gdClaimed += amount;
        require(c.gdClaimed <= c.gdPool, "exceeds pool");
        GDOLLAR.safeTransfer(msg.sender, amount);
        emit Claimed(campaignId, msg.sender, amount);
    }

    function withdrawUnclaimed(uint256 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(c.finalized && c.claimDeadline != 0, "claim window not started");
        require(block.timestamp > c.claimDeadline, "claim window still open");
        uint256 remaining = c.gdPool - c.gdClaimed;
        require(remaining > 0, "nothing left to withdraw");
        c.gdClaimed = c.gdPool;
        GDOLLAR.safeTransfer(c.project, remaining);
        emit UnclaimedWithdrawn(campaignId, remaining);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        require(_identityRegistry != address(0), "identity registry required");
        identityRegistry = IGoodDollarIdentity(_identityRegistry);
    }
}