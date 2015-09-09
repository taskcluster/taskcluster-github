var debug       = require('debug')('github:worker');
var tcconfig    = require('./taskcluster-config');
var github      = require('./github');
var common      = require('./common');
var taskcluster = require('taskcluster-client')
var slugid      = require('slugid');

var worker = module.exports = {};

/**
 * If a .taskcluster.yml exists, attempt to turn it into a taskcluster
 * graph config, and submit it to the scheduler.
 **/
worker.webHookHandler = async function(message, context) {
  debug('handling webhook: ', message);
  let msgPayload = message.payload;

  // Try to fetch a .taskcluster.yml file for every request
  let taskclusterConfig = await context.githubAPI.repos(
    msgPayload.organization, msgPayload.repository
  ).contents('.taskcluster.yml').read()

  let schema = common.SCHEMA_PREFIX_CONST + 'taskcluster-github-config.json#';
  if (taskclusterConfig) {
    // Attach some info about the user who created a request which
    // needs to come directly from the GitHub API. This info will be
    // used to decide which tasks a user has permissions to run.
    let headUserInfo = {};
    headUserInfo.login = msgPayload.details['event.head.user.login']

    headUserInfo.orgs = await context.githubAPI.users(
      headUserInfo.login
    ).orgs.fetch();

    // GithubAPI's collaborator check returns an error if a user isn't
    // listed as a collaborator.
    try {
      await context.githubAPI.repos(
        msgPayload.organization, msgPayload.repository
      ).collaborators(headUserInfo.login).fetch();
      // No error, the user is a collaborator
      headUserInfo.isCollaborator = true;
    } catch (e) {
        if (e.status == 404) {
          // Only a 404 error means the user isn't a collaborator
          // anything else should just throw like normal
          headUserInfo.isCollaborator = false;
          debug(e.message);
        } else {
          throw(e)
        }
    }

    try {
      let graphConfig = await tcconfig.processConfig({
        taskclusterConfig:  taskclusterConfig,
        payload:            msgPayload,
        userInfo:           headUserInfo,
        validator:          context.validator,
        schema:             schema
      });
      if (graphConfig.tasks.length) {
        await context.scheduler.createTaskGraph(slugid.nice(), graphConfig);
      } else {
        debug('graphConfig compiled with zero tasks: skipping');
      }
    } catch(e) {
      debug(e);
      // Let the user know that there was a problem processing their
      // config file. TODO: upload these messages to a place where
      // users can access them, and provide a link to it in the
      // target_url
      let statusMessage = {
        state:        'error',
        description:  e.toString(),
        context:      'TaskCluster',
        target_url:   schema
      };
      await github.updateStatus(context.githubAPI,
        msgPayload.organization,
        msgPayload.repository,
        msgPayload.details['event.head.sha'],
        statusMessage);
    }
  }
};

/**
 * Post updates to GitHub, when the status of a task changes.
 **/
worker.graphStateChangeHandler = async function(message, context) {
  try {
    debug('handling state change for message: ', message);
    let inspectorUrl = 'https://tools.taskcluster.net/task-graph-inspector/#';
    let statusMessage = {
      state:        github.StatusMap[message.payload.status.state],
      target_url:   inspectorUrl + message.payload.status.taskGraphId,
      description:  'TaskGraph: ' + message.payload.status.state,
      context:      'TaskCluster'
    };
    let route = message.routes[0].split('.');
    await github.updateStatus(context.githubAPI, route[1], route[2], route[3],
       statusMessage);
  } catch(e) {
    debug('Failed to update GitHub commit status: ', e);
  }
};
