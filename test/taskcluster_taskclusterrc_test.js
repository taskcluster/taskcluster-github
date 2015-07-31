suite('TaskCluster-Github taskclusterrc', () => {
  var fs     = require('fs');
  var tcrc   = require('../lib/taskclusterrc');
  var yaml   = require('yaml-js');
  var assert = require('assert');

  // Test github data, like one would see in a pulse message
  // after a pull request
  var pullRequestMessage = {
    organization: 'testorg',
    repository:   'testrepo',
    details: {
      pullNumber: 'eventData.number',
      baseUser: 'eventData.pull_request.base.user.login',
      baseRepoUrl: 'eventData.pull_request.base.repo.clone_url',
      baseBranch: 'eventData.pull_request.base.default_branch',
      baseSha: 'eventData.pull_request.base.sha',
      baseRef: 'eventData.pull_request.base.ref',
      headUser: 'eventData.pull_request.head.user.login',
      headRepoUrl: 'eventData.pull_request.head.repo.clone_url',
      headBranch: 'eventData.pull_request.head.default_branch',
      headSha: 'eventData.pull_request.head.sha',
      headRef: 'eventData.pull_request.head.ref'
    }

  }

  // Make sure that data merges properly when building configs
  var buildConfigTest = function(testName, configFile, payload) {
    test(testName, async () => {
      let taskclusterrc = fs.readFileSync(configFile);
      let taskclusterrcObj = yaml.load(taskclusterrc)
      let config = await tcrc.processConfig(taskclusterrc, payload);

      // start by checking the graph config fields
      assert.equal(config.metadata.owner.split('@')[0], payload.details.headUser);
      assert.equal(config.metadata.source, tcrc.buildConfigUrl(payload));

      // all of our tasks should make it into the config
      if (taskclusterrcObj.tasks) {
        assert.equal(config.tasks.length, taskclusterrcObj.tasks.length);
      }

      // check each configured task's fields
      config.tasks.map((taskConfig) => {
        let task = taskConfig.task;
        assert.equal(task.metadata.owner.split('@')[0], payload.details.headUser);
        assert.equal(task.metadata.source, tcrc.buildConfigUrl(payload));
        // fail if we add new details without exposing them to the user via
        // environment variables
        assert.equal(Object.keys(task.payload.env).length,
          Object.keys(pullRequestMessage.details).length);
      });
    });
  };

  var configPath = 'test/data/';

  buildConfigTest(
    'Single Task Config',
    configPath + 'taskclusterrc.single.yml',
    pullRequestMessage);

  buildConfigTest(
    'Multi Task Config',
    configPath + 'taskclusterrc.two_tasks.yml',
    pullRequestMessage);
});
