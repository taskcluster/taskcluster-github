var debug   = require('debug')('github:worker');
var yaml    = require('yaml-js');
var Promise = require('promise');
var slugid  = require('slugid');
var tc      = require('taskcluster-client');
var jparam  = require('json-parameterization');
var _       = require('lodash');

var taskclusterConfig = module.exports = {};

/**
 * Compares a list of expressions and a list of values,
 * returning true if any possible combination is a match
 **/
function listContainsExpressions(expressions, values) {
  for (var i in expressions ) {
    let exp = RegExp(expressions[i], 'i');
    // just join values so that we don't have to compare multiple times
    if (exp.test(values.join(' '))) return true;
  }
  return false;
};

function genGitHubEnvs(payload) {
  return {
    GITHUB_EVENT: payload.details.event,
    GITHUB_BRANCH: payload.details.branch,
    GITHUB_PULL_REQUEST: payload.details.pullNumber,
    GITHUB_BASE_REPO_URL: payload.details.baseRepoUrl,
    GITHUB_BASE_USER: payload.details.baseUser,
    GITHUB_BASE_SHA: payload.details.baseSha,
    GITHUB_BASE_BRANCH: payload.details.branch,
    GITHUB_BASE_REF: payload.details.baseRef,
    GITHUB_HEAD_REPO_URL: payload.details.headRepoUrl,
    GITHUB_HEAD_USER: payload.details.headUser,
    GITHUB_HEAD_SHA: payload.details.headSha,
    GITHUB_HEAD_BRANCH: payload.details.headBranch,
    GITHUB_HEAD_REF: payload.details.headRef,
    GITHUB_HEAD_USER_EMAIL: payload.details.headUserEmail
  };
};

/**
 * Attach fields to a compiled taskcluster github config so that
 * it becomes a complete task graph config.
 **/
function completeTaskGraphConfig(taskclusterConfig, payload) {
  taskclusterConfig.scopes = [
    'queue:*',
    'docker-worker:*',
    'scheduler:*'
  ];

  taskclusterConfig.routes = [
    `taskcluster-github.${ payload.organization }.${ payload.repository }.${ payload.details.headSha }`
  ];

  // each task can optionally decide if it wants github specific environment
  // variables added to it
  taskclusterConfig.tasks = taskclusterConfig.tasks.map((task) => {
    if (task.task.extra.github.env == true) {
      task.task.payload.env = _.merge(
        task.task.payload.env || {},
        genGitHubEnvs(payload)
      );
    }
    return task;
  });
  return taskclusterConfig;
};

/**
 * Perform parameter substitutions on a json object, for replacing user calls
 * to template functions/parameters in their config file.
 **/
function parameterize(taskclusterConfig, payload) {
  taskclusterConfig = jparam(taskclusterConfig,
    _.merge(payload.details, {
      $fromNow: (text) => { return tc.fromNowJSON(text) },
      // TODO: make jparam capable of returning objects instead of strings
      // and remove this ugly hack. Until then, the string returned here
      // will be swapped out by a later method with a js object.
      $githubEnvs: () => { return "@@GITHUB_ENVS@@" },
      organization: payload.organization,
      repository: payload.repository
    })
  );
}

/**
 * Merges an existing taskcluster github config with a pull request message's
 * payload to generate a full task graph config.
 *  params {
 *    taskclusterConfig:  '...', A yaml string
 *    payload:            {},    GitHub WebHook message payload
 *    userInfo:           {},    User info from the GitHub API
 *    validator:          {}     A taskcluster.base validator instance
 *    schema:             url,   Url to the taskcluster config schema
 *  }
 **/
taskclusterConfig.processConfig = function(params) {
  let payload = params.payload;
  return new Promise(function(accept, reject) {
    try {
      let taskclusterConfig = yaml.load(params.taskclusterConfig);
      // Validate the config file
      let errors = params.validator.check(taskclusterConfig, params.schema);
      if (errors) {
        let error = new Error(`Validation failed against schema: ${params.schema}`);
        error.errors = errors;
        throw error;
      }

      // We need to toss out the config version number; it's the only
      // field that's not also in graph/task definitions
      let version = taskclusterConfig.version;
      delete taskclusterConfig.version;

      // Perform parameter substitutions. This happens after verification
      // because templating may change with schema version, and parameter
      // functions are used as default values for some fields.
      taskclusterConfig = jparam(taskclusterConfig,
        _.merge(payload.details, {
          $fromNow: (text) => { return tc.fromNowJSON(text) },
          // TODO: make jparam capable of returning objects instead of strings
          // and remove this ugly hack. Until then, the string returned here
          // will be swapped out by a later method with a js object.
          $githubEnvs: () => { return "@@GITHUB_ENVS@@" },
          organization: payload.organization,
          repository: payload.repository
        })
      );
      // Compile individual tasks, filtering any that are not intended
      // for the current github event type
      taskclusterConfig.tasks = taskclusterConfig.tasks.map((taskConfig) => {
        return {
          taskId: slugid.v4(),
          task: taskConfig
        };
      }).filter((taskConfig) => {
        // Filter out tasks that aren't associated with the current event
        // being handled
        let events = taskConfig.task.extra.github.events;
        if (!listContainsExpressions(events, [payload.details.event])) return false;
        return true;
      });
      accept(completeTaskGraphConfig(taskclusterConfig, payload));
    } catch(e) {
      debug(e);
      reject(e);
    }
  });
};
