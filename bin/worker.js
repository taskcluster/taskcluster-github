#!/usr/bin/env node
import Debug from 'debug';
import assert from 'assert';
import path from 'path';
import base from 'taskcluster-base';
import Promise from 'promise';
import exchanges from '../lib/exchanges';
import common from '../lib/common';
import worker from '../lib/worker';
import _ from 'lodash';
import taskcluster from 'taskcluster-client';
import Octokat from 'octokat';

let debug = Debug('github:worker');
/** Launch worker */
var launch = async function(profile) {
  debug("Launching with profile: %s", profile);

  var cfg = base.config({profile});

  let statsDrain = null;
  try {
    statsDrain = new base.stats.Influx({
      connectionString: cfg.influx.connectionString,
      maxDelay: cfg.influx.maxDelay,
      maxPendingPoints: cfg.influx.maxPendingPoints
    });
  } catch(e) {
    debug("Missing influx_connectionString: stats collection disabled.");
    statsDrain = {
      addPoint: (...args) => {debug("stats:", args)}
    };
  }

  // For use in validation of taskcluster github config files
  let validator = await base.validator({
    prefix: 'github/v1/',
    aws: cfg.aws,
  });

  // Create a single connection to the GithubAPI to pass around
  var githubAPI = new Octokat(cfg.github.credentials);

  var scheduler = new taskcluster.Scheduler(cfg.taskcluster);

  // A context to be passed into message handlers
  let context = {cfg, githubAPI, scheduler, validator};

  // Start monitoring the process
  base.stats.startProcessUsageReporting({
    drain:      statsDrain,
    component:  cfg.taskclusterGithub.statsComponent,
    process:    'worker'
  });

  let pulseCredentials = cfg.pulse
  assert(pulseCredentials.username, 'Username must be supplied for pulse connection');
  assert(pulseCredentials.password, 'Password must be supplied for pulse connection');

  var webHookListener = new taskcluster.PulseListener({
    queueName:  profile,
    credentials: {
      username: pulseCredentials.username,
      password: pulseCredentials.password
    }
  });

  let exchangeReference = exchanges.reference({
    exchangePrefix:   cfg.taskclusterGithub.exchangePrefix,
    credentials:      cfg.pulse
  });

  let GitHubEvents = taskcluster.createClient(exchangeReference);
  let githubEvents = new GitHubEvents();

  // Attempt to launch jobs for any possible pull request action
  await webHookListener.bind(githubEvents.pullRequest(
    {organization: '*', repository: '*', action: '*'}));

  // Launch jobs for push events as well.
  await webHookListener.bind(githubEvents.push(
    {organization: '*', repository: '*'}));

  // Listen for, and handle, changes in graph/task state: to reset status
  // messages, send notifications, etc....
  let schedulerEvents = new taskcluster.SchedulerEvents();
  let route = 'route.taskcluster-github.*.*.*';
  webHookListener.bind(schedulerEvents.taskGraphRunning(route));
  webHookListener.bind(schedulerEvents.taskGraphBlocked(route));
  webHookListener.bind(schedulerEvents.taskGraphFinished(route));

  // Route recieved messages to an appropriate handler via matching
  // exchange names to a regular expression
  let webHookHandlerExp = RegExp('(.*pull-request|.*push)', 'i');
  let graphChangeHandlerExp = RegExp('exchange/taskcluster-scheduler/.*', 'i');
  webHookListener.on('message', function(message) {
    if (webHookHandlerExp.test(message.exchange)) {
      worker.webHookHandler(message, context);
    } else if (graphChangeHandlerExp.test(message.exchange)) {
      worker.graphStateChangeHandler(message, context);
    } else {
      debug('Ignoring message from unsupported exchange:', message.exchange);
    }
  });
  await webHookListener.resume();
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

