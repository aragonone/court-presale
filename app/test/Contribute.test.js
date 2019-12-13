const { PRESALE_PERIOD, ZERO_ADDRESS } = require('@ablack/fundraising-shared-test-helpers/constants')
const { sendTransaction, contributionToProjectTokens, getEvent, now } = require('@ablack/fundraising-presale/test/common/utils')
const { PRESALE_STATE, prepareDefaultSetup, defaultDeployParams, initializePresale, deployDefaultSetup } = require('./common/deploy')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const chai = require('chai')
  .use(require('chai-bignumber')(web3.BigNumber))
  .should()

const ERROR_NO_REFUNDS = 'PRESALE_NO_REFUNDS'

contract('Balance Redirect Presale, contribute() functionality', ([anyone, appManager, buyer1, buyer2]) => {
  const initializePresaleWithERC20 = async startDate => {
    await this.contributionToken.generateTokens(buyer1, '100e18')
    await this.contributionToken.generateTokens(buyer2, '100000e18')
    await this.contributionToken.approve(this.presale.address, '100e18', { from: buyer1 })
    await this.contributionToken.approve(this.presale.address, '100000e18', { from: buyer2 })

    await initializePresale(this, { ...defaultDeployParams(this, appManager), startDate })
  }

  const contribute = (sender, amount) => {
    return this.presale.contribute(sender, amount, { from: sender, value: 0 })
  }

  const itAllowsUsersToContribute = (startDate) => {
    before('Prepare app', async () => {
      await prepareDefaultSetup(this, appManager)
    })

    before('Initialize token and app', async () => {
      await initializePresaleWithERC20(startDate)
    })

    it('Reverts if the user attempts to buy tokens before the sale has started', async () => {
      await assertRevert(contribute(buyer1, 1), 'PRESALE_INVALID_STATE')
    })

    describe('When the sale has started', () => {
      const contributionAmount = '100e18'
      const acceptableGasDiff = web3.toWei(0.01, 'ether')

      before('Open the sale if necessary, and set the date to the open date', async () => {
        if (startDate == 0) {
          startDate = now()
          await this.presale.open({ from: appManager })
        }
        await this.presale.mockSetTimestamp(startDate + 1)
      })

      it('App state should be Funding', async () => {
        expect((await this.presale.state()).toNumber()).to.equal(PRESALE_STATE.FUNDING)
      })

      it('A user can query how many project tokens would be obtained for a given amount of contribution tokens', async () => {
        const reportedAmount = await this.presale.contributionToTokens(contributionAmount)
        const expectedAmount = contributionToProjectTokens(contributionAmount)
        reportedAmount.should.be.bignumber.equal(expectedAmount)
      })

      describe('When a user buys project tokens', () => {
        let purchaseTx
        let buyer1_initialBalance

        before('Record initial token balances and make a contribution', async () => {
          buyer1_initialBalance = await this.contributionToken.balanceOf(buyer1)

          purchaseTx = await contribute(buyer1, contributionAmount)
        })

        it('Mints the correct amount of project tokens', async () => {
          const totalSupply = await this.projectToken.totalSupply()
          const expectedAmount = contributionToProjectTokens(contributionAmount)
          totalSupply.should.be.bignumber.equal(expectedAmount)
        })

        it('Reduces user contribution token balance', async () => {
          const userBalance = await this.contributionToken.balanceOf(buyer1)
          const expectedBalance = buyer1_initialBalance.minus(web3.toBigNumber(contributionAmount))
          const balanceDiff = userBalance.minus(expectedBalance)
          balanceDiff.absoluteValue().should.be.bignumber.lessThan(acceptableGasDiff)
        })

        it('Increases presale contribution token balance', async () => {
          const appBalance = await this.contributionToken.balanceOf(this.presale.address)
          appBalance.should.be.bignumber.equal(contributionAmount)
        })

        it('Tokens are assigned to the buyer', async () => {
          const userBalance = await this.projectToken.balanceOf(buyer1)
          const expectedAmount = contributionToProjectTokens(contributionAmount)
          userBalance.should.be.bignumber.equal(expectedAmount)
        })

        it('A Contribute event is emitted', async () => {
          const expectedAmount = contributionToProjectTokens(contributionAmount)
          const event = getEvent(purchaseTx, 'Contribute')
          expect(event).to.exist
          expect(event.args.contributor).to.equal(buyer1)
          web3.toBigNumber(event.args.value).should.be.bignumber.equal(contributionAmount)
          web3.toBigNumber(event.args.amount).should.be.bignumber.equal(expectedAmount)
        })

        it('Keeps track of total tokens raised', async () => {
          const amount1 = 1
          const amount2 = 2
          const amount3 = 3
          await contribute(buyer2, amount1)
          await contribute(buyer2, amount2)
          await contribute(buyer2, amount3)
          const raised = await this.presale.totalRaised()
          raised.should.be.bignumber.equal(web3.toBigNumber(contributionAmount).plus(amount1 + amount2 + amount3))
        })

        it("Reverts when sending ETH in a contribution that's supposed to use ERC20 tokens", async () => {
          await assertRevert(this.presale.contribute(buyer1, '10e18', { from: buyer1, value: 1 }), 'PRESALE_INVALID_CONTRIBUTE_VALUE')
        })

        it('Reverts when trying to refund', async () => {
          await assertRevert(this.presale.refund(buyer1, 1, { from: buyer1 }), ERROR_NO_REFUNDS)
        })

        describe('When the sale is Finished', () => {
          before(async () => {
            await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD)
          })

          it('Sale state is Finished', async () => {
            expect((await this.presale.state()).toNumber()).to.equal(PRESALE_STATE.FINISHED)
          })

          it('Reverts if a user attempts to buy tokens', async () => {
            await assertRevert(contribute(buyer2, 1), 'PRESALE_INVALID_STATE')
          })

          it('Reverts when trying to refund', async () => {
            await assertRevert(this.presale.refund(buyer1, 1, { from: buyer1 }), ERROR_NO_REFUNDS)
          })
        })

        describe('When the sale is Closed', () => {
          before(async () => {
            await this.presale.mockSetTimestamp(startDate + PRESALE_PERIOD)
            await this.presale.close()
          })

          it('Sale state is Closed', async () => {
            expect((await this.presale.state()).toNumber()).to.equal(PRESALE_STATE.CLOSED)
          })

          it('Reverts if a user attempts to buy tokens', async () => {
            await assertRevert(contribute(buyer2, 1), 'PRESALE_INVALID_STATE')
          })

          it('Reverts when trying to refund', async () => {
            await assertRevert(this.presale.refund(buyer1, 1, { from: buyer1 }), ERROR_NO_REFUNDS)
          })
        })
      })
    })
  }

  describe('When sending ETH directly to the Presale contract', () => {
    before(async () => {
      await deployDefaultSetup(this, appManager)
    })

    it('Reverts', async () => {
      await assertRevert(sendTransaction({ from: anyone, to: this.presale.address, value: web3.toWei(1, 'ether') }))
    })
  })

  describe('When using ERC20 tokens as contribution tokens', () => {
    describe('When no startDate is specified upon initialization', () => {
      itAllowsUsersToContribute(0)
    })

    describe('When a startDate is specified upon initialization', () => {
      itAllowsUsersToContribute(now() + 3600)
    })
  })
})
