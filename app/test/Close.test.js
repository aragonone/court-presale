const {
  PPM,
  PRESALE_PERIOD,
  RESERVE_RATIOS,
} = require('@ablack/fundraising-shared-test-helpers/constants')
const { PRESALE_STATE, prepareDefaultSetup, defaultDeployParams, initializePresale } = require('./common/deploy')
const { getEvent, now } = require('@ablack/fundraising-presale/test/common/utils')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const assertExternalEvent = require('@ablack/fundraising-shared-test-helpers/assertExternalEvent')

const CONTRIBUTION = 1e18
const BUYER_BALANCE = 2 * CONTRIBUTION
const EXCHANGE_RATE = 20000000 // 20, in PPM

contract('Balance Redirect Presale, close() functionality', ([anyone, appManager, buyer1]) => {
  const itAllowsTheSaleToBeClosed = (startDate, contribution, mintingForBeneficiaryPct) => {
    before(async () => {
      await prepareDefaultSetup(this, appManager)
      await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate, presaleExchangeRate: EXCHANGE_RATE, mintingForBeneficiaryPct })

      await this.contributionToken.generateTokens(buyer1, BUYER_BALANCE)
      await this.contributionToken.approve(this.presale.address, BUYER_BALANCE, { from: buyer1 })

      // set market maker reserve ratio
      await this.marketMaker.setReserveRatio(RESERVE_RATIOS[0])

      if (startDate == 0) {
        startDate = now()
        await this.presale.open({ from: appManager })
      }
      await this.presale.mockSetTimestamp(startDate + 1)

      // Make a single purchase
      if (contribution > 0) {
        await this.presale.contribute(buyer1, contribution)
      }

      // finish period
      await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD)
    })

    describe('When the sale is closed', () => {
      let closeReceipt

      before(async () => {
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
        const tokensForReserve = web3.toBigNumber(totalRaised).mul(PPM + mintingForBeneficiaryPct).div(PPM).mul(RESERVE_RATIOS[0]).div(PPM)
        const reserve = await this.presale.reserve()
        expect((await this.contributionToken.balanceOf(reserve)).toString()).to.equal(tokensForReserve.toString())

        // beneficiary
        const tokensForBeneficiary = web3.toBigNumber(totalRaised).sub(tokensForReserve)
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
        const expectedBeneficiary = web3.toBigNumber(contributorMintedTokens).mul(mintingForBeneficiaryPct).div(PPM)
        expect(balanceOfBeneficiary.toString()).to.equal(expectedBeneficiary.toString())
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

  const closeWithStartDateAndContribution = (startDate, contribution) => {
    describe('When there is some pre-minting', () => {
      itAllowsTheSaleToBeClosed(startDate, contribution, 0.2 * PPM)
    })

    describe('When there is no pre-minting', () => {
      itAllowsTheSaleToBeClosed(startDate, contribution, 0)
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
