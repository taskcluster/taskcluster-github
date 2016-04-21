#!/usr/bin/env node
import Debug from 'debug';
import base from 'taskcluster-base';
import api from '../lib/api';
import path from 'path';
import Promise from 'promise';
import exchanges from '../lib/exchanges';
import _ from 'lodash';
import Octokat from 'octokat';

let debug = Debug('github:server');
/** Launch server */
let launch = async function(profile, publisher) {
  debug("Launching with profile: %s", profile);
  let cfg = base.config({profile});

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

  // Start monitoring the process
  base.stats.startProcessUsageReporting({
    drain:      statsDrain,
    component:  cfg.taskclusterGithub.statsComponent,
    process:    'server'
  });

  let validator = await base.validator({
    prefix: 'github/v1/',
    aws: cfg.aws,
  });

  let pulseCredentials = cfg.pulse;
  if (publisher) {
    debug("Using a custom publisher instead of pulse")
  } else if (pulseCredentials.username && pulseCredentials.password) {
      publisher = await exchanges.setup({
        credentials:        pulseCredentials,
        exchangePrefix:     cfg.taskclusterGithub.exchangePrefix,
        validator:          validator,
        referencePrefix:    'github/v1/exchanges.json',
        publish:            cfg.taskclusterGithub.publishMetaData,
        aws:                cfg.aws,
        drain:              statsDrain,
        component:          cfg.taskclusterGithub.statsComponent,
        process:            'server'
      });
 } else {
    throw "Can't initialize pulse publisher: missing credentials"
 }

  // A single connection to the GithubAPI to pass into the router context
  let githubAPI = new Octokat(cfg.github.credentials);

  // Create API router and publish reference if needed
  debug("Creating API router");

  let router = await api.setup({
    context:          {publisher, cfg, githubAPI},
    validator:        validator,
    authBaseUrl:      cfg.taskcluster.authBaseUrl,
    publish:          cfg.taskclusterGithub.publishMetaData,
    baseUrl:          cfg.server.publicUrl + '/v1',
    referencePrefix:  'github/v1/api.json',
    aws:              cfg.aws,
    component:        cfg.taskclusterGithub.statsComponent,
    drain:            statsDrain
  });

  debug("Configuring app");

  // Create app
  let app = base.app(cfg.server);

  // Mount API router
  app.use('/v1', router);

  // Create server
  debug("Launching server");
  return app.createServer();
};

// If server.js is executed start the server
if (!module.parent) {
  // Find configuration profile
  let profile = process.argv[2];
  if (!profile) {
    console.log("Usage: server.js [profile]");
    console.error("ERROR: No configuration profile is provided");
  }
  // Launch with given profile
  launch(profile).then(function() {
    debug("Launched server successfully");
  }).catch(function(err) {
    debug("Failed to start server, err: %s, as JSON: %j", err, err, err.stack);
    // If we didn't launch the server we should crash
    process.exit(1);
  });
}

// Export launch in-case anybody cares
module.exports = launch;

