suite("TaskCluster-Github", () => {
  var helper = require('./helper');
  var assume = require('assume');
  var assert = require('assert');

  // Check the status code returned from a request containing some test data
  function statusTest(testName, jsonFile, statusCode) {
    test(testName, async () => {
      let response = await helper.jsonHttpRequest('./test/data/' + jsonFile)
      response.on('data', (data) => {
          console.log(testName, "->", data.toString())
      })
      assert.equal(response.statusCode, statusCode)
    });
  }

  // Good data: should all return 200 responses
  statusTest('pullRequestOpen', 'webhook.pull_request.open.json', 204)
  statusTest('pullRequestClose', 'webhook.pull_request.close.json', 204)
  statusTest('push', 'webhook.push.json', 204)

  // Bad data: should all return 400 responses
  statusTest('pushWithNoSecret', 'webhook.push.no_secret.json', 400)
  statusTest('unknownEvent', 'webhook.unknown_event.json', 400)
  statusTest('pushWithBadSecret', 'webhook.push.bad_secret.json', 403)
});
