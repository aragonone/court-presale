const {
  PPM,
  PRESALE_PERIOD,
  PRESALE_EXCHANGE_RATE,
  RESERVE_RATIOS,
} = require('@ablack/fundraising-shared-test-helpers/constants')
const { PRESALE_STATE, prepareDefaultSetup, defaultDeployParams, initializePresale } = require('./common/deploy')
const { getEvent, now } = require('@ablack/fundraising-presale/test/common/utils')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const assertExternalEvent = require('@ablack/fundraising-shared-test-helpers/assertExternalEvent')

const CONTRIBUTION = 1e18
const BUYER_BALANCE = 2 * CONTRIBUTION

contract('Balance Redirect Presale, close() functionality', ([anyone, appManager, buyer1]) => {
  const itAllowsTheSaleToBeClosed = (startDate, contribution) => {
    before(async () => {
      await prepareDefaultSetup(this, appManager)
      await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate })

      await this.contributionToken.generateTokens(buyer1, BUYER_BALANCE)
      await this.contributionToken.approve(this.presale.address, BUYER_BALANCE, { from: buyer1 })

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
        const tokensForReserve = web3.toBigNumber(totalRaised).mul(RESERVE_RATIOS[0]).div(PPM)
        const reserve = await this.presale.reserve()
        expect((await this.contributionToken.balanceOf(reserve)).toString()).to.equal(tokensForReserve.toString())

        // beneficiary
        const tokensForBeneficiary = web3.toBigNumber(totalRaised).sub(tokensForReserve)
        expect((await this.contributionToken.balanceOf(appManager)).toString()).to.equal(tokensForBeneficiary.toString())
      })

      it('Tokens are minted to the contributor address', async () => {
        const supply = await this.projectToken.totalSupply()

        // beneficiary
        const balanceOfBeneficiary = await this.projectToken.balanceOf(appManager)
        expect(parseInt(balanceOfBeneficiary.toNumber())).to.equal(0)

        // reserve
        const reserve = await this.presale.reserve()
        const balanceOfReserve = await this.projectToken.balanceOf(reserve)
        expect(parseInt(balanceOfBeneficiary.toNumber())).to.equal(0)

        // contributor
        const totalRaised = (await this.presale.totalRaised()).toNumber()
        const balanceOfContributor = await this.projectToken.balanceOf(buyer1)
        expect(parseInt(balanceOfContributor.toNumber())).to.equal(parseInt(Math.floor(totalRaised * PRESALE_EXCHANGE_RATE / PPM)))
      })

      it('Continuous fundraising campaign is started', async () => {
        assertExternalEvent(closeReceipt, 'OpenTrading()')
      })

      it('Sale cannot be closed again', async () => {
        await assertRevert(this.presale.close(), 'PRESALE_INVALID_STATE')
      })

      it('Emitted a Close event', async () => {
        expect(getEvent(closeReceipt, 'Close')).to.exist
      })
    })
  }

  const closeSaleWithOrWithoutCotribution = startDate => {
    describe('When some purchases have been made', () => {
      itAllowsTheSaleToBeClosed(startDate, CONTRIBUTION)
    })

    describe('When no purchases have been made', () => {
      itAllowsTheSaleToBeClosed(startDate, 0)
    })
  }

  describe('When no startDate is specified upon initialization', () => {
    closeSaleWithOrWithoutCotribution(0)
  })

  describe('When a startDate is specified upon initialization', () => {
    closeSaleWithOrWithoutCotribution(now() + 3600)
  })
})
