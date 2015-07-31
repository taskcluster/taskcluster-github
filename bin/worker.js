#!/usr/bin/env node
var debug             = require('debug')('github:worker');
var base              = require('taskcluster-base');
var Promise           = require('promise');
var exchanges         = require('../lib/exchanges');
var worker            = require('../lib/worker');
var _                 = require('lodash');
var taskcluster       = require('taskcluster-client');
var GitHubAPI         = require('github');

/** Launch worker */
var launch = async function(profile) {
  debug("Launching with profile: %s", profile);

  // Load configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/' + profile),
    envs: [
      'pulse_username',
      'pulse_password',
      'taskclusterGithub_publishMetaData',
      'taskcluster_credentials_clientId',
      'taskcluster_credentials_accessToken',
      'aws_accessKeyId',
      'aws_secretAccessKey',
      'influx_connectionString',
      'webhook_secret'
    ],
    filename:     'taskcluster-github'
  });

  // Create a single connection to the GithubAPI to pass around
  var githubAPI = new GitHubAPI(cfg.get('github:config'));
  githubAPI.authenticate(cfg.get('github:credentials'));

  // A context to be passed into message handlers
  let context = {cfg, githubAPI};

  // Create a default stats drain, which just prints to stdout
  let statsDrain = {
      addPoint: (...args) => {debug("stats:", args)}
  }

  // Create InfluxDB connection for submitting statistics
  let influxConnectionString = cfg.get('influx:connectionString')
  if (influxConnectionString) {
      statsDrain = new base.stats.Influx({
        connectionString:   influxConnectionString,
        maxDelay:           cfg.get('influx:maxDelay'),
        maxPendingPoints:   cfg.get('influx:maxPendingPoints')
      });
  } else {
      debug("Missing influx_connectionString: stats collection disabled.")
  }

  // Start monitoring the process
  base.stats.startProcessUsageReporting({
    drain:      statsDrain,
    component:  cfg.get('taskclusterGithub:statsComponent'),
    process:    'worker'
  });

  let pulseCredentials = cfg.get('pulse')
  if (pulseCredentials.username && pulseCredentials.password) {
    var pullRequestListener = new taskcluster.PulseListener({
      queueName:  profile,
      credentials: {
        username: pulseCredentials.username,
        password: pulseCredentials.password
      }
    });

    let exchangeReference = exchanges.reference({
      exchangePrefix:   cfg.get('taskclusterGithub:exchangePrefix'),
      credentials:      cfg.get('pulse')
    });

    let GitHubEvents = taskcluster.createClient(exchangeReference);
    let githubEvents = new GitHubEvents();
    // Listen for, and handle, WebHook triggered events: i.e. pull requests
    await pullRequestListener.bind(githubEvents.pullRequest(
      {organization: '*', repository: '*', action: 'opened'}));

    // Listen for, and handle, changes in graph/task state: to reset status
    // messages, send notifications, etc....
    let schedulerEvents = new taskcluster.SchedulerEvents();
    let route = 'route.taskcluster-github.*.*.*';
    pullRequestListener.bind(schedulerEvents.taskGraphRunning(route));
    pullRequestListener.bind(schedulerEvents.taskGraphBlocked(route));
    pullRequestListener.bind(schedulerEvents.taskGraphFinished(route));

    // Route recieved messages to an appropriate handler
    pullRequestListener.on('message', function(message) {
      if (message.payload.action == 'opened' || message.payload.action == 'updated') {
        worker.pullRequestHandler(message, context);
      } else if (message.payload.routing) {
        worker.graphStateChangeHandler(message, context);
      }
    });

    await pullRequestListener.resume();

  } else {
    throw "Missing pulse credentials"
  }
};

// If worker.js is executed start the worker
if (!module.parent) {
  // Find configuration profile
  var profile = process.argv[2];
  if (!profile) {
    console.log("Usage: worker.js [profile]");
    console.error("ERROR: No configuration profile is provided");
  }
  // Launch with given profile
  launch(profile).then(function() {
    debug("Launched worker successfully");
  }).catch(function(err) {
    debug("Failed to start worker, err: %s, as JSON: %j", err, err, err.stack);
    // If we didn't launch the worker we should crash
    process.exit(1);
  });
}

// Export launch in-case anybody cares
module.exports = launch;
