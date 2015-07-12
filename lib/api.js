var base      = require('taskcluster-base');
var github    = require('../utils/github');

// Common schema prefix
var SCHEMA_PREFIX_CONST = 'http://schemas.taskcluster.net/github/v1/';

// Convert GitHub event types to their expected publisher name
var eventTypeToPublisherName = function(eventType) {
  let firstUnderscore = eventType.indexOf("_")
  if (firstUnderscore < 0) {
    return eventType
  }
  let publisherName = eventType.substring(0, firstUnderscore)
  publisherName += eventType.substring(
    firstUnderscore + 1, firstUnderscore + 2).toUpperCase()
  publisherName += eventType.substring(firstUnderscore + 2, eventType.length)
  return eventTypeToPublisherName(publisherName)
}

/** API end-point for version v1/
 *
 * In this API implementation we shall assume the following context:
 * {
 *   publisher:      // publisher from base.Exchanges
 * }
 */
var api = new base.API({
  title:        "TaskCluster GitHub API Documentation",
  description: [
    "The github service, typically available at",
    "`github.taskcluster.net`, is responsible for publishing pulse",
    "messages in response to GitHub events.",
    "",
    "This document describes the API end-point for consuming GitHub",
    "web hooks"
  ].join('\n')
});

// Export API
module.exports = api;

/** Define tasks */
api.declare({
  method:     'post',
  route:      '/github',
  name:       'githubWebHookConsumer',
  scopes:     undefined,
  title:      "Consume GitHub WebHook",
  description: [
    "Capture a GitHub event and publish it via pulse, if it's a push",
    "or pull request."
  ].join('\n')
}, async function(req, res) {
  let eventType = req.headers['x-github-event']
  if (!eventType) {
    res.status(400).send("Missing X-GitHub-Event")
  }

  let body = req.body
  if (!body) {
    req.status(400).send("Request missing a body")
  }

  // When pulse is activated, locate valid publishers by naming
  // convention and fail if we don't find one which matches the
  // event type
  let publisher = this.publisher[eventTypeToPublisherName(eventType)]
  if (!publisher) {
    res.status(400).send("No publisher available for X-GitHub-Event: " + eventType)
  }

  let webhookSecret = this.cfg.get('webhook:secret')
  let xHubSignature = req.headers['x-hub-signature']

  if (xHubSignature && !webhookSecret) {
      res.status(400).send("Server is not setup to handle secrets")
  } else if (webhookSecret && !xHubSignature) {
      res.status(400).send("Request missing a secret")
  } else if (webhookSecret && xHubSignature) {
    // Verify that our payload is legitimate
    let calculatedSignature = github.generateXHubSignature(
      webhookSecret, JSON.stringify(body))
    if (calculatedSignature != xHubSignature) {
        res.status(403).send("Bad Signature")
    }
  }

  let publisherArgs = {
    organizationName: body.organization.login,
    repositoryName: body.repository.full_name,
    action: body.action,
    details: {}
  }

  await publisher(publisherArgs);

  // Return 200
  res.status(200).send()
});

/** Check that the server is a alive */
api.declare({
  method:   'get',
  route:    '/ping',
  name:     'ping',
  title:    "Ping Server",
  description: [
    "Documented later...",
    "",
    "**Warning** this api end-point is **not stable**."
  ].join('\n')
}, function(req, res) {

  res.status(200).json({
    alive:    true,
    uptime:   process.uptime()
  });
});
