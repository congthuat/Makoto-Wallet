// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MakotoPayRequests} from "../src/MakotoPayRequests.sol";

contract MockStable {
    string public symbol;
    uint8 public constant decimals = 6;
    bool public failTransfers;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory symbol_) { symbol = symbol_; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function setFail(bool value) external { failTransfers = value; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MakotoPayRequestsTest is Test {
    MakotoPayRequests internal pr;
    MockStable internal usdc;
    MockStable internal eurc;
    MockStable internal other;
    address internal payee = makeAddr("payee");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    event RequestCreated(uint256 indexed id, address indexed payee, address indexed token, uint256 amount, uint32 maxPayments, address allowedPayer, uint64 expiresAt, string memo);
    event Paid(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint32 paidCount);
    event Cancelled(uint256 indexed id, address indexed payee);

    function setUp() public {
        usdc = new MockStable("USDC");
        eurc = new MockStable("EURC");
        other = new MockStable("FAKE");
        pr = new MakotoPayRequests(address(usdc), address(eurc));
        for (uint256 i; i < 3; i++) {
            address who = [alice, bob, carol][i];
            usdc.mint(who, 1_000e6);
            eurc.mint(who, 1_000e6);
            vm.startPrank(who);
            usdc.approve(address(pr), type(uint256).max);
            eurc.approve(address(pr), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _invoice(uint96 amount, address payer) internal returns (uint256) {
        vm.prank(payee);
        return pr.createRequest(address(usdc), amount, 1, payer, 0, "Dinner");
    }

    function test_constructorRejectsBadTokens() public {
        vm.expectRevert(MakotoPayRequests.InvalidToken.selector);
        new MakotoPayRequests(address(0), address(eurc));
        vm.expectRevert(MakotoPayRequests.InvalidToken.selector);
        new MakotoPayRequests(address(usdc), address(usdc));
        vm.expectRevert(MakotoPayRequests.InvalidToken.selector);
        new MakotoPayRequests(address(usdc), makeAddr("eoa"));
    }

    function test_invoicePaysPayeeDirectlyAndCompletes() public {
        vm.expectEmit(true, true, true, true);
        emit RequestCreated(1, payee, address(usdc), 25e6, 1, address(0), 0, "Dinner");
        uint256 id = _invoice(25e6, address(0));
        assertEq(id, 1);

        vm.expectEmit(true, true, true, true);
        emit Paid(id, alice, payee, 25e6, 1);
        vm.prank(alice);
        pr.pay(id);

        assertEq(usdc.balanceOf(payee), 25e6);
        assertEq(usdc.balanceOf(alice), 975e6);
        assertEq(usdc.balanceOf(address(pr)), 0, "contract never holds funds");
        assertTrue(pr.hasPaid(id, alice));
        assertEq(uint8(pr.statusOf(id)), uint8(MakotoPayRequests.Status.Completed));

        vm.prank(bob);
        vm.expectRevert(MakotoPayRequests.RequestComplete.selector);
        pr.pay(id);
    }

    function test_splitBillOneShareEachAndNoDoublePay() public {
        vm.prank(payee);
        uint256 id = pr.createRequest(address(eurc), 10e6, 3, address(0), 0, "Taxi split");
        vm.prank(alice); pr.pay(id);
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.AlreadyPaid.selector);
        pr.pay(id);
        vm.prank(bob); pr.pay(id);
        assertEq(uint8(pr.statusOf(id)), uint8(MakotoPayRequests.Status.Open));
        vm.prank(carol); pr.pay(id);
        assertEq(eurc.balanceOf(payee), 30e6);
        (MakotoPayRequests.Request memory r, string memory memo, MakotoPayRequests.Status status) = pr.getRequest(id);
        assertEq(r.paidCount, 3);
        assertEq(memo, "Taxi split");
        assertEq(uint8(status), uint8(MakotoPayRequests.Status.Completed));
    }

    function test_allowedPayerOnly() public {
        uint256 id = _invoice(5e6, bob);
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.NotAllowedPayer.selector);
        pr.pay(id);
        vm.prank(bob); pr.pay(id);
        assertEq(usdc.balanceOf(payee), 5e6);
    }

    function test_createValidation() public {
        vm.startPrank(payee);
        vm.expectRevert(MakotoPayRequests.TokenNotAllowed.selector);
        pr.createRequest(address(other), 1, 1, address(0), 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidAmount.selector);
        pr.createRequest(address(usdc), 0, 1, address(0), 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidMaxPayments.selector);
        pr.createRequest(address(usdc), 1, 0, address(0), 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidMaxPayments.selector);
        pr.createRequest(address(usdc), 1, 101, address(0), 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidAllowedPayer.selector);
        pr.createRequest(address(usdc), 1, 2, alice, 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidAllowedPayer.selector);
        pr.createRequest(address(usdc), 1, 1, payee, 0, "");
        vm.expectRevert(MakotoPayRequests.InvalidExpiry.selector);
        pr.createRequest(address(usdc), 1, 1, address(0), uint64(block.timestamp), "");
        vm.expectRevert(MakotoPayRequests.MemoTooLong.selector);
        pr.createRequest(address(usdc), 1, 1, address(0), 0, string(new bytes(141)));
        vm.stopPrank();
    }

    function test_expiry() public {
        vm.prank(payee);
        uint256 id = pr.createRequest(address(usdc), 1e6, 2, address(0), uint64(block.timestamp + 1 days), "");
        vm.prank(alice); pr.pay(id);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(pr.statusOf(id)), uint8(MakotoPayRequests.Status.Expired));
        vm.prank(bob);
        vm.expectRevert(MakotoPayRequests.RequestExpired.selector);
        pr.pay(id);
    }

    function test_cancelOnlyByPayeeAndStopsPayments() public {
        uint256 id = _invoice(1e6, address(0));
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.NotPayee.selector);
        pr.cancel(id);
        vm.expectEmit(true, true, false, false);
        emit Cancelled(id, payee);
        vm.prank(payee); pr.cancel(id);
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.RequestCancelled.selector);
        pr.pay(id);
        vm.prank(payee);
        vm.expectRevert(MakotoPayRequests.RequestCancelled.selector);
        pr.cancel(id);
    }

    function test_payeeCannotPayAndUnknownRequest() public {
        uint256 id = _invoice(1e6, address(0));
        usdc.mint(payee, 10e6);
        vm.prank(payee);
        vm.expectRevert(MakotoPayRequests.PayeeCannotPay.selector);
        pr.pay(id);
        vm.expectRevert(MakotoPayRequests.RequestNotFound.selector);
        pr.pay(999);
        vm.expectRevert(MakotoPayRequests.RequestNotFound.selector);
        pr.getRequest(999);
    }

    function test_failedTransferRevertsWithoutState() public {
        uint256 id = _invoice(1e6, address(0));
        usdc.setFail(true);
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.TransferFailed.selector);
        pr.pay(id);
        assertFalse(pr.hasPaid(id, alice));
        (MakotoPayRequests.Request memory r,,) = pr.getRequest(id);
        assertEq(r.paidCount, 0);
    }

    function test_insufficientAllowanceReverts() public {
        uint256 id = _invoice(1e6, address(0));
        vm.prank(alice); usdc.approve(address(pr), 0);
        vm.prank(alice);
        vm.expectRevert(MakotoPayRequests.TransferFailed.selector);
        pr.pay(id);
    }

    function testFuzz_payMovesExactAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        uint256 id = _invoice(amount, address(0));
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice); pr.pay(id);
        assertEq(usdc.balanceOf(payee), amount);
        assertEq(before - usdc.balanceOf(alice), amount);
        assertEq(usdc.balanceOf(address(pr)), 0);
    }
}
