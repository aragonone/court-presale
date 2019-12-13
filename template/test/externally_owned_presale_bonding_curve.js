const { hash: namehash } = require('eth-ens-namehash')
const { randomId } = require('@aragon/templates-shared/helpers/aragonId')
const assertRevert = require('@aragon/templates-shared/helpers/assertRevert')(web3)
const { assertRole, assertMissingRole } = require('@aragon/templates-shared/helpers/assertRole')(web3)
const { getEventArgument } = require('@aragon/test-helpers/events')
const TemplatesDeployer = require('../lib/TemplatesDeployer')

const ACL = artifacts.require('ACL')
const Agent = artifacts.require('Agent')
const TokenManager = artifacts.require('TokenManager')
const Controller = artifacts.require('AragonFundraisingController')
const ENS = artifacts.require('ENS')
const EVMScriptRegistry = artifacts.require('EVMScriptRegistry')
const Kernel = artifacts.require('Kernel')
const MarketMaker = artifacts.require('BatchedBancorMarketMaker')
const MiniMeToken = artifacts.require('MiniMeToken')
const MiniMeTokenFactory = artifacts.require('MiniMeTokenFactory')
const BalanceRedirectPresale = artifacts.require('BalanceRedirectPresale')
const PublicResolver = artifacts.require('PublicResolver')
const Tap = artifacts.require('TapDisabled')
const Template = artifacts.require('EOPBCTemplate')

const { TEMPLATE_NAME, CONTRACT_NAME, APPS } = require('../lib/helpers/constants.js')
const { getInstalledAppsById } = require('./helpers/utils.js')
const {
  MONTHS,
  PRESALE_PERIOD,
  PRESALE_EXCHANGE_RATE,
  RESERVE_RATIOS,
  SLIPPAGES,
  BATCH_BLOCKS,
} = require('@ablack/fundraising-shared-test-helpers/constants')

const ANY_ADDRESS = { address: require('@ablack/fundraising-shared-test-helpers/constants').ANY_ADDRESS }

const START_DATE = new Date().getTime() + MONTHS

const ERROR_BAD_SETTINGS = 'EOPBC_TEMPLATE_BAD_SETTINGS'

contract('externally owned presale bonding curve', ([root, owner, member1, member2, member3]) => {
  let daoID, template, dao, acl, ens, minimeFactory
  let reserve, presale, marketMaker, tap, controller, bondedTokenManager, bondedToken
  let collateralToken

  const ownerObject = { address: owner }

  before('deploy fundraising template and ENS', async () => {
    const deployer = new TemplatesDeployer(web3, artifacts, root, { apps: APPS, isTest: true, verbose: true })
    const { templateAddress, ensAddress } = await deployer.deploy(TEMPLATE_NAME, CONTRACT_NAME)
    ens = ENS.at(ensAddress)
    template = Template.at(templateAddress)
    // TODO: get from deployer
    minimeFactory = await MiniMeTokenFactory.new()
  })

  beforeEach('deploy collateral tokens', async () => {
    collateralToken = await MiniMeToken.new(minimeFactory.address, 0, 0, 'Collateral Token', 18, 'CT', true)
    bondedToken = await MiniMeToken.new(minimeFactory.address, 0, 0, 'Bonded Token', 18, 'BT', true)
    await bondedToken.changeController(template.address);
  })

  context('when the creation fails', () => {
    daoID = randomId()

    context('Fundraising transaction', () => {
      it('fails if owner is address zero', async () => {
        daoID = randomId()
        await assertRevert(
          template.newInstance(
            '0x00',
            daoID,
            collateralToken.address,
            bondedToken.address,
            PRESALE_PERIOD,
            PRESALE_EXCHANGE_RATE,
            START_DATE,
            RESERVE_RATIOS[0],
            BATCH_BLOCKS,
            SLIPPAGES[0],
            {
              from: owner,
            }
          ),
          ERROR_BAD_SETTINGS
        )
      })

      it('fails if collateral token is not a contract', async () => {
        daoID = randomId()
        await assertRevert(
          template.newInstance(
            owner,
            daoID,
            owner,
            bondedToken.address,
            PRESALE_PERIOD,
            PRESALE_EXCHANGE_RATE,
            START_DATE,
            RESERVE_RATIOS[0],
            BATCH_BLOCKS,
            SLIPPAGES[0],
            {
              from: owner,
            }
          ),
          ERROR_BAD_SETTINGS
        )
      })

      it('fails if bonded token is not a contract', async () => {
        daoID = randomId()
        await assertRevert(
          template.newInstance(
            owner,
            daoID,
            collateralToken.address,
            owner,
            PRESALE_PERIOD,
            PRESALE_EXCHANGE_RATE,
            START_DATE,
            RESERVE_RATIOS[0],
            BATCH_BLOCKS,
            SLIPPAGES[0],
            {
              from: owner,
            }
          ),
          ERROR_BAD_SETTINGS
        )
      })

      it('fails if id is empty', async () => {
        daoID = randomId()
        await assertRevert(
          template.newInstance(
            owner,
            '',
            collateralToken.address,
            bondedToken.address,
            PRESALE_PERIOD,
            PRESALE_EXCHANGE_RATE,
            START_DATE,
            RESERVE_RATIOS[0],
            BATCH_BLOCKS,
            SLIPPAGES[0],
            {
              from: owner,
            }
          ),
          ERROR_BAD_SETTINGS
        )
      })
    })
  })

  context('when the creation succeeds', () => {
    let fundraisingReceipt

    const loadDAO = async () => {
      dao = Kernel.at(getEventArgument(fundraisingReceipt, 'DeployDao', 'dao'))
      acl = ACL.at(await dao.acl())

      const installedAppsDuringFundraising = getInstalledAppsById(fundraisingReceipt)

      assert.equal(installedAppsDuringFundraising.agent.length, 1, 'should have installed 1 agent app')
      reserve = Agent.at(installedAppsDuringFundraising.agent[0])

      assert.equal(installedAppsDuringFundraising['balance-redirect-presale'].length, 1, 'should have installed 1 presale app')
      presale = BalanceRedirectPresale.at(installedAppsDuringFundraising['balance-redirect-presale'][0])

      assert.equal(installedAppsDuringFundraising['batched-bancor-market-maker'].length, 1, 'should have installed 1 market-maker app')
      marketMaker = MarketMaker.at(installedAppsDuringFundraising['batched-bancor-market-maker'][0])

      assert.equal(installedAppsDuringFundraising['aragon-fundraising'].length, 1, 'should have installed 1 aragon-fundraising app')
      controller = Controller.at(installedAppsDuringFundraising['aragon-fundraising'][0])

      assert.equal(installedAppsDuringFundraising['token-manager'].length, 1, 'should have installed 1 bonded token manager')
      bondedTokenManager = TokenManager.at(installedAppsDuringFundraising['token-manager'][0])
    }

    const itCostsUpTo = expectedCost => {
      it(`gas costs for each transaction must be up to ~${expectedCost} gas`, async () => {
        const fundraisingCost = fundraisingReceipt.receipt.gasUsed
        console.log('fundraisingCost', fundraisingCost)
        assert.isAtMost(fundraisingCost, expectedCost, `fundraising transaction should cost up to ${expectedCost} gas`)
      })
    }

    const itSetupsDAOCorrectly = financePeriod => {
      context('ENS', () => {
        it('should have registered a new DAO on ENS', async () => {
          const aragonIdNameHash = namehash(`${daoID}.aragonid.eth`)
          const resolvedAddress = await PublicResolver.at(await ens.resolver(aragonIdNameHash)).addr(aragonIdNameHash)
          assert.equal(resolvedAddress, dao.address, 'aragonId ENS name does not match')
        })
      })

      context('System', () => {
        it('should have Kernel permissions correctly setup ', async () => {
          await assertRole(acl, dao, ownerObject, 'APP_MANAGER_ROLE')
        })

        it('should have ACL permissions correctly setup ', async () => {
          await assertRole(acl, acl, ownerObject, 'CREATE_PERMISSIONS_ROLE')
        })
      })

      context('Bonded Token', () => {
        it('should have bonded token manager app correctly setup', async () => {
          assert.isTrue(await bondedTokenManager.hasInitialized(), 'token manager not initialized')
          assert.equal(await bondedTokenManager.token(), bondedToken.address)

          await assertRole(acl, bondedTokenManager, ownerObject, 'MINT_ROLE', marketMaker)
          await assertRole(acl, bondedTokenManager, ownerObject, 'MINT_ROLE', presale)
          await assertRole(acl, bondedTokenManager, ownerObject, 'BURN_ROLE', marketMaker)

          await assertMissingRole(acl, bondedTokenManager, 'ISSUE_ROLE')
          await assertMissingRole(acl, bondedTokenManager, 'ASSIGN_ROLE')
          await assertMissingRole(acl, bondedTokenManager, 'REVOKE_VESTINGS_ROLE')
        })
      })

      context('Fundraising apps', () => {
        it('should have reserve / agent app correctly setup', async () => {
          assert.isTrue(await reserve.hasInitialized(), 'reserve / agent not initialized')

          assert.equal(await reserve.protectedTokens(0), collateralToken.address, 'collateral not protected')

          await assertRole(acl, reserve, ownerObject, 'SAFE_EXECUTE_ROLE')
          await assertRole(acl, reserve, ownerObject, 'ADD_PROTECTED_TOKEN_ROLE', controller)
          await assertRole(acl, reserve, ownerObject, 'TRANSFER_ROLE', marketMaker)

          await assertMissingRole(acl, reserve, 'REMOVE_PROTECTED_TOKEN_ROLE')
          await assertMissingRole(acl, reserve, 'EXECUTE_ROLE')
          await assertMissingRole(acl, reserve, 'DESIGNATE_SIGNER_ROLE')
          await assertMissingRole(acl, reserve, 'ADD_PRESIGNED_HASH_ROLE')
          await assertMissingRole(acl, reserve, 'RUN_SCRIPT_ROLE')
        })

        it('should have presale app correctly setup', async () => {
          assert.isTrue(await presale.hasInitialized(), 'presale not initialized')

          assert.equal(web3.toChecksumAddress(await presale.controller()), controller.address)
          assert.equal(web3.toChecksumAddress(await presale.tokenManager()), bondedTokenManager.address)
          assert.equal(web3.toChecksumAddress(await presale.reserve()), reserve.address)
          assert.equal(await presale.beneficiary(), owner)
          assert.equal(web3.toChecksumAddress(await presale.contributionToken()), web3.toChecksumAddress(collateralToken.address))
          assert.equal((await presale.period()).toNumber(), PRESALE_PERIOD)
          assert.equal((await presale.exchangeRate()).toNumber(), PRESALE_EXCHANGE_RATE)
          assert.equal((await presale.futureReserveRatio()).toNumber(), RESERVE_RATIOS[0])
          assert.equal((await presale.openDate()).toNumber(), START_DATE)

          await assertRole(acl, presale, ownerObject, 'OPEN_ROLE', controller)
          await assertRole(acl, presale, ownerObject, 'CONTRIBUTE_ROLE', controller)
        })

        it('should have market-maker app correctly setup', async () => {
          assert.isTrue(await marketMaker.hasInitialized(), 'market-maker not initialized')

          assert.equal(web3.toChecksumAddress(await marketMaker.controller()), controller.address)
          assert.equal(web3.toChecksumAddress(await marketMaker.tokenManager()), bondedTokenManager.address)
          assert.equal(await marketMaker.token(), bondedToken.address)
          // cannot check formula directly
          assert.equal(web3.toChecksumAddress(await marketMaker.reserve()), reserve.address)
          assert.equal(await marketMaker.beneficiary(), owner)
          assert.equal((await marketMaker.batchBlocks()).toNumber(), BATCH_BLOCKS)
          assert.equal((await marketMaker.buyFeePct()).toNumber(), 0)
          assert.equal((await marketMaker.sellFeePct()).toNumber(), 0)

          const collateralInfo = await marketMaker.getCollateralToken(collateralToken.address)

          assert.isTrue(collateralInfo[0], 'collateral not whitelisted')
          assert.equal(collateralInfo[1].toNumber(), 0, 'collateral virtual supply should be 0')
          assert.equal(collateralInfo[2].toNumber(), 0, 'collateral virtual balance should be 0')
          assert.equal(collateralInfo[3].toNumber(), RESERVE_RATIOS[0], 'collateral reserve ratio should be ' + RESERVE_RATIOS[0])
          assert.equal(collateralInfo[4].toNumber(), SLIPPAGES[0], 'collateral maximum slippage should be ' + SLIPPAGES[0])

          await assertRole(acl, marketMaker, ownerObject, 'OPEN_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'UPDATE_BENEFICIARY_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'UPDATE_FEES_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'ADD_COLLATERAL_TOKEN_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'REMOVE_COLLATERAL_TOKEN_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'UPDATE_COLLATERAL_TOKEN_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'OPEN_BUY_ORDER_ROLE', controller)
          await assertRole(acl, marketMaker, ownerObject, 'OPEN_SELL_ORDER_ROLE', controller)

          await assertMissingRole(acl, marketMaker, 'UPDATE_FORMULA_ROLE')
        })

        it('should have aragon-fundraising app correctly setup', async () => {
          assert.isTrue(await controller.hasInitialized(), 'aragon-fundraising not initialized')

          assert.equal(web3.toChecksumAddress(await controller.presale()), presale.address)
          assert.equal(web3.toChecksumAddress(await controller.marketMaker()), marketMaker.address)
          assert.equal(web3.toChecksumAddress(await controller.reserve()), reserve.address)
          await assertRevert(() => controller.toReset(0))
          await assertRevert(() => controller.toReset(1))

          await assertRole(acl, controller, ownerObject, 'UPDATE_BENEFICIARY_ROLE')
          await assertRole(acl, controller, ownerObject, 'UPDATE_FEES_ROLE')
          await assertRole(acl, controller, ownerObject, 'ADD_COLLATERAL_TOKEN_ROLE')
          await assertRole(acl, controller, ownerObject, 'REMOVE_COLLATERAL_TOKEN_ROLE')
          await assertRole(acl, controller, ownerObject, 'UPDATE_COLLATERAL_TOKEN_ROLE')
          await assertRole(acl, controller, ownerObject, 'OPEN_PRESALE_ROLE')
          await assertRole(acl, controller, ownerObject, 'OPEN_TRADING_ROLE', presale)
          await assertRole(acl, controller, ownerObject, 'CONTRIBUTE_ROLE', ANY_ADDRESS)
          await assertRole(acl, controller, ownerObject, 'OPEN_BUY_ORDER_ROLE', ANY_ADDRESS)
          await assertRole(acl, controller, ownerObject, 'OPEN_SELL_ORDER_ROLE', ANY_ADDRESS)
        })
      })
    }

    const createDAO = financePeriod => {
      beforeEach('create fundraising entity with multisig', async () => {
        daoID = randomId()
        fundraisingReceipt = await template.newInstance(
          owner,
          daoID,
          collateralToken.address,
          bondedToken.address,
          PRESALE_PERIOD,
          PRESALE_EXCHANGE_RATE,
          START_DATE,
          RESERVE_RATIOS[0],
          BATCH_BLOCKS,
          SLIPPAGES[0],
          {
            from: owner,
          }
        )

        await loadDAO()
      })
    }

    context('when requesting a custom finance period', () => {
      const FINANCE_PERIOD = 60 * 60 * 24 * 15 // 15 days

      createDAO(FINANCE_PERIOD)
      itCostsUpTo(7e6)
      itSetupsDAOCorrectly(FINANCE_PERIOD)
    })

    context('when requesting a default finance period', () => {
      const FINANCE_PERIOD = 0 // use default

      createDAO(FINANCE_PERIOD)
      itCostsUpTo(7e6)
      itSetupsDAOCorrectly(FINANCE_PERIOD)
    })
  })
})
