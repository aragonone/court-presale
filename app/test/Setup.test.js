const {
  DAYS,
  PRESALE_PERIOD,
  RESERVE_RATIOS,
  ZERO_ADDRESS,
} = require('@ablack/fundraising-shared-test-helpers/constants')
const { PRESALE_STATE, prepareDefaultSetup, setReduceBeneficiaryPctRole, initializePresale, defaultDeployParams } = require('./common/deploy')
const { tokenExchangeRate, now } = require('@ablack/fundraising-presale/test/common/utils')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const TokenManager = artifacts.require('TokenManager')

const ERROR_INVALID_STATE = 'PRESALE_INVALID_STATE'
const ERROR_INVALID_OPEN_DATE = 'PRESALE_INVALID_OPEN_DATE'
const ERROR_TIME_PERIOD_ZERO = 'PRESALE_TIME_PERIOD_ZERO'
const ERROR_INVALID_TIME_PERIOD = 'PRESALE_INVALID_TIME_PERIOD'
const ERROR_INVALID_PCT = 'PRESALE_INVALID_PCT'

contract('Balance Redirect Presale, setup', ([anyone, appManager, someEOA]) => {
  describe('When deploying the app with valid parameters', () => {
    const itSetupsTheAppCorrectly = startDate => {
      let presaleInitializationTx

      before(async () => {
        await prepareDefaultSetup(this, appManager)
        presaleInitializationTx = await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate })
      })

      it('App gets deployed', async () => {
        expect(web3.isAddress(this.presale.address)).to.equal(true)
      })

      it('Gas used is ~3.38e6', async () => {
        const gasUsed = presaleInitializationTx.receipt.gasUsed
        expect(gasUsed).to.be.below(3.38e6)
      })

      it('Deploys fundraising related apps', async () => {
        expect(web3.isAddress(this.reserve.address)).to.equal(true)
      })

      it('Controller is set', async () => {
        expect(await this.presale.controller()).to.equal(this.fundraising.address)
      })

      it('startDate is set correctly', async () => {
        expect((await this.presale.openDate()).toNumber()).to.equal(startDate)
      })

      it('Presale period is set', async () => {
        expect((await this.presale.period()).toNumber()).to.equal(PRESALE_PERIOD)
      })

      it('Initial state is Pending', async () => {
        expect((await this.presale.state()).toNumber()).to.equal(PRESALE_STATE.PENDING)
      })

      it('Contribution token is deployed and set in the app', async () => {
        expect(web3.isAddress(this.contributionToken.address)).to.equal(true)
        expect(await this.presale.contributionToken()).to.equal(this.contributionToken.address)
      })

      it('Project token is deployed and set in the app', async () => {
        expect(web3.isAddress(this.projectToken.address)).to.equal(true)
        const tokenManager = await TokenManager.at(await this.presale.tokenManager())
        expect(await tokenManager.token()).to.equal(this.projectToken.address)
      })

      it('TokenManager is deployed, set in the app, and controls the project token', async () => {
        expect(web3.isAddress(this.tokenManager.address)).to.equal(true)
        expect(await this.presale.tokenManager()).to.equal(this.tokenManager.address)
      })

      it('Exchange rate is calculated to the expected value', async () => {
        const receivedValue = (await this.presale.exchangeRate()).toNumber()
        const expectedValue = tokenExchangeRate()
        expect(receivedValue).to.equal(expectedValue)
      })

      it('Beneficiary address is set', async () => {
        expect(await this.presale.beneficiary()).to.equal(appManager)
      })
    }

    describe('When no startDate is specified upon initialization', () => {
      itSetupsTheAppCorrectly(0)
    })

    describe('When a startDate is specified upon initialization', () => {
      itSetupsTheAppCorrectly(now() + 3600)
    })
  })


  describe('When changing time parameters', () => {
    const itChangesTimeParamsCorrectly = startDate => {
      beforeEach(async () => {
        await prepareDefaultSetup(this, appManager)
        await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate })
      })

      it('Allows to change start date', async () => {
        const openDate = now() + 3600 * 2
        await this.presale.setOpenDate(openDate, { from: appManager })
      })

      it('Fails to change start date if presale already started', async () => {
        const openDate = now() + 3600 * 2
        if (startDate == 0) {
          await this.presale.open({ from: appManager })
        } else {
          await this.presale.mockSetTimestamp(startDate + 1)
        }
        await assertRevert(this.presale.setOpenDate(openDate, { from: appManager }), ERROR_INVALID_STATE)
      })

      it('Fails to change start date in the past', async () => {
        const openDate = now() - 3600
        await this.presale.mockSetTimestamp(now())
        await assertRevert(this.presale.setOpenDate(openDate, { from: appManager }), ERROR_INVALID_OPEN_DATE)
      })

      it('Allows to change period', async () => {
        const period = 10 * DAYS
        await this.presale.setPeriod(period, { from: appManager })
      })

      it('Fails to change period to 0', async () => {
        const period = 0
        await assertRevert(this.presale.setPeriod(period, { from: appManager }), ERROR_TIME_PERIOD_ZERO)
      })

      if (startDate > 0) {
        it('Fails to change period if end would be in the past', async () => {
          const period = 10 * DAYS
          await this.presale.mockSetTimestamp(startDate + period + 1)
          await assertRevert(this.presale.setPeriod(period, { from: appManager }), ERROR_INVALID_TIME_PERIOD)
        })
      }
    }

    describe('When no startDate is specified upon initialization', () => {
      itChangesTimeParamsCorrectly(0)
    })

    describe('When a startDate is specified upon initialization', () => {
      itChangesTimeParamsCorrectly(now() + 3600)
    })
  })

  describe('When changing beneficiary pct', () => {
    const itChangesBeneficiaryPctCorrectly = mintingForBeneficiaryPct => {
      beforeEach(async () => {
        await prepareDefaultSetup(this, appManager)
        await setReduceBeneficiaryPctRole(this, appManager)
        await initializePresale(this, { ...defaultDeployParams(this, appManager), mintingForBeneficiaryPct })
      })

      if (mintingForBeneficiaryPct > 0) {
        it('Allows to change beneficiary pct', async () => {
          await this.presale.reduceBeneficiaryPct(mintingForBeneficiaryPct - 1, { from: appManager })
        })
      }

      it('Fails to change beneficiary pct if bigger than previous one', async () => {
        await assertRevert(this.presale.reduceBeneficiaryPct(
          mintingForBeneficiaryPct > 0 ? mintingForBeneficiaryPct + 1 : mintingForBeneficiaryPct,
          { from: appManager }
        ), ERROR_INVALID_PCT)
      })
    }

    describe('When beneficary pct is 0 upon initialization', () => {
      itChangesBeneficiaryPctCorrectly(0)
    })

    describe('When a beneficiary pct is not 0 upon initialization', () => {
      itChangesBeneficiaryPctCorrectly(200000)
    })
  })

  describe('When deploying the app with invalid parameters', () => {
    let defaultParams

    before(async () => {
      await prepareDefaultSetup(this, appManager)
      defaultParams = defaultDeployParams(this, appManager)
    })

    it('Reverts when setting an invalid contribution token', async () => {
      await assertRevert(initializePresale(this, { ...defaultParams, contributionToken: someEOA }), 'PRESALE_INVALID_CONTRIBUTE_TOKEN')
    })

    it('Reverts when setting an invalid reserve', async () => {
      await assertRevert(initializePresale(this, { ...defaultParams, reserve: someEOA }), 'PRESALE_CONTRACT_IS_EOA')
    })

    it('Reverts when setting invalid dates', async () => {
      await assertRevert(initializePresale(this, { ...defaultParams, startDate: Math.floor(new Date().getTime() / 1000) - 1 }), ERROR_INVALID_OPEN_DATE)
      await assertRevert(initializePresale(this, { ...defaultParams, presalePeriod: 0 }), ERROR_TIME_PERIOD_ZERO)
    })

    it('Reverts when setting an invalid beneficiary address', async () => {
      await assertRevert(initializePresale(this, { ...defaultParams, beneficiary: ZERO_ADDRESS }), 'PRESALE_INVALID_BENEFICIARY')
    })
  })
})
