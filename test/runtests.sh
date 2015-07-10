#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

export webhook_secret="c-etait-un-secret"
mocha                               \
  test/taskcluster_github_test.js   \
  ;
