async function prAllowed(options) {
  return await isCollaborator(options);
}

async function isCollaborator({login, organization, repository, sha, instGithub, debug}) {
  if (login === organization) {
    debug(`Checking collaborator: ${login} === ${organization}: True!`);
    return true;
  }

  // If the user is in the org, we consider them
  // qualified to trigger any job in that org.
  try {
    await instGithub.orgs.checkMembership({
      org: organization,
      owner: login,
    });
    debug(`Checking collaborator: ${login} is a member of ${organization}: True!`);
    return true;
  } catch (e) {
    if (e.code == 404) {
      // Only a 404 error means the user isn't a member
      // anything else should just throw like normal
    } else {
      throw e;
    }
  }

  // GithubAPI's collaborator check returns an error if a user isn't
  // listed as a collaborator.
  try {
    await instGithub.repos.checkCollaborator({
      owner: organization,
      repo: repository,
      collabuser: login,
    });
    // No error, the user is a collaborator
    debug(`Checking collaborator: ${login} is a collaborator on ${organization}/${repository}: True!`);
    return true;
  } catch (e) {
    if (e.code == 404) {
      // Only a 404 error means the user isn't a collaborator
      // anything else should just throw like normal
    } else if (e.code == 403) {
      let msg = `Taskcluster does not have permission to check for repository collaborators.
        Ensure that it is a member of a team with __write__ access to this repository!`;
      debug(`Insufficient permissions to check for collaborators of ${organization}/${repository}. Skipping.`);
      await instGithub.repos.createCommitComment({
        owner: organization,
        repo: repository,
        sha,
        body: msg,
      });
      return false;
    } else {
      throw e;
    }
  }
  return false;
}

module.exports = prAllowed;
