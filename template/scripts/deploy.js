const deployTemplate = require('../lib/deploy-template')

module.exports = callback => {
  deployTemplate(web3, artifacts)
    .then(result => {
      console.log(result.templateAddress)
      callback()
    })
    .catch(callback)
}
