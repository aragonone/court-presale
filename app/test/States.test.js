const { PRESALE_PERIOD } = require('@ablack/fundraising-shared-test-helpers/constants')
const { PRESALE_STATE, prepareDefaultSetup, defaultDeployParams, initializePresale } = require('./common/deploy')
const { getEvent, now } = require('@ablack/fundraising-presale/test/common/utils')

const getState = async test => {
  return (await test.presale.state()).toNumber()
}

const CONTRIBUTION = 1e18

contract('Balance Redirect Presale, states validation', ([anyone, appManager, buyer]) => {
  const itManagesStateCorrectly = startDate => {
    describe('When a sale is deployed', () => {
      before(async () => {
        await prepareDefaultSetup(this, appManager)
        await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate })

        await this.contributionToken.generateTokens(buyer, CONTRIBUTION)
        await this.contributionToken.approve(this.presale.address, CONTRIBUTION, { from: buyer })
      })

      it('Initial state is Pending', async () => {
        expect(await getState(this)).to.equal(PRESALE_STATE.PENDING)
      })

      describe('When the sale is started', () => {
        before(async () => {
          if (startDate == 0) {
            startDate = now()
            await this.presale.open({ from: appManager })
          }
          await this.presale.mockSetTimestamp(startDate + 1)
        })

        it('The state is Funding', async () => {
          expect(await getState(this)).to.equal(PRESALE_STATE.FUNDING)
        })

        describe('When the funding period is still running', () => {
          before(async () => {
            await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD / 2)
          })

          it('The state is still Funding', async () => {
            expect(await getState(this)).to.equal(PRESALE_STATE.FUNDING)
          })

          describe('When purchases are made', () => {
            before(async () => {
              await this.presale.contribute(buyer, CONTRIBUTION, { from: buyer })
            })

            it('The state is still Funding', async () => {
              expect(await getState(this)).to.equal(PRESALE_STATE.FUNDING)
            })

            describe('When the funding period elapses', () => {
              before(async () => {
                await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD)
              })

              it('The state is Refunding', async () => {
                expect(await getState(this)).to.equal(PRESALE_STATE.FINISHED)
              })
            })
          })

          describe('When the sale owner closes the sale', () => {
            before(async () => {
              await this.presale.close()
            })

            it('The state is Closed', async () => {
              expect(await getState(this)).to.equal(PRESALE_STATE.CLOSED)
            })
          })
        })
      })
    })
  }

  describe('When no startDate is specified upon initialization', () => {
    itManagesStateCorrectly(0)
  })

  describe('When a startDate is specified upon initialization', () => {
    itManagesStateCorrectly(now() + 3600)
  })
})
