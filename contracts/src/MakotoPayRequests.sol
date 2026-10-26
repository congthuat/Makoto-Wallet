// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Minimal ERC-20 surface used by this contract.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Makoto Pay Requests
/// @notice Payment requests and bill splitting on Arc.
///         - Non-custodial: every payment goes directly from the payer to the payee;
///           this contract never holds tokens.
///         - No owner, no admin, no upgrade path, no fees.
///         - Only the two stablecoins fixed at deployment (USDC and EURC on Arc) are accepted.
/// @dev A request is either an invoice (maxPayments = 1, optionally restricted to one payer)
///      or a split bill (maxPayments = N, each address may pay one share once).
contract MakotoPayRequests {
    struct Request {
        address payee; // receives every payment
        uint96 amount; // amount per payment, in token units
        address token; // one of the two allowlisted stablecoins
        uint32 maxPayments; // 1 = invoice, N = split bill
        uint32 paidCount; // payments received so far
        address allowedPayer; // address(0) = anyone may pay
        uint64 expiresAt; // unix seconds; 0 = never expires
        bool cancelled;
    }

    enum Status {
        Open,
        Completed,
        Cancelled,
        Expired
    }

    uint256 public constant MAX_PAYMENTS = 100;
    uint256 public constant MAX_MEMO_BYTES = 140;

    address public immutable tokenA;
    address public immutable tokenB;

    uint256 public requestCount;
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => string) private _memos;
    mapping(uint256 => mapping(address => bool)) public hasPaid;

    event RequestCreated(
        uint256 indexed id,
        address indexed payee,
        address indexed token,
        uint256 amount,
        uint32 maxPayments,
        address allowedPayer,
        uint64 expiresAt,
        string memo
    );
    event Paid(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint32 paidCount);
    event Cancelled(uint256 indexed id, address indexed payee);

    error TokenNotAllowed();
    error InvalidAmount();
    error InvalidMaxPayments();
    error InvalidAllowedPayer();
    error InvalidExpiry();
    error MemoTooLong();
    error RequestNotFound();
    error RequestCancelled();
    error RequestExpired();
    error RequestComplete();
    error NotAllowedPayer();
    error AlreadyPaid();
    error PayeeCannotPay();
    error NotPayee();
    error TransferFailed();
    error InvalidToken();

    constructor(address tokenA_, address tokenB_) {
        if (tokenA_ == address(0) || tokenB_ == address(0) || tokenA_ == tokenB_) revert InvalidToken();
        if (tokenA_.code.length == 0 || tokenB_.code.length == 0) revert InvalidToken();
        tokenA = tokenA_;
        tokenB = tokenB_;
    }

    /// @notice Create an invoice or a split bill. The caller becomes the payee.
    function createRequest(
        address token,
        uint96 amount,
        uint32 maxPayments,
        address allowedPayer,
        uint64 expiresAt,
        string calldata memo
    ) external returns (uint256 id) {
        if (token != tokenA && token != tokenB) revert TokenNotAllowed();
        if (amount == 0) revert InvalidAmount();
        if (maxPayments == 0 || maxPayments > MAX_PAYMENTS) revert InvalidMaxPayments();
        if (allowedPayer != address(0) && (maxPayments != 1 || allowedPayer == msg.sender)) revert InvalidAllowedPayer();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();

        id = ++requestCount;
        _requests[id] = Request({
            payee: msg.sender,
            amount: amount,
            token: token,
            maxPayments: maxPayments,
            paidCount: 0,
            allowedPayer: allowedPayer,
            expiresAt: expiresAt,
            cancelled: false
        });
        if (bytes(memo).length != 0) _memos[id] = memo;
        emit RequestCreated(id, msg.sender, token, amount, maxPayments, allowedPayer, expiresAt, memo);
    }

    /// @notice Pay one share of a request. The payer must first approve exactly `amount` of `token`.
    function pay(uint256 id) external {
        Request storage r = _requests[id];
        if (r.payee == address(0)) revert RequestNotFound();
        if (r.cancelled) revert RequestCancelled();
        if (r.expiresAt != 0 && block.timestamp > r.expiresAt) revert RequestExpired();
        if (r.paidCount >= r.maxPayments) revert RequestComplete();
        if (msg.sender == r.payee) revert PayeeCannotPay();
        if (r.allowedPayer != address(0) && msg.sender != r.allowedPayer) revert NotAllowedPayer();
        if (hasPaid[id][msg.sender]) revert AlreadyPaid();

        // Effects before the external call (checks-effects-interactions).
        hasPaid[id][msg.sender] = true;
        uint32 count = r.paidCount + 1;
        r.paidCount = count;

        _safeTransferFrom(r.token, msg.sender, r.payee, r.amount);
        emit Paid(id, msg.sender, r.payee, r.amount, count);
    }

    /// @notice Stop accepting payments. Payments already made are final (they went straight to the payee).
    function cancel(uint256 id) external {
        Request storage r = _requests[id];
        if (r.payee == address(0)) revert RequestNotFound();
        if (msg.sender != r.payee) revert NotPayee();
        if (r.cancelled) revert RequestCancelled();
        r.cancelled = true;
        emit Cancelled(id, msg.sender);
    }

    function getRequest(uint256 id) external view returns (Request memory request, string memory memo, Status status) {
        request = _requests[id];
        if (request.payee == address(0)) revert RequestNotFound();
        memo = _memos[id];
        status = _status(request);
    }

    function statusOf(uint256 id) external view returns (Status) {
        Request memory r = _requests[id];
        if (r.payee == address(0)) revert RequestNotFound();
        return _status(r);
    }

    function _status(Request memory r) private view returns (Status) {
        if (r.cancelled) return Status.Cancelled;
        if (r.paidCount >= r.maxPayments) return Status.Completed;
        if (r.expiresAt != 0 && block.timestamp > r.expiresAt) return Status.Expired;
        return Status.Open;
    }

    /// @dev Supports tokens that return nothing or a bool.
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
