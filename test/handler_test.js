const debug = require('debug')('test');
const helper = require('./helper');
const assert = require('assert');
const sinon = require('sinon');
const libUrls = require('taskcluster-lib-urls');

/**
 * This tests the event handlers, faking out all of the services they
 * interact with.
 */
helper.secrets.mockSuite('handlers', ['taskcluster'], function(mock, skipping) {
  helper.withEntities(mock, skipping);
  helper.withFakeGithub(mock, skipping);

  const URL_PREFIX = 'https://tools.taskcluster.net/task-group-inspector/#/';
  const SLUG_ID_LENGTH = 22;

  let github = null;
  let handlers = null;
  setup(async function() {
    helper.load.save();

    helper.load.cfg('taskcluster.rootUrl', libUrls.testRootUrl());
    github = await helper.load('github');
    handlers = await helper.load('handlers');

    // stub out `createTasks` so that we don't actually create tasks
    handlers.createTasks = sinon.stub();
    await handlers.setup();

    // set up the allowPullRequests key
    github.inst(5828).setRepoInfo({
      owner: 'TaskClusterRobot',
      repo: 'hooks-testing',
      info: {default_branch: 'development'},
    });
  });

  teardown(async function() {
    await handlers.terminate();
    helper.load.restore();
  });

  suite('jobHandler', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    function simulateJobMessage({user, head, base, eventType='push'}) {
      // set up to resolve when the handler has finished (even if it finishes with error)
      return new Promise((resolve, reject) => {
        handlers.handlerComplete = resolve;
        handlers.handlerRejected = reject;

        let details = {
          'event.type': eventType,
          'event.base.repo.branch': 'tc-gh-tests',
          'event.head.repo.branch': 'tc-gh-tests',
          'event.head.user.login': user,
          'event.head.repo.url': 'https://github.com/TaskClusterRobot/hooks-testing.git',
          'event.head.sha': head || '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
          'event.head.ref': 'refs/heads/tc-gh-tests',
          'event.base.sha': base || '2bad4edf90e7d4fb4643456a4df333da348bbed4',
          'event.head.user.id': 190790,
        }; 
        if (eventType === 'tag') {
          details['event.head.tag'] = 'v1.0.2';
          delete details['event.head.repo.branch'];
          delete details['event.base.repo.branch'];
        }

        debug(`publishing ${JSON.stringify({user, head, base, eventType})}`);
        const message = {
          exchange: 'exchange/taskcluster-github/v1/release',
          routingKey: 'ignored',
          routes: [],
          payload: {
            organization: 'TaskClusterRobot',
            details: details,
            repository: 'hooks-testing',
            eventId: '26370a80-ed65-11e6-8f4c-80082678482d',
            installationId: 5828,
            version: 1,
          },
        };
        if (eventType.startsWith('pull_request.')) {
          message.payload.details['event.pullNumber'] = 36;
        }

        handlers.jobListener.fakeMessage(message);
      });
    }

    test('valid push (owner is collaborator) creates a taskGroup', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({user: 'TaskClusterRobot'});

      assert(github.inst(5828).checks.create.calledOnce, 'Status was never updated!');
      assert(handlers.createTasks.calledWith({scopes: sinon.match.array, tasks: sinon.match.array}));
      let args = github.inst(5828).checks.create.firstCall.args[0];
      assert.equal(args.owner, 'TaskClusterRobot');
      assert.equal(args.repo, 'hooks-testing');
      assert.equal(args.head_sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(args.status, 'queued');
      assert.equal(args.output.title, 'TaskGroup: Queued (for push)');
      assert.equal(/Taskcluster \((.*)\)/.exec(args.name)[1], 'push');
      debug('Created task group: ' + args.target_url);
      assert(args.details_url.startsWith(URL_PREFIX));
      let taskGroupId = args.details_url.substr(URL_PREFIX.length, SLUG_ID_LENGTH);
      let build = await helper.Builds.load({taskGroupId});
      assert.equal(build.organization, 'TaskClusterRobot');
      assert.equal(build.repository, 'hooks-testing');
      assert.equal(build.sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(build.state, 'queued');
    });

    test('valid pull_request (user is collaborator) creates a taskGroup', async function() {
      github.inst(5828).setRepoCollaborator({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        username: 'goodBuddy',
      });
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({user: 'goodBuddy', eventType: 'pull_request.opened'});

      assert(github.inst(5828).checks.create.calledOnce, 'Status was never updated!');
      assert(handlers.createTasks.calledWith({scopes: sinon.match.array, tasks: sinon.match.array}));
      let args = github.inst(5828).checks.create.firstCall.args[0];
      assert.equal(args.owner, 'TaskClusterRobot');
      assert.equal(args.repo, 'hooks-testing');
      assert.equal(args.head_sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(args.status, 'queued');
      assert.equal(/Taskcluster \((.*)\)/.exec(args.name)[1], 'pull_request');
      debug('Created task group: ' + args.details_url);
      assert(args.details_url.startsWith(URL_PREFIX));
      let taskGroupId = args.details_url.substr(URL_PREFIX.length, SLUG_ID_LENGTH);
      let build = await helper.Builds.load({taskGroupId});
      assert.equal(build.organization, 'TaskClusterRobot');
      assert.equal(build.repository, 'hooks-testing');
      assert.equal(build.sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(build.state, 'queued');
    });

    test('valid push (but not collaborator) creates a taskGroup', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({user: 'TaskClusterCollaborator', eventType: 'push'});

      assert(github.inst(5828).checks.create.calledOnce, 'Status was never updated!');
      let args = github.inst(5828).checks.create.firstCall.args[0];
      assert.equal(args.owner, 'TaskClusterRobot');
      assert.equal(args.repo, 'hooks-testing');
      assert.equal(args.head_sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(args.status, 'queued');
      debug('Created task group: ' + args.details_url);
      assert(args.details_url.startsWith(URL_PREFIX));
      let taskGroupId = args.details_url.substr(URL_PREFIX.length, SLUG_ID_LENGTH);
      let build = await helper.Builds.load({taskGroupId});
      assert.equal(build.organization, 'TaskClusterRobot');
      assert.equal(build.repository, 'hooks-testing');
      assert.equal(build.sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(build.state, 'queued');
    });

    test('valid tag push (but not collaborator) creates a taskGroup', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({
        user: 'TaskClusterRobotCollaborator', 
        base: '0000000000000000000000000000000000000000', 
        eventType: 'tag'}
      );
      
      assert(github.inst(5828).checks.create.calledOnce, 'Status was never updated!');
      assert(handlers.createTasks.calledWith({scopes: sinon.match.array, tasks: sinon.match.array}));
      let args = github.inst(5828).checks.create.firstCall.args[0];
      assert.equal(args.owner, 'TaskClusterRobot');
      assert.equal(args.repo, 'hooks-testing');
      assert.equal(args.head_sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(args.status, 'queued');
      assert.equal(args.output.title, 'TaskGroup: Queued (for tag)');
      assert.equal(/Taskcluster \((.*)\)/.exec(args.name)[1], 'tag');
      debug('Created task group: ' + args.details_url);
      assert(args.details_url.startsWith(URL_PREFIX));
      let taskGroupId = args.details_url.substr(URL_PREFIX.length, SLUG_ID_LENGTH);
      let build = await helper.Builds.load({taskGroupId});
      assert.equal(build.organization, 'TaskClusterRobot');
      assert.equal(build.repository, 'hooks-testing');
      assert.equal(build.sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert.equal(build.state, 'queued');
    });

    test('invalid YAML results in a comment', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./invalid-yaml.json'),
      });
      await simulateJobMessage({user: 'TaskClusterRobot'});

      assert(github.inst(5828).checks.create.callCount === 0, 'Status was unexpectedly updated!');
      assert(github.inst(5828).repos.createCommitComment.calledOnce);
      let args = github.inst(5828).repos.createCommitComment.args;
      assert.equal(args[0][0].owner, 'TaskClusterRobot');
      assert.equal(args[0][0].repo, 'hooks-testing');
      assert.equal(args[0][0].sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert(args[0][0].body.indexOf('data should NOT have additional properties') !== -1);
    });

    test('error creating task is reported correctly', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      handlers.createTasks.returns(Promise.reject({body: {error: 'oh noes'}}));
      await simulateJobMessage({user: 'TaskClusterRobot'});

      assert(github.inst(5828).checks.create.callCount === 1, 'Status was not updated!');
      assert(github.inst(5828).repos.createCommitComment.calledOnce);
      let args = github.inst(5828).repos.createCommitComment.args;
      assert.equal(args[0][0].owner, 'TaskClusterRobot');
      assert.equal(args[0][0].repo, 'hooks-testing');
      assert.equal(args[0][0].sha, '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf');
      assert(args[0][0].body.indexOf('oh noes') !== -1);
    });

    test('not an org member or collaborator is reported correctly for pull requests', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({user: 'imbstack', eventType: 'pull_request.opened'});

      assert(github.inst(5828).issues.createComment.calledOnce);
      let args = github.inst(5828).issues.createComment.args;
      assert.equal(args[0][0].owner, 'TaskClusterRobot');
      assert.equal(args[0][0].repo, 'hooks-testing');
      assert.equal(args[0][0].number, '36');
      assert(args[0][0].body.indexOf('No Taskcluster jobs started for this pull request') !== -1);
    });

    test('specifying allowPullRequests: public in the default branch allows all', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: 'development', // default branch
        content: {allowPullRequests: 'public'},
      });
      await simulateJobMessage({user: 'imbstack', eventType: 'pull_request.opened'});

      assert(github.inst(5828).checks.create.callCount === 1, 'Status was not updated!');
      assert(github.inst(5828).issues.createComment.callCount === 0);
    });

    test('specifying allowPullRequests: collaborators in the default branch disallows public', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: 'development', // default branch
        content: {allowPullRequests: 'collaborators'},
      });
      await simulateJobMessage({user: 'imbstack', eventType: 'pull_request.opened'});

      assert(github.inst(5828).checks.create.callCount === 0);
      assert(github.inst(5828).issues.createComment.callCount === 1);
    });

    test('user name not checked for pushes, so status is created', async function() {
      github.inst(5828).setTaskclusterYml({
        owner: 'TaskClusterRobot',
        repo: 'hooks-testing',
        ref: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        content: require('./valid-yaml.json'),
      });
      await simulateJobMessage({user: 'imbstack', eventType: 'push'});

      assert(github.inst(5828).checks.create.calledOnce, 'Status was never updated!');
      assert(github.inst(5828).repos.createCommitComment.callCount === 0);
    });
  });

  suite('statusHandler', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    teardown(async function() {
      await helper.Builds.remove({taskGroupId: TASKGROUPID}, true);
      await helper.CheckRuns.remove({taskGroupId: TASKGROUPID, taskId: TASKID}, true);
    });

    const TASKGROUPID = 'AXB-sjV-SoCyibyq3P32ow';
    const TASKID = 'AXB-s1V-So58ibyq3P32zm';
    const CONCLUSIONS = { // maps queue exchange status to github checkrun conclusion
      completed: 'success',
      failed: 'failure',
      exception: 'failure',
    };

    async function addBuild({state, taskGroupId}) {
      debug(`adding Build row for ${taskGroupId} in state ${state}`);
      await helper.Builds.create({
        organization: 'TaskClusterRobot',
        repository: 'hooks-testing',
        sha: '03e9577bc1ec60f2ff0929d5f1554de36b8f48cf',
        taskGroupId,
        state,
        created: new Date(),
        updated: new Date(),
        installationId: 9988,
        eventType: 'push',
        eventId: 'aaa-bbb',
      });
    }

    async function addCheckRun({taskGroupId, taskId}) {
      debug(`adding CheckRun row for task ${taskId} of group ${taskGroupId}`);
      await helper.CheckRuns.create({
        taskGroupId,
        taskId,
        checkSuiteId: '11111',
        checkRunId: '22222',
      });
    }

    function simulateStatusMessage({taskGroupId, taskId, exchange, state}) {
      // set up to resolve when the handler has finished (even if it finishes with error)
      return new Promise((resolve, reject) => {
        handlers.handlerComplete = resolve;

        debug(`publishing ${JSON.stringify({taskGroupId, exchange})}`);
        const message = {
          exchange,
          routingKey: 'ignored',
          routes: [],
          payload: {
            status: {
              taskGroupId,
              taskId,
              state,
            },
          },
        };

        handlers.statusListener.fakeMessage(message);
      });
    }

    async function assertStatusUpdate(state) {
      assert(github.inst(9988).checks.update.calledOnce, 'checks.update was not called');
      let args = github.inst(9988).checks.update.firstCall.args[0];
      assert.equal(args.owner, 'TaskClusterRobot');
      assert.equal(args.repo, 'hooks-testing');
      assert.equal(args.check_run_id, '22222');
      assert.equal(args.conclusion, CONCLUSIONS[state]);
    }

    async function assertBuildState(state) {
      let build = await helper.Builds.load({taskGroupId: TASKGROUPID});
      assert.equal(build.state, state);
    }

    test('task success gets a success comment', async function() {
      await addBuild({state: 'pending', taskGroupId: TASKGROUPID});
      await addCheckRun({taskGroupId: TASKGROUPID, taskId: TASKID});
      let state = 'completed';
      await simulateStatusMessage({
        taskGroupId: TASKGROUPID,
        taskId: TASKID,
        exchange: 'exchange/taskcluster-queue/v1/task-completed',
        state,
      });
      await assertStatusUpdate(state);
    });

    test('task failure gets a failure comment', async function() {
      await addBuild({state: 'pending', taskGroupId: TASKGROUPID});
      await addCheckRun({taskGroupId: TASKGROUPID, taskId: TASKID});
      let state = 'failed';
      await simulateStatusMessage({
        taskGroupId: TASKGROUPID,
        taskId: TASKID,
        exchange: 'exchange/taskcluster-queue/v1/task-failed',
        state,
      });
      await assertStatusUpdate(state);
    });

    test('task exception gets a failure comment', async function() {
      await addBuild({state: 'pending', taskGroupId: TASKGROUPID});
      await addCheckRun({taskGroupId: TASKGROUPID, taskId: TASKID});
      let state = 'exception';
      await simulateStatusMessage({
        taskGroupId: TASKGROUPID,
        taskId: TASKID,
        exchange: 'exchange/taskcluster-queue/v1/task-exception',
        state,
      });
      await assertStatusUpdate(state);
    });
  });
});
