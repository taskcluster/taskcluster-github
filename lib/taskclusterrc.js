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
    params.details.branch,
    ".taskclusterrc"
  ].join("/");
};

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
     // these fields should all be replaced with task specific information
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
    provisionerId: 'aws-provisioner-v1',
    workerType: 'b2gtest',
    retries: 5,
    metadata: {
     // these fields should all be replaced with task specific information
     owner: 'taskcluster-github@mozilla.com',
     name: 'taskcluster-github graph',
     description: 'A task graph submitted by the taskcluster-github worker',
     source: 'https://github.com/taskcluster/taskcluster-github'
    },
    payload: {
      maxRunTime: 7200,
      features: {}
    },
    scopes: [],
    extra: {
      github_events: [
        // default to running for any pull_request action
        'pull_request.*',
      ]
    },
    created: defaultCreated,
    deadline: defaultDeadline
  };
};

/**
 * Uses a webhook message payload to generate metadata suitable for
 * graph and task configs.
 **/
function buildWebHookConfigMetaData(payload) {
  let details = payload.details;
  return {
    owner:  details.headUserEmail,
    name: ['TaskCluster-GitHub:',
           payload.organization + '/' + payload.repository].join(' '),
    description: ['event:', details.event, 'sha:', details.headSha, 'pull:',
                  details.pullNumber].join(' '),
    source: taskclusterrc.buildConfigUrl(payload)
  };
};

/**
 * Uses a webhook message payload to generate a taskcluster graph config.
 * with github specific information.
 **/
function buildWebHookGraphConfig(payload) {
  let details = payload.details;
  let githubConfig = {
    metadata: buildWebHookConfigMetaData(payload),
    routes: [
      ['taskcluster-github',
        payload.organization,
        payload.repository,
        details.headSha].join('.')
    ]
  };
  return githubConfig;
};

/**
 * Uses a webhook message payload to generate a taskcluster task config.
 * with github specific information.
 **/
function buildWebHookTaskConfig(payload) {
  let details = payload.details;
  let githubConfig = {
    metadata: buildWebHookConfigMetaData(payload),
    extra: {
      // The whitelist is used to determine who is allowed to trigger a job.
      // by default it will allow public members of the base repository's
      // organization
      whitelist: {
        orgs: [payload.organization],
        users: []
      }
    },
    payload: {
      // Any environment variable with an undefined/null value will be
      // left out of the compiled task config automatically after merging
      env: {
        GITHUB_EVENT: details.event,
        GITHUB_BRANCH: details.branch,
        GITHUB_PULL_REQUEST: details.pullNumber,

        // Base details
        GITHUB_BASE_REPO_URL: details.baseRepoUrl,
        GITHUB_BASE_USER: details.baseUser,
        GITHUB_BASE_SHA: details.baseSha,
        GITHUB_BASE_BRANCH: details.branch,
        GITHUB_BASE_REF: details.baseRef,

        // Head details
        GITHUB_HEAD_REPO_URL: details.headRepoUrl,
        GITHUB_HEAD_USER: details.headUser,
        GITHUB_HEAD_SHA: details.headSha,
        GITHUB_HEAD_BRANCH: details.headBranch,
        GITHUB_HEAD_REF: details.headRef,
        GITHUB_HEAD_USER_EMAIL: details.headUserEmail
      }
    }
  };
  return githubConfig;
}

// Compares a list of expressions and a list of values,
// returning true if any possible combination is a match
function listContainsExpressions(expressions, values) {
  for (var i in expressions ) {
    let exp = RegExp(expressions[i], 'i');
    // just join values so that we don't have to compare multiple times
    if (exp.test(values.join(' '))) return true;
  }
  return false;
};

/**
 * Merges an existing taskclusterrc with a pull request message's
 * payload to generate a full task graph config.
 *  params {
 *    taskclusterrc: '...', A yaml string
 *    payload:       {},    GitHub WebHook message payload
 *    userInfo:      {},    User info from the GitHub API
 *    validator:     {}     A taskcluster.base validator instance
 *    schema:        url,   Url to the taskclusterrc schema
 *  }
 **/
taskclusterrc.processConfig = function(params) {
  let payload = params.payload;
  return new Promise(function(accept, reject) {
    try {
      let taskclusterConfig = yaml.load(params.taskclusterrc);

      // Validate the config file
      let errors = params.validator.check(taskclusterConfig, params.schema);
      if (errors) {
        let error = new Error(`Validation failed against schema: ${params.schema}`);
        error.errors = errors;
        throw error;
      }

      let graph = _.merge(
        buildGraphSkeleton(),
        buildWebHookGraphConfig(payload));
      // Compile individual tasks, filtering any that are not intended
      // for the current github event type
      graph.tasks = taskclusterConfig.tasks.map((taskConfig) => {
        return {
          taskId: slugid.v4(),
          task: _.merge(
          buildTaskSkeleton(),
          taskConfig,
          buildWebHookTaskConfig(payload))
        };
      }).filter((taskConfig) => {
        // Here we apply several layers of security policies, dropping any
        // tasks that fail a check.
        let extra = taskConfig.task.extra;
        let headUser = payload.details.headUser;
        let userOrgs = params.userInfo.orgs.map((org) => {return org.login});
        if (!listContainsExpressions(extra.github_events, [payload.details.event])) return false;
        if (listContainsExpressions(extra.whitelist.users, [headUser])) return true;
        if (listContainsExpressions(extra.whitelist.orgs, userOrgs)) return true;
        return false;
      });
      accept(graph);
    } catch(e) {
      debug(e);
      reject(e);
    }
  });
};
