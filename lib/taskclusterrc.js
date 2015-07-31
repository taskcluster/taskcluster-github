var debug   = require('debug')('github:worker');
var yaml    = require('yaml-js');
var Promise = require('promise');
var slugid  = require('slugid');
var _       = require('lodash');

var taskclusterrc = module.exports = {};

/* Builds a url pointing to the raw path of some file in a github
 * repository, when given an object containing fields for a github
 * organization, repository, and branch.
 */
taskclusterrc.buildConfigUrl = function(params) {
  return [
    "https://raw.githubusercontent.com",
    params.organization,
    params.repository,
    params.details.baseRef,
    ".taskclusterrc"
  ].join("/");
}

/**
 * The minimum viable task graph configuration.
 **/
function buildGraphSkeleton() {
  return {
    tasks: [],
    scopes: [
      'queue:*',
      'docker-worker:*',
      'scheduler:*'
      ],
    metadata: {
     owner: 'taskcluster-github@mozilla.com',
     name: 'taskcluster-github graph',
     description: 'A task graph submitted by the taskcluster-github worker',
     source: 'https://github.com/taskcluster/taskcluster-github'
    }
  };
};

/**
 * The minimum viable task configuration.
 **/
function buildTaskSkeleton() {
  let defaultCreated = new Date();
  let defaultDeadline = new Date(defaultCreated);
  defaultDeadline.setHours(defaultDeadline.getHours() + 24);
  return {
    provisionerId: 'aws-provisioner',
    workerType: 'b2g-test',
    retries: 5,
    metadata: {},
    payload: {
      maxRunTime: 7200,
      features: {}
    },
    scopes: [],
    created: defaultCreated,
    deadline: defaultDeadline
  };
};

/**
 * Uses a pull request message payload to generate an object with
 * information pertinant to testing github events, that can be
 * merged into a taskcluster graph config.
 **/
function buildPullRequestGraphConfig(payload) {
  let details = payload.details;
  let githubConfig = {
    metadata: {
      owner:  details.headUser + '@github.taskcluster.net',
      source: taskclusterrc.buildConfigUrl(payload)
    },
    routes: [
      ['taskcluster-github',
        payload.organization,
        payload.repository,
        details.headSha].join('.'),
      ['taskcluster-github',
        'pull-request',
        payload.organization,
        payload.repository,
        details.pullNumber].join('.')
    ]
  };
  return githubConfig;
};

/**
 * Uses a pull request message payload to generate an object with
 * information pertinant to testing github events, that can be
 * merged into a taskcluster task config.
 **/
function buildPullRequestTaskConfig(payload) {
  let details = payload.details;
  let githubConfig = {
    metadata: {
      owner: details.headUser + '@github.taskcluster.net',
      source: taskclusterrc.buildConfigUrl(payload)
    },
    payload: {
      env: {
        GITHUB_PULL_REQUEST: details.pullNumber,

        // Base details
        GITHUB_BASE_REPO_URL: details.baseRepoUrl,
        GITHUB_BASE_USER: details.baseUser,
        GITHUB_BASE_SHA: details.baseSha,
        GITHUB_BASE_BRANCH: details.baseBranch,
        GITHUB_BASE_REF: details.baseRef,

        // Head details
        GITHUB_HEAD_REPO_URL: details.headRepoUrl,
        GITHUB_HEAD_USER: details.headUser,
        GITHUB_HEAD_SHA: details.headSha,
        GITHUB_HEAD_BRANCH: details.headBranch,
        GITHUB_HEAD_REF: details.headRef
      }
    }
  };
  return githubConfig;
}

/**
 * Merges an existing taskclusterrc with a pull request message's
 * payload to generate a full task graph config. taskclusterrc
 * is expected to be a string of yaml.
 **/
taskclusterrc.processConfig = function(taskclusterrc, payload) {
  return new Promise(function(accept, reject) {
    try {
      let taskclusterConfig = yaml.load(taskclusterrc);
      let graph = _.merge(
        buildGraphSkeleton(),
        buildPullRequestGraphConfig(payload));

      // merge a taskclusterrc task config with github/skeleton configs
      function mergeTaskConfig(taskConfig) {
        return {
          taskId: slugid.v4(),
          task: _.merge(
          buildTaskSkeleton(),
          taskConfig,
          buildPullRequestTaskConfig(payload))
        };
      };

      if (taskclusterConfig.tasks) {
        graph.tasks = taskclusterConfig.tasks.map(mergeTaskConfig);
      } else {
        // fall back to assuming that the user only wanted to configure a single
        // task when no top level "tasks" key exists in the config.
        graph.tasks.push(mergeTaskConfig(taskclusterConfig));
      }

      accept(graph);
    } catch(e) {
      debug(e);
      reject(e);
    }
  });
};
