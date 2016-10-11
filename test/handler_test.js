/**
 * This is a big huge integration test that reaches out to
 * all corners of the known universe and touches everything it can.
 *
 * It is super gross.
 *
 * However, the task that taskcluster-github achieves is a super gross
 * one. We're sorta left with the choice of faking all of our interactions
 * with Github or doing this. We've chosen this route for now and can
 * revisit later if it is a pain.
 */
suite('handlers', () => {
  let helper = require('./helper');
  let assert = require('assert');
  let testing = require('taskcluster-lib-testing');

  test('push', async function(done) {
    let handlers = await helper.handlers.setup();
    helper.publisher.push({
      organization: 'TaskClusterRobot',
      details: {
        'event.type': 'push',
        'event.base.repo.branch': 'master',
        'event.head.repo.branch': 'master',
        'event.head.user.login': 'TaskClusterRobot',
        'event.head.repo.url': 'https://github.com/TaskClusterRobot/hooks-testing.git',
        'event.head.sha': 'baac77fbb0089838ad2c57eab598efe4241e0e8f',
        'event.head.ref': 'refs/heads/master',
        'event.base.sha': '337667546fe033bd729d80e5fde00c07b98ee37a',
        'event.head.user.email': 'bstack@mozilla.com',
      },
      repository: 'hooks-testing',
      version: 1,
    });

    // For now let's just sleep. We can get all of this
    // cleaned up and async/await later
    await testing.sleep(1000);
    try {
      assert(helper.stubs.comment.calledOnce);
      assert.equal(helper.stubs.comment.args[0][0].user, 'TaskClusterRobot');
      assert.equal(helper.stubs.comment.args[0][0].repo, 'hooks-testing');
      assert.equal(helper.stubs.comment.args[0][0].sha, 'baac77fbb0089838ad2c57eab598efe4241e0e8f');
      assert(helper.stubs.comment.args[0][0].body.startsWith(
        'TaskCluster: https://tools.taskcluster.net/task-graph-inspector/#'));
      assert(helper.stubs.comment.args[0][0].body.endsWith('/'));
      done();
    } catch (e) {
      done(e);
    }
  });
});