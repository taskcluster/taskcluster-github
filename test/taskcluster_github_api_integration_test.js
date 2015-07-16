suite("TaskCluster-GitHub-Integration", () => {
  var helper = require('./helper');
  var assert = require('assert');

  // Run a test which verifies that pulse messages are being produced
  // for valid webhook requests.
  function pulseTest(testName, listenFor, exchangeFunc, routingKey, jsonFile) {
    test(testName, async () => {
      // Start listening for message
      await helper.events.listenFor(listenFor,
        helper.taskclusterGithubEvents[exchangeFunc](routingKey)
      );

      // Trigger a pull-request message
      let res = await helper.jsonHttpRequest('./test/data/' + jsonFile)
      res.connection.destroy()
      // Wait for message and validate details
      var m = await helper.events.waitFor(listenFor);
      assert.equal(m.payload.organizationName, routingKey.organizationName);
      assert.equal(m.payload.repositoryName, routingKey.repositoryName);
    });
  };

  if (helper.canRunIntegrationTests) {
    pulseTest('Publish Pull Request',
      'pull-request',
      'pullRequest',
      {
        organizationName: 'ninethings',
        repositoryName:   'website',
        action:           'opened'
      },
      'webhook.pull_request.open.json'
    );

    pulseTest('Publish Push',
      'push',
      'push',
      {
        organizationName: 'ninethings',
        repositoryName:   'website',
      },
      'webhook.push.json'
    );
  }
});
