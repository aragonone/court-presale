pragma solidity 0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";
import "@aragon/apps-agent/contracts/Agent.sol";
import "@ablack/fundraising-bancor-formula/contracts/BancorFormula.sol";
import {AragonFundraisingController as Controller} from "@ablack/fundraising-aragon-fundraising/contracts/AragonFundraisingController.sol";
import {BatchedBancorMarketMaker as MarketMaker} from "@ablack/fundraising-batched-bancor-market-maker/contracts/BatchedBancorMarketMaker.sol";
import "@ablack/fundraising-shared-interfaces/contracts/IPresale.sol";
import "@aragon/court-presale/contracts/BalanceRedirectPresale.sol";
import {TapDisabled as Tap} from "./TapDisabled.sol";
import "@aragon/court-presale/contracts/lib/IMarketMaker.sol";


/**
 * This template is intended to be used for ANJ Presale and bonding curve deployment.
 * But it can be re-used by any project needing only a bonding curve along with a previous presale at a fixed price.
 * It doesn't have Aragon core apps, it's externally owned.
 * Besides there is no tap mechanism, as it's not intended for fundraising, but just for bonding tokens.
*/
contract EOPBCTemplate is BaseTemplate {
    string    private constant ERROR_BAD_SETTINGS            = "EOPBC_TEMPLATE_BAD_SETTINGS";

    bool      private constant BONDED_TOKEN_TRANSFERABLE     = true;
    uint8     private constant BONDED_TOKEN_DECIMALS         = uint8(18);
    uint256   private constant BONDED_TOKEN_MAX_PER_ACCOUNT  = uint256(0);

    uint256   private constant BUY_FEE_PCT                   = 0;
    uint256   private constant SELL_FEE_PCT                  = 0;

    bytes32   private constant BANCOR_FORMULA_ID             = 0xd71dde5e4bea1928026c1779bde7ed27bd7ef3d0ce9802e4117631eb6fa4ed7d;
    bytes32   private constant BALANCE_REDIRECT_PRESALE_ID   = 0x48361b4c873d034ec84268a195d412cf39969c26f09b3520478aa29e08033a3a;
    bytes32   private constant MARKET_MAKER_ID               = 0xc2bb88ab974c474221f15f691ed9da38be2f5d37364180cec05403c656981bf0;
    bytes32   private constant ARAGON_FUNDRAISING_ID         = 0x668ac370eed7e5861234d1c0a1e512686f53594fcb887e5bcecc35675a4becac;

    struct FundraisingApps {
        Agent                   reserve;
        BalanceRedirectPresale  presale;
        MarketMaker             marketMaker;
        Tap                     tap;
        Controller              controller;
        TokenManager            bondedTokenManager;
    }

    struct FundraisingParams {
        address       owner;
        string        id;
        ERC20         collateralToken;
        MiniMeToken   bondedToken;
        uint64        period;
        uint64        openDate;
        uint256       exchangeRate;
        uint256       mintingForBeneficiaryPct;
        uint256       reserveRatio;
        uint256       batchBlocks;
        uint256       slippage;
    }

    constructor(
        DAOFactory              _daoFactory,
        ENS                     _ens,
        IFIFSResolvingRegistrar _aragonID
    )
        BaseTemplate(_daoFactory, _ens, MiniMeTokenFactory(address(0)), _aragonID)
        public
    {
        _ensureAragonIdIsValid(_aragonID);
    }

    /***** external functions *****/

    /*
      uint256       _exchangeRate,
      uint256       _mintingForBeneficiaryPct,
      uint256       _reserveRatio,
      uint256       _batchBlocks,
      uint256       _slippage
    */
    function newInstance(
        address       _owner,
        string        _id,
        ERC20         _collateralToken,
        MiniMeToken   _bondedToken,
        uint64        _period,
        uint64        _openDate,
        uint256[5]    _paramsArray
    )
        external
    {
        require(_owner != address(0), ERROR_BAD_SETTINGS);
        require(isContract(_collateralToken), ERROR_BAD_SETTINGS);
        require(isContract(_bondedToken), ERROR_BAD_SETTINGS);
        require(bytes(_id).length > 0, ERROR_BAD_SETTINGS);

        // deploy DAO
        (Kernel dao, ACL acl) = _createDAO();

        // install fundraising apps
        FundraisingApps memory fundraisingApps = _proxifyFundraisingApps(dao, _bondedToken);

        FundraisingParams memory fundraisingParams = _packFundraisingParams(
            _owner,
            _id,
            _collateralToken,
            _bondedToken,
            _period,
            _openDate,
            _paramsArray
        );
        _initializePresale(fundraisingApps, fundraisingParams);
        _initializeMarketMaker(fundraisingApps, fundraisingParams.owner, fundraisingParams.batchBlocks);
        _initializeController(fundraisingApps);

        // setup fundraising apps permissions
        _setupFundraisingPermissions(acl, fundraisingParams.owner, fundraisingApps);

        // setup collateral
        _setupCollateral(acl, fundraisingParams.owner, fundraisingApps, fundraisingParams.collateralToken, fundraisingParams.reserveRatio, fundraisingParams.slippage);
        // clear DAO permissions
        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, fundraisingParams.owner, fundraisingParams.owner);
        // register id
        _registerID(fundraisingParams.id, address(dao));
    }

    /***** internal apps installation functions *****/

    function _proxifyFundraisingApps(Kernel _dao, MiniMeToken _bondedToken) internal returns (FundraisingApps memory fundraisingApps) {
        Agent reserve = _installNonDefaultAgentApp(_dao);
        BalanceRedirectPresale presale = BalanceRedirectPresale(_registerApp(_dao, BALANCE_REDIRECT_PRESALE_ID));
        MarketMaker marketMaker = MarketMaker(_registerApp(_dao, MARKET_MAKER_ID));
        Tap tap = new Tap();
        Controller controller = Controller(_registerApp(_dao, ARAGON_FUNDRAISING_ID));
        // bonded token manager
        TokenManager bondedTokenManager = _installTokenManagerApp(_dao, _bondedToken, BONDED_TOKEN_TRANSFERABLE, BONDED_TOKEN_MAX_PER_ACCOUNT);

        fundraisingApps = _packFundraisingApps(reserve, presale, marketMaker, tap, controller, bondedTokenManager);
    }

    /***** internal apps initialization functions *****/

    function _initializePresale(FundraisingApps memory _fundraisingApps, FundraisingParams memory _fundraisingParams)
        internal
    {
        _fundraisingApps.presale.initialize(
            _fundraisingApps.controller,
            IMarketMaker(_fundraisingApps.marketMaker),
            _fundraisingApps.bondedTokenManager,
            _fundraisingApps.reserve,
            _fundraisingParams.owner,
            _fundraisingParams.collateralToken,
            _fundraisingParams.period,
            _fundraisingParams.exchangeRate,
            _fundraisingParams.mintingForBeneficiaryPct,
            _fundraisingParams.openDate
        );
    }

    function _initializeMarketMaker(FundraisingApps memory _fundraisingApps, address _beneficiary, uint256 _batchBlocks) internal {
        IBancorFormula bancorFormula = IBancorFormula(_latestVersionAppBase(BANCOR_FORMULA_ID));

        _fundraisingApps.marketMaker.initialize(
            _fundraisingApps.controller,
            _fundraisingApps.bondedTokenManager,
            bancorFormula,
            _fundraisingApps.reserve,
            _beneficiary,
            _batchBlocks,
            BUY_FEE_PCT,
            SELL_FEE_PCT
        );
    }

    function _initializeController(FundraisingApps memory _fundraisingApps) internal {
        address[] memory toReset = new address[](0);
        _fundraisingApps.controller.initialize(
            _fundraisingApps.presale,
            _fundraisingApps.marketMaker,
            _fundraisingApps.reserve,
            _fundraisingApps.tap,
            toReset
        );
    }

    /***** internal setup functions *****/

    function _setupCollateral(
        ACL                    _acl,
        address                _owner,
        FundraisingApps memory _fundraisingApps,
        ERC20                  _collateralToken,
        uint256                _reserveRatio,
        uint256                _slippage
    )
        internal
    {
        // create and grant ADD_COLLATERAL_TOKEN_ROLE to this template
        _createPermissionForTemplate(_acl, _fundraisingApps.controller, _fundraisingApps.controller.ADD_COLLATERAL_TOKEN_ROLE());
        // add ANT as a protected collateral [but not as a tapped token]
        _fundraisingApps.controller.addCollateralToken(
            _collateralToken,
            0,
            0,
            uint32(_reserveRatio),
            _slippage,
            0,
            0
        );
        // transfer ADD_COLLATERAL_TOKEN_ROLE
        _transferPermissionFromTemplate(_acl, _fundraisingApps.controller, _owner, _fundraisingApps.controller.ADD_COLLATERAL_TOKEN_ROLE(), _owner);
    }

    /***** internal permissions functions *****/

    function _setupFundraisingPermissions(ACL _acl, address _owner, FundraisingApps memory _fundraisingApps) internal {
        address ANY_ENTITY = _acl.ANY_ENTITY();

        // token manager
        address[] memory grantees = new address[](2);
        grantees[0] = address(_fundraisingApps.marketMaker);
        grantees[1] = address(_fundraisingApps.presale);
        _createPermissions(_acl, grantees, _fundraisingApps.bondedTokenManager, _fundraisingApps.bondedTokenManager.MINT_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.marketMaker, _fundraisingApps.bondedTokenManager, _fundraisingApps.bondedTokenManager.BURN_ROLE(), _owner);
        // reserve
        _acl.createPermission(_owner, _fundraisingApps.reserve, _fundraisingApps.reserve.SAFE_EXECUTE_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.reserve, _fundraisingApps.reserve.ADD_PROTECTED_TOKEN_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.marketMaker, _fundraisingApps.reserve, _fundraisingApps.reserve.TRANSFER_ROLE(), _owner);
        // presale
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.presale, _fundraisingApps.presale.OPEN_ROLE(), _owner);
        _acl.createPermission(_owner, _fundraisingApps.presale, _fundraisingApps.presale.REDUCE_BENEFICIARY_PCT_ROLE(), _owner);
        _acl.createPermission(ANY_ENTITY, _fundraisingApps.presale, _fundraisingApps.presale.CONTRIBUTE_ROLE(), _owner);
        // market maker
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.OPEN_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.UPDATE_BENEFICIARY_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.UPDATE_FEES_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.ADD_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.REMOVE_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.UPDATE_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.OPEN_BUY_ORDER_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.controller, _fundraisingApps.marketMaker, _fundraisingApps.marketMaker.OPEN_SELL_ORDER_ROLE(), _owner);
        // controller
        _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.UPDATE_BENEFICIARY_ROLE(), _owner);
        _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.UPDATE_FEES_ROLE(), _owner);
        // ADD_COLLATERAL_TOKEN_ROLE is handled later [after collaterals have been added]
        // _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.ADD_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.REMOVE_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.UPDATE_COLLATERAL_TOKEN_ROLE(), _owner);
        _acl.createPermission(_owner, _fundraisingApps.controller, _fundraisingApps.controller.OPEN_PRESALE_ROLE(), _owner);
        _acl.createPermission(_fundraisingApps.presale, _fundraisingApps.controller, _fundraisingApps.controller.OPEN_TRADING_ROLE(), _owner);
        _acl.createPermission(ANY_ENTITY, _fundraisingApps.controller, _fundraisingApps.controller.CONTRIBUTE_ROLE(), _owner);
        _acl.createPermission(ANY_ENTITY, _fundraisingApps.controller, _fundraisingApps.controller.OPEN_BUY_ORDER_ROLE(), _owner);
        _acl.createPermission(ANY_ENTITY, _fundraisingApps.controller, _fundraisingApps.controller.OPEN_SELL_ORDER_ROLE(), _owner);
    }

    /***** internal struct packing functions (to avoid stack too deep issues) *****/

    function _packFundraisingApps(
        Agent                   _reserve,
        BalanceRedirectPresale  _presale,
        MarketMaker             _marketMaker,
        Tap                     _tap,
        Controller              _controller,
        TokenManager            _tokenManager
    )
        internal
        pure
        returns (FundraisingApps memory fundraisingApps)
    {
        fundraisingApps.reserve            = _reserve;
        fundraisingApps.presale            = _presale;
        fundraisingApps.marketMaker        = _marketMaker;
        fundraisingApps.tap                = _tap;
        fundraisingApps.controller         = _controller;
        fundraisingApps.bondedTokenManager = _tokenManager;
    }

    /*
      uint256       _exchangeRate,
      uint256       _mintingForBeneficiaryPct,
      uint256       _reserveRatio,
      uint256       _batchBlocks,
      uint256       _slippage
    */
    function _packFundraisingParams(
        address       _owner,
        string        _id,
        ERC20         _collateralToken,
        MiniMeToken   _bondedToken,
        uint64        _period,
        uint64        _openDate,
        uint256[5]    _paramsArray
    )
        internal
        pure
        returns (FundraisingParams memory fundraisingParams)
    {
        fundraisingParams = FundraisingParams({
            owner:                    _owner,
            id:                       _id,
            collateralToken:          _collateralToken,
            bondedToken:              _bondedToken,
            period:                   _period,
            openDate:                 _openDate,
            exchangeRate:             _paramsArray[0],
            mintingForBeneficiaryPct: _paramsArray[1],
            reserveRatio:             _paramsArray[2],
            batchBlocks:              _paramsArray[3],
            slippage:                 _paramsArray[4]
        });
    }

    /***** internal utils functions *****/

    function _registerApp(Kernel _dao, bytes32 _appId) internal returns (address) {
        address proxy = _dao.newAppInstance(_appId, _latestVersionAppBase(_appId));

        emit InstalledApp(proxy, _appId);

        return proxy;
    }
}
