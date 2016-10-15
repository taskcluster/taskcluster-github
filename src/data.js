let Entity = require('azure-entities');

module.exports = {};

/**
 * Entity for tracking which task-groups are associated
 * with which org/repo/sha, etc.
 *
 */
module.exports.Build = Entity.configure({
  version: 1,
  partitionKey: Entity.keys.CompositeKey('organization', 'repository', 'sha'),
  rowKey: Entity.keys.StringKey('taskGroupId'),
  properties: {
    organization: Entity.types.String,
    repository: Entity.types.String,
    sha: Entity.types.String,
    taskGroupId: Entity.types.String,
    status: Entity.types.String,
  },
});
