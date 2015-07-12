#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

mocha                               \
  test/taskcluster_github_test.js   \
  ;
