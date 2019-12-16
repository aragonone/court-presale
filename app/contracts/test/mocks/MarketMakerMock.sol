pragma solidity ^0.4.24;


contract MarketMakerMock {
    uint32 reserveRatio;

    function setReserveRatio(uint32 _reserveRatio) external {
        reserveRatio = _reserveRatio;
    }

    function getCollateralToken(address) public view returns (bool, uint256, uint256, uint32, uint256) {
        return (true, 0, 0, reserveRatio, 0);
    }
}
