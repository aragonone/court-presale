pragma solidity ^0.4.24;


contract MarketMakerMock {
    mapping(address => uint32) reserveRatios;

    function setReserveRatio(address _token, uint32 _reserveRatio) external {
        reserveRatios[_token] = _reserveRatio;
    }

    function getCollateralToken(address _token) public view returns (bool, uint256, uint256, uint32, uint256) {
        return (true, 0, 0, reserveRatios[_token], 0);
    }
}
