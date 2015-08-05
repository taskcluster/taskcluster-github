var base = require('taskcluster-base');

var common = module.exports = {};

// Load configuration
common.loadConfig = function(profile) {
  return base.config({
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
};

common.buildInfluxStatsDrain = function(connectionString, maxDelay, maxPendingPoints) {
  // Create InfluxDB connection for submitting statistics
   return new base.stats.Influx({
    connectionString:   connectionString,
    maxDelay:           maxDelay,
    maxPendingPoints:   maxPendingPoints
   });
};

common.stdoutStatsDrain = {
    addPoint: (...args) => {debug("stats:", args)}
};
