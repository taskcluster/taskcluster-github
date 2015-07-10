suite("TaskCluster-Github", () => {
  var helper = require('./helper');
  var assume = require('assume');

  test("ping", () => {
    return helper.taskclusterGithub.ping();
  });

});
