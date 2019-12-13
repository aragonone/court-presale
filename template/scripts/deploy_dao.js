const Template = artifacts.require('ANJTemplate')

const { getEventArgument } = require('@aragon/test-helpers/events')

const DAYS = 24 * 3600
const WEEKS = 7 * DAYS
const PPM = 1e6

const OWNER = '0xb4124cEB3451635DAcedd11767f004d8a28c6eE7'

const PRESALE_PERIOD = 14 * DAYS
const PRESALE_EXCHANGE_RATE = 2 * PPM

const RESERVE_RATIO = 33000
const SLIPPAGE = 2 * Math.pow(10, 17)
const BATCH_BLOCKS = 1

const ID = 'eopbc' + Math.random()

module.exports = async callback => {
  try {
    const template = await Template.at(process.argv[6])

    const receipt = await template.installFundraisingApps(
      owner,
      ID,
      collateralToken.address,
      bondedToken.address,
      PRESALE_PERIOD,
      PRESALE_EXCHANGE_RATE,
      START_DATE,
      RESERVE_RATIO,
      BATCH_BLOCKS,
      SLIPPAGE,
      { gasPrice: 60000000001 }
    )
    const dao = getEventArgument(receipt, 'DeployDao', 'dao')
    console.log('DAO deployed at ' + dao)
  } catch (err) {
    console.log(err)
  }

  callback()
}
