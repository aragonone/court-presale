pragma solidity ^0.4.24;


interface IMarketMaker {
    function getCollateralToken(address _collateral) public view returns (bool, uint256, uint256, uint32, uint256);
}
