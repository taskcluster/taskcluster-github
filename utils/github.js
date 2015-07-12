var crypto = require('crypto')


var api = module.exports = {}

// Hashes a payload by some secret, using the same algorithm that
// GitHub uses to compute their X-Hub-Signature HTTP header. Used
// for verifying the legitimacy of WebHooks.
api.generateXHubSignature = function(secret, payload) {
  let algorithm = 'sha1'
  return algorithm + '=' + crypto.createHmac(algorithm, secret).update(
    payload).digest('hex')
}
