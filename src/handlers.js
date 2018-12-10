const Debug = require('debug');
const taskcluster = require('taskcluster-client');
const libUrls = require('taskcluster-lib-urls');
const yaml = require('js-yaml');
const assert = require('assert');
const _ = require('lodash');
const prAllowed = require('./pr-allowed');
const {consume} = require('taskcluster-lib-pulse');

const debugPrefix = 'taskcluster-github:handlers';
const debug = Debug(debugPrefix);

/**
 * Create handlers
 */
class Handlers {
  constructor(options) {
    debug('Constructing handlers...');
    const {
      rootUrl,
      credentials,
      monitor,
      reference,
      jobQueueName,
      resultStatusQueueName,
      initialStatusQueueName,
      checksInitialStatusQueueName,
      intree,
      context,
      pulseClient,
    } = options;

    assert(monitor, 'monitor is required for statistics');
    assert(reference, 'reference must be provided');
    assert(rootUrl, 'rootUrl must be provided');
    assert(intree, 'intree configuration builder must be provided');
    this.rootUrl = rootUrl;
    this.credentials = credentials;
    this.monitor = monitor;
    this.reference = reference;
    this.intree = intree;
    this.connection = null;
    this.resultStatusQueueName = resultStatusQueueName;
    this.jobQueueName = jobQueueName;
    this.initialStatusQueueName = initialStatusQueueName;
    this.checksInitialStatusQueueName = checksInitialStatusQueueName;
    this.context = context;
    this.pulseClient = pulseClient;

    this.handlerComplete = null;
    this.handlerRejected = null;

    this.jobPq = null;
    this.resultStatusPq = null;
    this.initialStatusPq = null;
  }

  /**
   * Set up the handlers.
   */
  async setup(options = {}) {
    debug('Setting up handlers...');
    assert(!this.connection, 'Cannot setup twice!');
    this.connection = new taskcluster.PulseConnection(this.credentials);

    // Listen for new jobs created via the api webhook endpoint
    const GithubEvents = taskcluster.createClient(this.reference);
    const githubEvents = new GithubEvents({rootUrl: this.rootUrl});
    const jobBindings = [
      githubEvents.pullRequest(),
      githubEvents.push(),
      githubEvents.release(),
    ];

    const schedulerId = this.context.cfg.taskcluster.schedulerId;
    const queueEvents = new taskcluster.QueueEvents({rootUrl: this.rootUrl});

    // Listen for state changes to the taskcluster tasks and taskgroups
    // We only need to listen for failure and exception events on
    // tasks. We wait for the entire group to be resolved before checking
    // for success.
    const statusBindings = [
      queueEvents.taskFailed({schedulerId}),
      queueEvents.taskException({schedulerId}),
      queueEvents.taskGroupResolved({schedulerId}),
    ];

    // Listen for taskGroupDefined event to create initial status on github
    const taskGroupBindings = [
      githubEvents.taskGroupDefined(),
    ];

    // Listen for taskGroupDefined event to create initial status on github
    const taskBindings = [
      queueEvents.taskDefined(`route.${this.context.cfg.app.checkTaskRoute}`),
    ];


    const callHandler = (name, handler) => message => {
      handler.call(this, message).catch(async err => {
        debug(`Error (reported to sentry) while calling ${name} handler: ${err}`);
        await this.monitor.reportError(err);
        return err;
      }).then((err=null) => {
        if (this.handlerComplete && !err) {
          this.handlerComplete();
        } else if (this.handlerRejected && err) {
          this.handlerRejected(err);
        }
      });
    };

    this.jobPq = await consume(
      {
        client: this.pulseClient,
        bindings: jobBindings,
        queueName: this.jobQueueName,
      },
      this.monitor.timedHandler('joblistener', callHandler('job', jobHandler).bind(this))
    );

    this.resultStatusPq = await consume(
      {
        client: this.pulseClient,
        bindings: statusBindings,
        queueName: this.resultStatusQueueName,
      },
      this.monitor.timedHandler('statuslistener', callHandler('status', statusHandler).bind(this))
    );

    this.initialStatusPq = await consume(
      {
        client: this.pulseClient,
        bindings: taskGroupBindings,
        queueName: this.initialStatusQueueName,
      },
      this.monitor.timedHandler('taskGrouplistener', callHandler('task', taskGroupHandler).bind(this))
    );

    this.initialTaskStatusPq = await consume(
      {
        client: this.pulseClient,
        bindings: taskBindings,
        queueName: this.checksInitialStatusQueueName,
      },
      this.monitor.timedHandler('tasklistener', callHandler('task', taskHandler).bind(this))
    );

  }

  async terminate() {
    debug('Terminating handlers...');
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
    }
  }

  // Create a collection of tasks, centralized here to enable testing without creating tasks.
  async createTasks({scopes, tasks}) {
    let queue = new taskcluster.Queue({
      rootUrl: this.context.cfg.taskcluster.rootUrl,
      credentials: this.context.cfg.taskcluster.credentials,
      authorizedScopes: scopes,
    });
    await Promise.all(tasks.map(t => queue.createTask(t.taskId, t.task)));
  }

  // Send an exception to Github in the form of a comment.
  async createExceptionComment({instGithub, organization, repository, sha, error, pullNumber}) {
    let errorBody = error.body && error.body.error || error.message;
    // Let's prettify any objects
    if (typeof errorBody === 'object') {
      errorBody = JSON.stringify(errorBody, null, 4);
    }
    let body = [
      '<details>\n',
      '<summary>Submitting the task to Taskcluster failed. Details</summary>',
      '',
      errorBody, // already in Markdown..
      '',
      '</details>',
    ].join('\n') ;

    // Warn the user know that there was a problem handling their request
    // by posting a comment; this error is then considered handled and not
    // reported to the taskcluster team or retried
    if (pullNumber) {
      debug(`creating exception comment on ${organization}/${repository}#${pullNumber}`);
      await instGithub.issues.createComment({
        owner: organization,
        repo: repository,
        number: pullNumber,
        body,
      });
      return;
    }
    debug(`creating exception comment on ${organization}/${repository}@${sha}`);
    await instGithub.repos.createCommitComment({
      owner: organization,
      repo: repository,
      sha,
      body,
    });
  }
}
module.exports = Handlers;

/**
 * Post updates to GitHub, when the status of a task changes.
 * Taskcluster States: https://docs.taskcluster.net/reference/platform/queue/references/events
 * GitHub Statuses: https://developer.github.com/v3/repos/statuses/
 **/
async function statusHandler(message) {
  let taskGroupId = message.payload.taskGroupId || message.payload.status.taskGroupId;

  let build = await this.context.Builds.load({
    taskGroupId,
  });

  let debug = Debug(debugPrefix + ':' + build.eventId);
  debug(`Handling state change for task-group ${taskGroupId}`);

  let state = 'success';

  if (message.exchange.endsWith('task-group-resolved')) {
    let queue = new taskcluster.Queue({
      rootUrl: this.context.cfg.taskcluster.rootUrl,
    });
    let params = {};
    do {
      let group = await queue.listTaskGroup(message.payload.taskGroupId, params);
      params.continuationToken = group.continuationToken;
      group.tasks.forEach(task => {
        if (_.includes(['failed', 'exception'], task.status.state)) {
          state = 'failure';
        }
      });
    } while (params.continuationToken);
  }

  if (message.exchange.endsWith('task-exception') || message.exchange.endsWith('task-failed')) {
    state = 'failure';
  }

  await build.modify(b => {
    if (b.state !== 'failure') {
      b.state = state;
      b.updated = new Date();
    }
  });
  if (build.state !== state) {
    debug('Task group already marked as failure. Continuing.');
    return;
  }

  // Authenticating as installation.
  try {
    debug('Authenticating as installation in status handler...');
    var instGithub = await this.context.github.getInstallationGithub(build.installationId);
    debug('Authorized as installation in status handler');
  } catch (e) {
    debug(`Error authenticating as installation in status handler! Error: ${e}`);
    throw e;
  }

  debug(`Attempting to update status for ${build.organization}/${build.repository}@${build.sha} (${state})`);
  const target_url = libUrls.ui(this.context.cfg.taskcluster.rootUrl, `/task-group-inspector/#/${taskGroupId}`);
  try {
    await instGithub.repos.createStatus({
      owner: build.organization,
      repo: build.repository,
      sha: build.sha,
      state,
      target_url,
      description: 'TaskGroup: ' + state,
      context: `${this.context.cfg.app.statusContext} (${build.eventType.split('.')[0]})`,
    });
  } catch (e) {
    debug(`Failed to update status: ${build.organization}/${build.repository}@${build.sha}`);
    throw e;
  }
}

/**
 * If a .taskcluster.yml exists, attempt to turn it into a taskcluster
 * graph config, and post the initial status on github.
 **/
async function jobHandler(message) {
  let debug = Debug(debugPrefix + ':' + message.payload.eventId);
  debug('Received message. Starting processing...');
  let context = this.context;

  // Authenticating as installation.
  let instGithub = await context.github.getInstallationGithub(message.payload.installationId);

  // We must attempt to convert the sanitized fields back to normal here. 
  // Further discussion of how to deal with this cleanly is in
  // https://github.com/taskcluster/taskcluster-github/issues/52
  message.payload.organization = message.payload.organization.replace(/%/g, '.');
  message.payload.repository = message.payload.repository.replace(/%/g, '.');
  let organization = message.payload.organization;
  let repository = message.payload.repository;
  let sha = message.payload.details['event.head.sha'];
  let pullNumber = message.payload.details['event.pullNumber'];
  if (!sha) {
    debug('Trying to get commit info in job handler...');
    let commitInfo = await instGithub.repos.getCommitRefSha({
      owner: organization,
      repo: repository,
      ref: `refs/tags/${message.payload.details['event.version']}`,
    });
    sha = commitInfo.data.sha;
  }

  debug(`handling ${message.payload.details['event.type']} webhook for: ${organization}/${repository}@${sha}`);
  let repoconf = undefined;

  // Try to fetch a .taskcluster.yml file for every request
  try {
    debug(`Trying to fetch the YML for ${organization}/${repository}@${sha}`);
    let tcyml = await instGithub.repos.getContents({
      owner: organization,
      repo: repository,
      path: '.taskcluster.yml',
      ref: sha,
    });
    repoconf = new Buffer(tcyml.data.content, 'base64').toString();
  } catch (e) {
    if (e.code === 404) {
      debug(`${organization}/${repository}@${sha} has no '.taskcluster.yml'. Skipping.`);
      return;
    }
    if (_.endsWith(e.message, '</body>\n</html>\n') && e.message.length > 10000) {
      // We kept getting full html 500/400 pages from github in the logs.
      // I consider this to be a hard-to-fix bug in octokat, so let's make
      // the logs usable for now and try to fix this later. It's a relatively
      // rare occurence.
      debug('Detected an extremely long error. Truncating!');
      e.message = _.join(_.take(e.message, 100).concat('...'), '');
      e.stack = e.stack.split('</body>\n</html>\n')[1] || e.stack;
    }
    debug(`Error fetching yaml for ${organization}/${repository}@${sha}: ${e.message} \n ${e.stack}`);
    throw e;
  }

  // Check if this is meant to be built by tc-github at all.
  // This is a bit of a hack, but is needed for bug 1274077 for now
  try {
    let c = yaml.safeLoad(repoconf);
  } catch (e) {
    if (e.name === 'YAMLException') {
      return await this.createExceptionComment({instGithub, organization, repository, sha, error: e, pullNumber});
    }
    debug(`Error checking yaml for ${organization}/${repository}@${sha}: ${e}`);
    throw e;
  }

  let groupState = 'pending';
  let taskGroupId = 'nonexistent';
  let graphConfig;

  // Now we can try processing the config and kicking off a task.
  try {
    graphConfig = this.intree({
      config: repoconf,
      payload: message.payload,
      validator: context.validator,
      schema: {
        0: libUrls.schema(this.rootUrl, 'github', 'v1/taskcluster-github-config.yml'),
        1: libUrls.schema(this.rootUrl, 'github', 'v1/taskcluster-github-config.v1.yml'),
      },
    });
    if (graphConfig.tasks.length === 0) {
      debug(`intree config for ${organization}/${repository}@${sha} compiled with zero tasks. Skipping.`);
      return;
    }
  } catch (e) {
    debug(`.taskcluster.yml for ${organization}/${repository}@${sha} was not formatted correctly. 
      Leaving comment on Github.`);
    await this.createExceptionComment({instGithub, organization, repository, sha, error: e, pullNumber});
    return;
  }

  if (message.payload.details['event.type'].startsWith('pull_request.')) {
    debug(`Checking pull request permission for for ${organization}/${repository}@${sha}...`);

    // Decide if a user has permissions to run tasks.
    let login = message.payload.details['event.head.user.login'];
    try {
      if (!await prAllowed({login, organization, repository, instGithub, debug, message})) {
        let body = [
          '<details>\n',
          '<summary>No Taskcluster jobs started for this pull request</summary>\n\n',
          '```js\n',
          'The `allowPullRequests` configuration for this repository (in `.taskcluster.yml` on the',
          'default branch) does not allow starting tasks for this pull request.',
          '```\n',
          '</details>',
        ].join('\n');
        await instGithub.issues.createComment({
          owner: organization,
          repo: repository,
          number: pullNumber,
          body,
        });
        return;
      }
    } catch (e) {
      if (e.name === 'YAMLException') {
        let docsLink = 'https://docs.taskcluster.net/reference/integrations/github/docs/usage#who-can-trigger-jobs';
        await instGithub.issues.createComment({
          owner: organization,
          repo: repository,
          number: pullNumber,
          body: [
            '<details>\n',
            '<summary>Error in `.taskcluster.yml` while checking',
            'for permissions **on default branch ' + branch + '**.',
            'Read more about this in',
            '[the taskcluster docs](' + docsLink + ').',
            'Details:</summary>\n\n',
            '```js\n',
            e.message,
            '```\n',
            '</details>',
          ].join('\n'),
        });
        return;
      }
      debug(`Error checking PR permissions for ${organization}/${repository}@${sha}`);
      throw e;
    }
  }

  taskGroupId = graphConfig.tasks[0].task.taskGroupId;

  debug(`Trying to create a record for ${organization}/${repository}@${sha} (${groupState}) in Builds table`);
  let now = new Date();
  await context.Builds.create({
    organization,
    repository,
    sha,
    taskGroupId,
    state: groupState,
    created: now,
    updated: now,
    installationId: message.payload.installationId,
    eventType: message.payload.details['event.type'],
    eventId: message.payload.eventId,
  }).catch(async (err) => {
    if (err.code !== 'EntityAlreadyExists') {
      throw err;
    }
    let build = await this.Builds.load({
      taskGroupId,
    });
    assert.equal(build.state, groupState, `State for ${organization}/${repository}@${sha}
      already exists but is set to ${build.state} instead of ${groupState}!`);
    assert.equal(build.organization, organization);
    assert.equal(build.repository, repository);
    assert.equal(build.sha, sha);
    assert.equal(build.eventType, message.payload.details['event.type']);
    assert.equal(build.eventId, message.payload.eventId);
  }).then(async data => {
    debug(`Creating tasks for ${organization}/${repository}@${sha} (taskGroupId: ${taskGroupId})`);
    return await this.createTasks({scopes: graphConfig.scopes, tasks: graphConfig.tasks});
  }).catch(async e => {
    debug(`Creating tasks for ${organization}/${repository}@${sha} failed! Leaving comment on Github.`);
    return await this.createExceptionComment({instGithub, organization, repository, sha, error: e});
  });


  try { // TODO

    debug(`Publishing status exchange for ${organization}/${repository}@${sha} (${groupState})`);
    await context.publisher.taskGroupDefined({taskGroupId, organization, repository});

    debug(`Job handling for ${organization}/${repository}@${sha} completed.`);

  } catch (e) {

  }
}

/**
 * When the task was defined, post the initial status to github
 * statuses api function
 *
 * @param message - taskGroupDefined exchange message
 *   this repo/schemas/task-group-defined-message.yml
 * @returns {Promise<void>}
 */
async function taskGroupHandler(message) {
  const {taskGroupId} = message.payload;

  const debug = Debug(`${debugPrefix}:taskGroup-handler`);
  debug(`Task group ${taskGroupId} was defined. Creating group status...`);

  const {
    organization,
    repository,
    sha,
    state,
    eventType,
    installationId,
  } = await this.context.Builds.load({taskGroupId});

  const statusContext = `${this.context.cfg.app.statusContext} (${eventType.split('.')[0]})`;
  const description = `TaskGroup: Pending (for ${eventType})`;
  const target_url = libUrls.ui(this.context.cfg.taskcluster.rootUrl, `/task-group-inspector/#/${taskGroupId}`);

  // Authenticating as installation.
  const instGithub = await this.context.github.getInstallationGithub(installationId);

  await instGithub.repos.createStatus({
    owner: organization,
    repo: repository,
    sha,
    state,
    target_url,
    description,
    context: statusContext,
  });
}

/**
 * When the task was defined, post the initial status to github
 * checks api function
 *
 * @param message - taskDefined exchange message
 *   https://docs.taskcluster.net/docs/reference/platform/taskcluster-queue/references/events#taskDefined
 * @returns {Promise<void>}
 */
async function taskHandler(message) {
  const {taskGroupId, taskId} = message.payload.status;

  const debug = Debug(`${debugPrefix}:task-handler`);
  debug(`🍗 Got a message: ${JSON.stringify(message, null, 2)}`);
  debug(`Task was defined for task group ${taskGroupId}. Creating status for task ${taskId}...`);


  const {
    organization,
    repository,
    sha,
    eventType,
    installationId,
  } = await this.context.Builds.load({taskGroupId});

  // Authenticating as installation.
  const instGithub = await this.context.github.getInstallationGithub(installationId);

  debug(`Authenticated as installation. Creating check run for task ${taskId}, task group ${taskGroupId}`);

  const checkRun = await instGithub.checks.create({
    owner: organization,
    repo: repository,
    name: `Task ${taskId}: ${this.context.cfg.app.statusContext} (${eventType.split('.')[0]})`,
    head_sha: sha,
    output: {
      title: `TaskGroup: Queued (for ${eventType})`,
      summary: `Check for ${eventType}`,
    },
    details_url: `${this.context.cfg.taskcluster.rootUrl}/groups/${taskGroupId}/tasks/${taskId}/details`,
  }).catch(async (err) => {
      await this.createExceptionComment({instGithub, organization, repository, sha, error: err});
      throw err;
  });

  debug(`Created check run for task ${taskId}, task group ${taskGroupId}. Now updating data base`);

  await this.context.CheckRuns.create({
      taskGroupId,
      taskId,
      checkSuiteId: checkRun.data.check_suite.id.toString(),
      checkRunId: checkRun.data.id.toString(),
    }).catch(async (err) => {
      await this.createExceptionComment({instGithub, organization, repository, sha, error: err});
      throw err;
    });

  debug(`Status for task ${taskId}, task group ${taskGroupId} created`);
}