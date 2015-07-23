var crypto    = require('crypto');

var github = module.exports = {};

/**
 * Hashes a payload by some secret, using the same algorithm that
 * GitHub uses to compute their X-Hub-Signature HTTP header. Used
 * for verifying the legitimacy of WebHooks.
 **/
github.generateXHubSignature = function(secret, payload) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(payload).digest('hex')
};

/**
 * Compare hmac.digest('hex') signatures in constant time
 * Double hmac verification is the preferred way to do this
 * since we can't predict optimizations performed by the runtime.
 * https: *www.isecpartners.com/blog/2011/february/double-hmac-verification.aspx
 **/
github.compareSignatures = function(sOne, sTwo) {
   let secret = Math.random().toString()
   let h1 = crypto.createHmac('sha1', secret).update(sOne);
   let h2 = crypto.createHmac('sha1', secret).update(sTwo);
   return h1.digest('hex') === h2.digest('hex');
};

/**
 * Update the status of some commit with Task Status info:
 * https://developer.github.com/v3/repos/statuses/
 **/
github.updateTaskStatus = function (api, user, repo, sha, state, taskId) {
  return new Promise(function(accept, reject) {
    api.statuses.create({
      user: user,
      repo: repo,
      sha: sha,
      state: state,
      description: 'Task status is ' + state,
      context: 'TaskCluster',
      target_url: 'https://tools.taskcluster.net/task-inspector/#' + taskId,
      }, accept);
  });
};
