---
title: .taskcluster.yml version 1
order: 20
---

Your main interface to Taskcluster-Github is via `.taskcluster.yml` in the root
of your project. This is a YAML file that speciifies the tasks to run and when.

The format of the file is:

```yaml
version: 1
policy:
  pullRequests: ..
tasks:
  - (task definition)
  - ...
```

The core of Taskcluster-Github's operation is this: when an event occurs on
Github, such as a push or a pull request, it loads `.taskcluster.yml` from the
commit specified in the event, renders it with JSON-e, and then calls
`Queue.createTask` for each of the specified tasks.

# JSON-e Rendering

The entire YAML file is rendered using
[JSON-e](https://github.com/taskcluster/json-e). The following context
variables are provided:

* `tasks_for` - defines the type of event, one of `github-push`,
  `github-pull-request`, or `github-release`.

* `event` - the raw Github event; see
  * [PushEvent](https://developer.github.com/v3/activity/events/types/#pushevent)
  * [PullRequestEvent](https://developer.github.com/v3/activity/events/types/#pullrequestevent)
  * [ReleaseEvent](https://developer.github.com/v3/activity/events/types/#releaseevent)

* `now` - the current time, as a string; this is useful for reproducible `$fromNow` invocations

* `as_slugid` - a function which, given a label, will generate a slugid.
  Multiple calls with the same label for the same event will generate the same
  slugiid, but different slugids in different events.  Use this to generate
  taskIds, etc.

## Result

After rendering, the resulting data structure should have a `tasks` property
containing a list of task definitions. Each task definition should match the [task
schema](https://docs.taskcluster.net/reference/platform/taskcluster-queue/docs/task-schema)
as it will be passed nearly unchanged to `Queue.createTask`, The exception is
that the provided task definition must contain a `taskId` field, which the
service will remove and pass to `Queue.createTask` directly.

# Policies

The `policy` property defines policies for what is allowed on the repository.
Policies are always read from the default branch (generally `master`) of the
repository. This prevents a malicious contributor from changing the policy
applied to a pull request in the pull request itself.

## Pull Requests

Most projects prefer to run tasks for each pull request, so that the review
process can take into account the task results. But if your project requires
some secret data, or uses some expensive service, to test a pull request, then
you probably do not want to run tasks for pull requests written by aritbrary
contributors, but would still like to run tasks for PR's by project
collaborators.

The `pullRequests` policy controls this behavior:

* `public` -- tasks are created for all pull requests.

* `collaborators` (the default) -- tasks are created if the user who made the
  pull request is a collaborator on the repository.  Github [defines
  collaborators](https://developer.github.com/v3/repos/collaborators/#list-collaborators)
  as "outside collaborators, organization members with access through team
  memberships, organization members with access through default organization
  permissions, and organization owners."

# Scopes

Taskcluster-Github uses a very specific
[role](https://docs.taskcluster.net/manual/design/apis/hawk/roles) to create
tasks for each project.  That role has the form
* `assume:repo:github.com/<owner>/<repo>:branch:<branch>` for a push event
* `assume:repo:github.com/<owner>/<repo>:pull-request` for a pull request
* `assume:repo:github.com/<owner>/<repo>:release` for a release event

Careful configuration of these roles and the related tasks can allow powerful
behaviors such as binary uploads on push, without allowing pull requests access
to those capabilities.
