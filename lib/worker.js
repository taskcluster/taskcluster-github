var tcrc        = require('./taskclusterrc');
var github      = require('./github');
var request     = require('request-promise')
var taskcluster = require('taskcluster-client')
var slugid      = require('slugid');

var worker = module.exports = {};

var GITHUB_CONTENT_URL = "https://raw.githubusercontent.com";

/**
 * If a .taskclusterrc exists, attempt to turn it into a taskcluster
 * task payload, and submit it to the queue.
 **/
worker.pullRequestHandler = async function(message, context) {
  try {
    let msgPayload = message.payload;
    let taskclusterrcURL = [
      GITHUB_CONTENT_URL,
      msgPayload.organization,
      msgPayload.repository,
      msgPayload.details.baseRevision,
      ".taskclusterrc"
    ].join("/");
    let queue = new taskcluster.Queue(context.cfg.get('taskcluster'));
    let taskclusterrc = await request(taskclusterrcURL);
    let taskConfig = await tcrc.processConfig(taskclusterrc, msgPayload);
    let queueResponse = await queue.createTask(slugid.v4(), taskConfig);

    // Set a pending status on the pull request's head commit
    let statusUpdate = await github.updateTaskStatus(
      context.githubAPI,
      msgPayload.organization,
      msgPayload.repository,
      msgPayload.details.headSha,
      queueResponse.status.state,
      queueResponse.status.taskId);

    if (statusUpdate != null) {
      // If this isn't null, something has gone wrong
      throw(statusUpdate);
    }
  } catch(e) {
    console.log(e);
  }
};

/**
 * Take actions, such as posting updates to GitHub, when the
 * status of a task changes.
 **/
worker.graphStateChangeHandler = async function(message, context) {
};
