var yaml    = require('yaml-js');
var Promise = require('promise');
var _       = require('lodash');

var taskclusterrc = module.exports = {};

function compileTaskSkeleton() {
  let defaultCreated = new Date();
  let defaultDeadline = new Date(defaultCreated);
  defaultDeadline.setHours(defaultDeadline.getHours() + 24);
  return {
    provisionerId: 'aws-provisioner',
    // TODO: Create a workerType and worker for running generic builds
    workerType: 'b2g-test',
    retries: 5,
    metadata: {},
    payload: {
      maxRunTime: 7200,
      features: {}
    },
    scopes: ['*'],
    created: defaultCreated,
    deadline: defaultDeadline
  };
};

/**
 * Uses the message payload to generate an object with
 * information pertinant to testing github events, that
 * can be merged into a taskcluster task config
 **/
function compileGitHubConfig(payload) {
  let details = payload.details;

  let githubConfig = {
    extra: {
      github: {
        baseUser: details.baseUser,
        baseRepoUrl: details.baseRepoUrl,
        baseRevision: details.baseRevision,
        baseBranch: details.baseBranch,

        headUser: details.headUser,
        headRepoUrl: details.headRepoUrl,
        headRevision: details.headRevision,
        headBranch: details.headBranch
      }
    },
    payload: {
      env: {
        GITHUB_PULL_REQUEST: details.pullNumber,

        // Base details
        GITHUB_BASE_REPO_URL: details.baseRepoUrl,
        GITHUB_BASE_USER: details.baseUser,
        GITHUB_BASE_REV: details.baseRevision,
        GITHUB_BASE_BRANCH: details.baseBranch,

        // Head details
        GITHUB_HEAD_REPO_URL: details.headRepoUrl,
        GITHUB_HEAD_USER: details.headUser,
        GITHUB_HEAD_REV: details.headRevision,
        GITHUB_HEAD_BRANCH: details.headBranch
      }
    },
    metadata: {
      owner: details.headUser + '@taskcluster.github.com'
    }
  };

  if (details.pullNumber) {
    githubConfig.routes = [
      ['taskcluster-github',
        'pull-request',
        payload.organization,
        details.headUser,
        details.pullNumber].join('.')
    ]
  }

  return githubConfig;
};

taskclusterrc.processConfig = function(taskclusterrc, payload) {
  return new Promise(function(accept, reject) {
    try {
      let taskclusterConfig = yaml.load(taskclusterrc);
      taskclusterConfig = _.merge(
        compileTaskSkeleton(),
        taskclusterConfig,
        compileGitHubConfig(payload));
      accept(taskclusterConfig)
    } catch(e) {
      console.log(e);
      reject(e);
    }
  });
};
