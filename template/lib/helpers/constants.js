const { hash: namehash } = require('eth-ens-namehash')

const TEMPLATE_NAME = 'externally-owned-presale-bonding-curve-template'
const CONTRACT_NAME = 'EOPBCTemplate'

const APPS = [
  { name: 'agent', contractName: 'Agent' },
  { name: 'token-manager', contractName: 'TokenManager' },
  { name: 'bancor-formula', contractName: 'BancorFormula' },
  { name: 'batched-bancor-market-maker', contractName: 'BatchedBancorMarketMaker' },
  { name: 'tap', contractName: 'TapDisabled' },
  { name: 'aragon-fundraising', contractName: 'AragonFundraisingController' },
  { name: 'balance-redirect-presale', contractName: 'BalanceRedirectPresale' },
]

const APP_IDS = APPS.reduce((ids, { name }) => {
  ids[name] = namehash(`${name}.aragonpm.eth`)
  return ids
}, {})

module.exports = {
  TEMPLATE_NAME,
  CONTRACT_NAME,
  APPS,
  APP_IDS,
}
