suite('TaskCluster-Github taskclusterrc', () => {
  var fs     = require('fs');
  var tcrc   = require('../lib/taskclusterrc');
  var yaml   = require('yaml-js');
  var assert = require('assert');
  var _      = require('lodash');

  // Test github data, like one would see in a pulse message
  // after a pull request
  function buildMessage(params) {
    let defaultMessage = {
      organization: 'testorg',
      repository:   'testrepo',
      details: {
        pullNumber: 'eventData.number',
        event: 'push',
        branch: 'eventData.pull_request.base.some_branch',
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
    return _.merge(defaultMessage, params);
  }

  // Make sure that data merges properly when building configs
  var buildConfigTest = function(testName, configFile, messagePayload, expectedTasksLength) {
    test(testName, async () => {
      let taskclusterrc = fs.readFileSync(configFile);
      let taskclusterrcObj = yaml.load(taskclusterrc)
      let config = await tcrc.processConfig(taskclusterrc, messagePayload);
      // start by checking the graph config fields
      assert.equal(config.metadata.owner.split('@')[0], messagePayload.details.headUser);
      assert.equal(config.metadata.source, tcrc.buildConfigUrl(messagePayload));

      // all of our tasks should make it into the config
      if (taskclusterrcObj.tasks) {
        assert.equal(config.tasks.length, expectedTasksLength);
      }

      // check each configured task's fields
      config.tasks.map((taskConfig) => {
        let task = taskConfig.task;
        assert.equal(task.metadata.owner.split('@')[0], messagePayload.details.headUser);
        assert.equal(task.metadata.source, tcrc.buildConfigUrl(messagePayload));
        // fail if we add new details without exposing them to the user via
        // environment variables
        assert.equal(Object.keys(task.payload.env).length,
          Object.keys(messagePayload.details).length);
      });
    });
  };

  var configPath = 'test/data/';

  buildConfigTest(
    'Single Task Config',
    configPath + 'taskclusterrc.single.yml',
    buildMessage(),
    1);

  buildConfigTest(
    'Push Event (Push Task + Pull Task)',
    configPath + 'taskclusterrc.push_task_and_pull_task.yml',
    buildMessage(),
    1);

  buildConfigTest(
    'Pull Event (Push Task + Pull Task)',
    configPath + 'taskclusterrc.push_task_and_pull_task.yml',
    buildMessage({details: {event: 'pull_request.opened'}}),
    1);

  buildConfigTest(
    'Push Event (Two Pull Tasks)',
    configPath + 'taskclusterrc.two_pull_tasks.yml',
    buildMessage(),
    0);

  buildConfigTest(
    'Pull Event (Two Pull Tasks)',
    configPath + 'taskclusterrc.two_pull_tasks.yml',
    buildMessage({details: {event: 'pull_request.opened'}}),
    2);
});
