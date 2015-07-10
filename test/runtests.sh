#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

export influx_connectionString=${influx_connectionString-"https://localhost"}
export webhook_secret="il-se-cache"

mocha                               \
  test/taskcluster_github_test.js   \
  ;
