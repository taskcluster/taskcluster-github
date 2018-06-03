const debug = require('debug')('taskcluster-github:intree');
const yaml = require('js-yaml');
const slugid = require('slugid');
const tc = require('taskcluster-client');
const jparam = require('json-parameterization');
const jsone = require('json-e');
const _ = require('lodash');

// the lines below are a draft. These will not be hard coded,
// I plan to figure out the data flow later, after I got intree
// creating tasks correctly and at least one test passing
event = {
  type: 'Event',
  public: true,
  payload: {
    ref: 'refs/heads/master',
    head: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
    before:'762941318ee16e59dabbacb1b4049eec22f0d303',
    size: 1,
    distinct_size: 1,
    commits: [{
      sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
      message: 'New line at end of file.',
      author: {
        name: 'octocat',
        email: 'octocat@github.com',
      },
      url: 'https://github.com/octocat/Hello-World/commit/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
      distinct: true,
    }],
  },
  repo: {
    id: 3,
    name: 'octocat/Hello-World',
    url: 'https://api.github.com/repos/octocat/Hello-World',
  },
  actor: {
    id: 1,
    login: 'octocat',
    gravatar_id: '',
    avatar_url: 'https://github.com/images/error/octocat_happy.gif',
    url: 'https://api.github.com/users/octocat',
  },
  org: {
    id: 1,
    login: 'github',
    gravatar_id: '',
    url: 'https://api.github.com/orgs/github',
    avatar_url: 'https://github.com/images/error/octocat_happy.gif',
  },
  created_at: '2011-09-06T17:26:27Z',
  id: '12345',
};
const DEFAULT_CONTEXT = {
  tasks_for: 'github-push',
  event,
};
console.log('👒', DEFAULT_CONTEXT);
// end of draft area

// Assert that only scope-valid characters are in branches
const branchTest = /^[\x20-\x7e]*$/;

module.exports = {};

/**
 * Attach fields to a compiled taskcluster github config so that
 * it becomes a complete task graph config.
 **/
function completeInTreeConfig(config, payload) {
  config.scopes = [];
  if (!branchTest.test(payload.details['event.base.repo.branch'] || '')) {
    throw new Error('Cannot have unicode in branch names!');
  }
  if (!branchTest.test(payload.details['event.head.repo.branch'] || '')) {
    throw new Error('Cannot have unicode in branch names!');
  }

  if (payload.details['event.type'].startsWith('pull_request')) {
    config.scopes = [
      `assume:repo:github.com/${ payload.organization }/${ payload.repository }:pull-request`,
    ];
  } else if (payload.details['event.type'] == 'push') {
    let prefix = `assume:repo:github.com/${ payload.organization }/${ payload.repository }:branch:`;
    config.scopes = [
      prefix + payload.details['event.base.repo.branch'],
    ];
  } else if (payload.details['event.type'] == 'release') {
    config.scopes = [
      `assume:repo:github.com/${ payload.organization }/${ payload.repository }:release`,
    ];
  } else if (payload.details['event.type'] == 'tag') {
    let prefix = `assume:repo:github.com/${ payload.organization }/${ payload.repository }:tag:`;
    config.scopes = [
      prefix + payload.details['event.head.tag'],
    ];
  }

  // each task can optionally decide if it wants github specific environment
  // variables added to it
  let stringify = x => x ? `${x}` : x;
  config.tasks = config.tasks.map((task) => {
    if (task.task.extra.github.env) {
      task.task.payload.env = _.merge(
        task.task.payload.env || {}, {
          GITHUB_EVENT: payload.details['event.type'],
          GITHUB_BRANCH: payload.details['event.base.repo.branch'],
          GITHUB_PULL_REQUEST: stringify(payload.details['event.pullNumber']),
          GITHUB_PULL_TITLE: stringify(payload.details['event.title']),
          GITHUB_BASE_REPO_NAME: payload.details['event.base.repo.name'],
          GITHUB_BASE_REPO_URL: payload.details['event.base.repo.url'],
          GITHUB_BASE_USER: payload.details['event.base.user.login'],
          GITHUB_BASE_SHA: payload.details['event.base.sha'],
          GITHUB_BASE_BRANCH: payload.details['event.base.repo.branch'],
          GITHUB_BASE_REF: payload.details['event.base.ref'],
          GITHUB_HEAD_REPO_NAME: payload.details['event.head.repo.name'],
          GITHUB_HEAD_REPO_URL: payload.details['event.head.repo.url'],
          GITHUB_HEAD_USER: payload.details['event.head.user.login'],
          GITHUB_HEAD_SHA: payload.details['event.head.sha'],
          GITHUB_HEAD_BRANCH: payload.details['event.head.repo.branch'],
          GITHUB_HEAD_TAG: payload.details['event.head.tag'],
          GITHUB_HEAD_REF: payload.details['event.head.ref'],
          GITHUB_HEAD_USER_EMAIL: payload.details['event.head.user.email'],
        }
      );
    }
    return task;
  });
  return config;
};

/**
 * Returns a function that merges an existing taskcluster github config with
 * a pull request message's payload to generate a full task graph config.
 *  params {
 *    config:             '...', A yaml string
 *    payload:            {},    GitHub WebHook message payload
 *    validator:          {}     A taskcluster.base validator instance
 *    schema:             url,   Url to the taskcluster config schema
 *  }
 **/
module.exports.setup = function(cfg) {
  return function({config, payload, validator, schema}) {
    config = yaml.safeLoad(config);
    let errors = validator(config, schema);
    if (errors) {
      throw new Error(errors);
    }
    debug(`intree config for ${payload.organization}/${payload.repository} matches valid schema.`);

    // We need to toss out the config version number; it's the only
    // field that's not also in graph/task definitions
    let version = config.version;
    console.log('🙄', version);
    delete config.version;
    console.log('😏', JSON.stringify(config));

    // Perform parameter substitutions. This happens after verification
    // because templating may change with schema version, and parameter
    // functions are used as default values for some fields.
    if (version === 0) {
      config = jparam(config, _.merge(payload.details, {
        $fromNow: (text) => tc.fromNowJSON(text),
        timestamp: Math.floor(new Date()),
        organization: payload.organization,
        repository: payload.repository,
        'taskcluster.docker.provisionerId': cfg.intree.provisionerId,
        'taskcluster.docker.workerType': cfg.intree.workerType,
      }));
    } else {
      config = jsone(config, DEFAULT_CONTEXT);
    }
    
    console.log('🐷', JSON.stringify(config));

    // Compile individual tasks, filtering any that are not intended
    // for the current github event type. Append taskGroupId while
    // we're at it.
    try {
      config.tasks = config.tasks.map((task) => {
        return {
          taskId: slugid.nice(),
          task,
        };
      }).filter((task) => {
        // Filter out tasks that aren't associated with github at all, or with
        // the current event being handled
        if (!task.task.extra || !task.task.extra.github) {
          return false;
        }

        let event = payload.details['event.type'];
        let events = task.task.extra.github.events;
        let branch = payload.details['event.base.repo.branch'];
        let includeBranches = task.task.extra.github.branches;
        let excludeBranches = task.task.extra.github.excludeBranches;

        if (includeBranches && excludeBranches) {
          throw new Error('Cannot specify both `branches` and `excludeBranches` in the same task!');
        }

        return _.some(events, ev => {
          if (!event.startsWith(_.trimEnd(ev, '*'))) {
            return false;
          }

          if (event !== 'push') {
            return true;
          }

          if (includeBranches) {
            return _.includes(includeBranches, branch);
          } else if (excludeBranches) {
            return !_.includes(excludeBranches, branch);
          } else {
            return true;
          }
        });
      });

      // Add common taskGroupId and schedulerId. taskGroupId is always the taskId of the first
      // task in taskcluster.
      if (config.tasks.length > 0) {
        let taskGroupId = config.tasks[0].taskId;
        config.tasks = config.tasks.map((task) => {
          return {
            taskId: task.taskId,
            task: _.extend(task.task, {taskGroupId, schedulerId: cfg.taskcluster.schedulerId}),
          };
        });
      }
      return completeInTreeConfig(config, payload);
    } catch (e) {
      debug('Error processing tasks!');
      throw e;
    }
  };
};
