suite("TaskCluster-Github", () => {
  var helper = require('./helper');
  var assume = require('assume');
  var assert = require('assert');

  var dataPathBase = './test/data/webhook.'

  test("pullRequestOpen", async () => {
    let response = await helper.jsonHttpRequest(dataPathBase + 'pull_request.open.json');
    response.on('data', (data) => {
      assert.equal(response.statusCode, 201)
      assert.equal(data, 'adf')
      done()
    })
  });

});
