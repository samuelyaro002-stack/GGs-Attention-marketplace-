// SPDX-License-Identifier: MIT
// HISTORICAL swap-based design, not the deployed pure-CELO contract.
// Current verified Sepolia source: GGsRewardPoolCelo.verified.sol.
// Do not generate the app ABI from this historical file.
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice SwapRouter02 interface (exactInputSingle) -- NOT the original
/// SwapRouter. SwapRouter02, which is what's actually deployed at the Celo
/// address below, dropped the `deadline` field that the original V3
/// periphery SwapRouter had. Confirm this struct against the live ABI on
/// Celoscan before deploying -- a mismatched struct fails the call outright
/// rather than misbehaving silently, but better to catch it before spending gas.
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
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IGoodDollarIdentity {
    function isWhitelisted(address account) external view returns (bool);
}

/// @title GGsRewardPoolCelo
/// @notice Projects fund a campaign in either native-equivalent CELO (the
/// CeloToken/GoldToken ERC20, which Celo's token-duality precompile treats as
/// interchangeable with a native CELO balance -- see
/// https://docs.celo.org/home/protocol/celo-token) or bridged ETH (WETH on
/// Celo L2). Creators are always paid out in CELO. A fixed 10% protocol fee
/// is taken off the top of every campaign's pool, sent to a designated
/// protocol wallet, before the remaining 90% becomes the creator reward pool.
///
/// Verified addresses used below (Celo Mainnet, confirmed against
/// https://docs.celo.org/tooling/contracts/core-contracts and
/// https://docs.celo.org/tooling/contracts/uniswap-contracts and
/// https://docs.celo.org/home/bridged-tokens/bridges as of this writing --
/// reconfirm before deploying, addresses can change):
///   CELO (GoldToken):         0x471EcE3750Da237f93B8E339c536989b8978a438
///   WETH (bridged):           0xD221812de1BD094f35587EE8E174B07B6167D9Af
///   Uniswap V3 SwapRouter02:  0x5615CDAb10dc425a742d643d949a7F474C01abc4
contract GGsRewardPoolCelo is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_FEE_BPS = 1000; // fixed 10%, not owner-adjustable by design
    uint256 private constant BPS_DENOMINATOR = 10000;

    IERC20 public immutable CELO;
    IERC20 public immutable WETH;
    ISwapRouter02 public immutable swapRouter;
    IGoodDollarIdentity public identityRegistry;
    address public protocolWallet;
    uint24 public wethCeloPoolFee; // Uniswap V3 fee tier for the WETH/CELO pool -- verify current tier before deploying

    struct Campaign {
        address project;
        address fundingToken;   // CELO address or WETH address -- nothing else accepted
        uint256 amountDeposited;
        uint256 celoPool;       // the actual creator-claimable pool, after the 10% fee
        uint256 celoClaimed;
        bytes32 merkleRoot;
        bool requireIdentity;
        bool settled;           // true once the pool is in CELO and the fee has been taken
        bool finalized;         // true once the Merkle root is published
        uint64 claimDeadline;
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event CampaignCreated(uint256 indexed campaignId, address indexed project, address fundingToken, uint256 amountDeposited, bool requireIdentity);
    event PoolSettled(uint256 indexed campaignId, uint256 grossCelo, uint256 protocolFee, uint256 creatorPool);
    event RootPublished(uint256 indexed campaignId, bytes32 merkleRoot);
    event Claimed(uint256 indexed campaignId, address indexed creator, uint256 amount);
    event UnclaimedWithdrawn(uint256 indexed campaignId, uint256 amount);
    event ProtocolWalletUpdated(address indexed newWallet);

    constructor(
        address _celo,
        address _weth,
        address _swapRouter,
        address _identityRegistry,
        address _protocolWallet,
        uint24 _wethCeloPoolFee
    ) Ownable(msg.sender) {
        require(_protocolWallet != address(0), "protocol wallet required");
        CELO = IERC20(_celo);
        WETH = IERC20(_weth);
        swapRouter = ISwapRouter02(_swapRouter);
        identityRegistry = IGoodDollarIdentity(_identityRegistry); // address(0) disables the identity gate option
        protocolWallet = _protocolWallet;
        wethCeloPoolFee = _wethCeloPoolFee;
    }

    /// @notice Project registers a campaign and deposits either CELO or WETH.
    /// Project must approve() this contract for `amount` beforehand -- CELO's
    /// token duality makes this a normal ERC20 approve/transferFrom even
    /// though the same balance also shows as native CELO in a wallet.
    function createCampaign(
        address fundingToken,
        uint256 amount,
        bool requireIdentity,
        uint64 claimWindowSeconds
    ) external returns (uint256 campaignId) {
        require(amount > 0, "pool must be > 0");
        require(fundingToken == address(CELO) || fundingToken == address(WETH), "fund in CELO or WETH only");
        if (requireIdentity) {
            require(address(identityRegistry) != address(0), "identity registry not set");
        }

        campaignId = campaignCount++;
        campaigns[campaignId] = Campaign({
            project: msg.sender,
            fundingToken: fundingToken,
            amountDeposited: amount,
            celoPool: 0,
            celoClaimed: 0,
            merkleRoot: bytes32(0),
            requireIdentity: requireIdentity,
            settled: false,
            finalized: false,
            claimDeadline: uint64(block.timestamp) + claimWindowSeconds
        });

        IERC20(fundingToken).safeTransferFrom(msg.sender, address(this), amount);
        emit CampaignCreated(campaignId, msg.sender, fundingToken, amount, requireIdentity);

        // CELO-funded campaigns need no swap -- settle the fee immediately.
        if (fundingToken == address(CELO)) {
            _settlePool(campaignId, amount);
        }
    }

    /// @notice For WETH-funded campaigns only: swaps the deposited WETH into
    /// CELO via Uniswap V3, then settles the 10% protocol fee. minCeloOut is
    /// your slippage floor -- get a fresh quote immediately before calling.
    function finalizeSwap(uint256 campaignId, uint256 minCeloOut) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(c.fundingToken == address(WETH), "only WETH-funded campaigns need a swap");
        require(!c.settled, "already settled");

        WETH.forceApprove(address(swapRouter), c.amountDeposited);
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(WETH),
            tokenOut: address(CELO),
            fee: wethCeloPoolFee,
            recipient: address(this),
            amountIn: c.amountDeposited,
            amountOutMinimum: minCeloOut,
            sqrtPriceLimitX96: 0
        });
        uint256 celoReceived = swapRouter.exactInputSingle(params);

        _settlePool(campaignId, celoReceived);
    }

    /// @dev Takes the fixed 10% protocol fee out of `grossCelo` and locks in
    /// the remaining amount as the campaign's creator-claimable pool.
    function _settlePool(uint256 campaignId, uint256 grossCelo) private {
        Campaign storage c = campaigns[campaignId];
        uint256 fee = (grossCelo * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorPool = grossCelo - fee;

        c.celoPool = creatorPool;
        c.settled = true;

        if (fee > 0) {
            CELO.safeTransfer(protocolWallet, fee);
        }
        emit PoolSettled(campaignId, grossCelo, fee, creatorPool);
    }

    /// @notice Publishes the final XP-based CELO distribution as a Merkle root.
    function publishRoot(uint256 campaignId, bytes32 merkleRoot) external {
        Campaign storage c = campaigns[campaignId];
        require(msg.sender == c.project, "only campaign owner");
        require(c.settled, "pool not settled yet");
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
