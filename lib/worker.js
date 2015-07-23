var request     = require('request-promise')
var taskcluster = require('taskcluster-client')
var tcrc        = require('./taskclusterrc');
var slugid      = require('slugid');

var worker = module.exports = {};

var GITHUB_CONTENT_URL = "https://raw.githubusercontent.com";

/**
 * If a .taskclusterrc exists, attempt to turn it into a taskcluster
 * task payload, and submit it to the queue.
 **/
worker.pullRequestHandler = async function(message, context) {
  let payload = message.payload;
  let taskclusterrcURL = [
    GITHUB_CONTENT_URL,
    payload.organization,
    payload.repository,
    payload.details.baseRevision,
    ".taskclusterrc"
  ].join("/");
  let queue = new taskcluster.Queue(context.cfg.get('taskcluster'));
  let taskclusterrc = await request(taskclusterrcURL);
  let taskConfig = await tcrc.processConfig(taskclusterrc, payload);
  let taskResult = await queue.createTask(slugid.v4(), taskConfig);
  console.log(taskResult);
};
