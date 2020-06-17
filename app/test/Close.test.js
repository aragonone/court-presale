const {
  PPM,
  PRESALE_PERIOD,
  RESERVE_RATIOS,
  ZERO_ADDRESS,
} = require('@ablack/fundraising-shared-test-helpers/constants')
const { PRESALE_STATE, prepareDefaultSetup, defaultDeployParams, initializePresale } = require('./common/deploy')
const { getEvent, now } = require('@ablack/fundraising-presale/test/common/utils')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const assertExternalEvent = require('@ablack/fundraising-shared-test-helpers/assertExternalEvent')

const MiniMeToken = artifacts.require('@aragon/apps-shared-minime/contracts/MiniMeToken')

const CONTRIBUTION = 1e18
const BUYER_BALANCE = 2 * CONTRIBUTION
const EXCHANGE_RATE = 20000000 // 20, in PPM

contract('Balance Redirect Presale, close() functionality', ([anyone, appManager, buyer1]) => {
  const itAllowsTheSaleToBeClosed = (
    startDate,
    contribution,
    mintingForBeneficiaryPct,
    tokensForReserve,
    tokensForBeneficiary,
    expectedBondedBeneficiary
  ) => {
    describe('When the sale is closed', () => {
      let closeReceipt

      beforeEach('Setup and close presale', async () => {
        await prepareDefaultSetup(this, appManager)
        await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate, presaleExchangeRate: EXCHANGE_RATE, mintingForBeneficiaryPct })

        await this.contributionToken.generateTokens(buyer1, BUYER_BALANCE)
        await this.contributionToken.approve(this.presale.address, BUYER_BALANCE, { from: buyer1 })

        // set market maker reserve ratio
        await this.marketMaker.setReserveRatio(this.contributionToken.address, RESERVE_RATIOS[0])

        let currentDate = startDate
        if (startDate == 0) {
          currentDate = now()
          const r = await this.presale.open({ from: appManager })
        }
        await this.presale.mockSetTimestamp(currentDate + 1)

        // Make a single purchase
        if (contribution > 0) {
          await this.presale.contribute(buyer1, contribution)
        }

        // finish period
        await this.presale.mockSetTimestamp(currentDate + PRESALE_PERIOD)

        // close presale
        closeReceipt = await this.presale.close()
      })


      it('Sale state is Closed', async () => {
        expect((await this.presale.state()).toNumber()).to.equal(PRESALE_STATE.CLOSED)
      })

      it('Raised funds are transferred to the fundraising reserve and the beneficiary address', async () => {
        expect((await this.contributionToken.balanceOf(this.presale.address)).toNumber()).to.equal(0)

        const totalRaised = (await this.presale.totalRaised()).toNumber()
        expect(totalRaised).to.equal(contribution)

        // reserve
        const reserve = await this.presale.reserve()
        expect((await this.contributionToken.balanceOf(reserve)).toString()).to.equal(tokensForReserve.toString())

        // beneficiary
        expect((await this.contributionToken.balanceOf(appManager)).toString()).to.equal(tokensForBeneficiary.toString())
      })

      it('Tokens are minted to the contributor address (and maybe beneficiary)', async () => {
        const supply = await this.projectToken.totalSupply()

        // reserve
        const reserve = await this.presale.reserve()
        const balanceOfReserve = await this.projectToken.balanceOf(reserve)
        expect(parseInt(balanceOfReserve.toNumber())).to.equal(0)

        // contributor
        const totalRaised = (await this.presale.totalRaised()).toNumber()
        const contributorMintedTokens = parseInt(Math.floor(totalRaised * EXCHANGE_RATE / PPM))
        const balanceOfContributor = await this.projectToken.balanceOf(buyer1)
        expect(parseInt(balanceOfContributor.toNumber())).to.equal(contributorMintedTokens)

        // beneficiary
        const balanceOfBeneficiary = await this.projectToken.balanceOf(appManager)
        const expectedBondedBeneficiary = web3.toBigNumber(contributorMintedTokens).mul(mintingForBeneficiaryPct).div(PPM - mintingForBeneficiaryPct)
        expect(balanceOfBeneficiary.toString()).to.equal(expectedBondedBeneficiary.toString())
      })

      it('Continuous fundraising campaign is started', async () => {
        assertExternalEvent(closeReceipt, 'OpenTrading()')
      })

      it('Bonding curve parameters match', async () => {
        // bonded token total supply
        const bondedTokenTotalSupply = await this.projectToken.totalSupply()

        // collateral token market cap
        const reserve = await this.presale.reserve()
        const reserveContributionTokenbalance = await this.contributionToken.balanceOf(reserve)
        const marketCap = bondedTokenTotalSupply.mul(PPM).div(EXCHANGE_RATE)

        // check reserve ratio holds
        if (marketCap.toString() == '0') {
          expect(reserveContributionTokenbalance.toString()).to.equal('0')
        } else {
          expect(reserveContributionTokenbalance.mul(PPM).div(marketCap).toString()).to.equal(RESERVE_RATIOS[0].toString())
        }
      })

      it('Sale cannot be closed again', async () => {
        await assertRevert(this.presale.close(), 'PRESALE_INVALID_STATE')
      })

      it('Emitted a Close event', async () => {
        expect(getEvent(closeReceipt, 'Close')).to.exist
      })
    })
  }

  const itClosesTheSaleWithWrongToken = (
    startDate,
    contribution,
    mintingForBeneficiaryPct,
    tokensForReserve,
    tokensForBeneficiary,
    expectedBondedBeneficiary
  ) => {
    describe('When the sale is closed but Market Maker collateral is different', () => {
      let closeReceipt

      beforeEach('Setup and close presale', async () => {
        await prepareDefaultSetup(this, appManager)
        await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate, presaleExchangeRate: EXCHANGE_RATE, mintingForBeneficiaryPct })

        await this.contributionToken.generateTokens(buyer1, BUYER_BALANCE)
        await this.contributionToken.approve(this.presale.address, BUYER_BALANCE, { from: buyer1 })

        // set market maker reserve ratio, with wrong token
        const mmToken = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Market Maker Token', 18, 'MMT', true)
        await this.marketMaker.setReserveRatio(mmToken.address, RESERVE_RATIOS[0])

        if (startDate == 0) {
          startDate = now()
          await this.presale.open({ from: appManager })
        }
        await this.presale.mockSetTimestamp(startDate + 1)

        // Make a single purchase
        await this.presale.contribute(buyer1, contribution)

        // finish period
        await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD)

        // close presale
        closeReceipt = await this.presale.close()
      })

      it('Raised funds are NOT transferred to the fundraising reserve', async () => {
        const reserve = await this.presale.reserve()
        expect((await this.contributionToken.balanceOf(reserve)).toString()).to.equal('0')
      })
    })
  }

  const closeWithStartDateAndContribution = (startDate, contribution) => {
    describe('When there is some pre-minting', () => {
      const tokensForReserve = contribution == 0 ? 0 : web3.toBigNumber(125e15)
      const tokensForBeneficiary = contribution == 0 ? 0 : web3.toBigNumber(875e15)
      const expectedBondedBeneficiary = contribution == 0 ? 0 : web3.toBigNumber(5e18)
      itAllowsTheSaleToBeClosed(startDate, contribution, 0.2 * PPM, tokensForReserve, tokensForBeneficiary, expectedBondedBeneficiary)
      if (contribution > 0) {
        itClosesTheSaleWithWrongToken(startDate, contribution, 0.2 * PPM, tokensForReserve, tokensForBeneficiary, expectedBondedBeneficiary)
      }
    })

    describe('When there is no pre-minting', () => {
      const tokensForReserve = contribution == 0 ? 0 : web3.toBigNumber(1e17)
      const tokensForBeneficiary = contribution == 0 ? 0 : web3.toBigNumber(9e17)
      const expectedBondedBeneficiary = 0
      itAllowsTheSaleToBeClosed(startDate, contribution, 0, tokensForReserve, tokensForBeneficiary, expectedBondedBeneficiary)
      if (contribution > 0) {
        itClosesTheSaleWithWrongToken(startDate, contribution, 0, tokensForReserve, tokensForBeneficiary, expectedBondedBeneficiary)
      }
    })
  }

  const closeSaleWithStartDate = startDate => {
    describe('When some purchases have been made', () => {
      closeWithStartDateAndContribution(startDate, CONTRIBUTION)
    })

    describe('When no purchases have been made', () => {
      closeWithStartDateAndContribution(startDate, 0)
    })
  }

  describe('When no startDate is specified upon initialization', () => {
    closeSaleWithStartDate(0)
  })

  describe('When a startDate is specified upon initialization', () => {
    closeSaleWithStartDate(now() + 3600)
  })
})
