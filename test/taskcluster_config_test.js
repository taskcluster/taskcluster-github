suite('TaskCluster-Github Config', () => {
  var fs         = require('fs');
  var tcconfig   = require('../lib/taskcluster-config');
  var assert     = require('assert');
  var _          = require('lodash');
  var common     = require('../lib/common');
  var helper     = require('./helper');

  /**
   * Test github data, like one would see in a pulse message
   * after a pull request
   **/
  function buildMessage(params) {
    let defaultMessage = {
      organization: 'testorg',
      repository:   'testrepo',
      details: {
        pullNumber: 'eventData.number',
        event: 'pull_request.opened',
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
        headRef: 'eventData.pull_request.head.ref',
        headUserEmail: 'test@test.com'
      }
    }
    return _.merge(defaultMessage, params);
  };

  /**
   * Test github data, relevant fields like one would receive from a call to:
   * https://developer.github.com/v3/orgs/
   **/
  function buildUserInfo(params) {
    let info = {
        orgs: [
          {login: 'testorg'}
        ]
      }
    return _.merge(info, params);
    };

  /**
   * Retrieve values from deeply nested objects.
   **/
  function getNestedValue(keys, obj) {
    let arrayExp = RegExp('\\[([0-9]+)\\]');
    keys = keys.split('.');
    for (let i in keys) {
      let arrayMatch = arrayExp.exec(keys[i]);
      if (arrayMatch) {
        // Here we handle array accesses of the form a.b[2]
        obj = obj[keys[i].split('[')[0]][arrayMatch[1]];
      } else {
        obj = obj[keys[i]];
      }
    }
    return obj;
  };

  /**
   * Make sure that data merges properly when building configs
   * testName:    '', A label for the current test case
   * configPath:  '', Path to a taskclusterConfig file
   * params:      {
   *                payload:    {}, WebHook message payload
   *                userInfo:   {}, GitHub user info
   *                validator:  {}, A taskcluster.base validator
   *              }
   * expected:    {}, keys=>values expected to exist in the compiled config
   **/
  var buildConfigTest = function(testName, configPath, params, expected) {
    test(testName, async () => {
      params.taskclusterConfig = fs.readFileSync(configPath);
      params.schema = common.SCHEMA_PREFIX_CONST + 'taskcluster-github-config.json#';
      params.validator = helper.validator;
      let config = await tcconfig.processConfig(params);
      for (let key in expected) {
        assert.deepEqual(getNestedValue(key, config), expected[key]);
      }
    });
  };

  var configPath = 'test/data/';

  buildConfigTest(
    'Single Task Config',
    configPath + 'taskcluster.single.yml',
    {
      payload:    buildMessage(),
      userInfo:   buildUserInfo(),
    },
    {
      'tasks': [], // The github event doesn't match, so no tasks are created
      'metadata.owner': 'test@test.com'
    });

  buildConfigTest(
    'Pull Event, Single Task Config',
    configPath + 'taskcluster.single.yml',
    {
      payload:    buildMessage({details: {event: 'push'}}),
      userInfo:   buildUserInfo(),
    },
    {
      'tasks[0].task.extra.github.events': ['push'],
      'metadata.owner': 'test@test.com'
    });

  buildConfigTest(
    'Push Event (Push Task + Pull Task)',
    configPath + 'taskcluster.push_task_and_pull_task.yml',
    {
      payload:    buildMessage({details: {event: 'push'}}),
      userInfo:   buildUserInfo(),
    },
    {
      'metadata.owner': 'test@test.com',
      'tasks[0].task.payload.command': ['test'],
      'tasks[0].task.extra.github.events': ['push']
    });

  buildConfigTest(
    'Pull Event (Push Task + Pull Task)',
    configPath + 'taskcluster.push_task_and_pull_task.yml',
    {
      payload:    buildMessage(),
      userInfo:   buildUserInfo(),
    },
    {
      'metadata.owner': 'test@test.com',
      'tasks[0].task.payload.command': ['test'],
      'tasks[0].task.extra.github.events': ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    });
});
