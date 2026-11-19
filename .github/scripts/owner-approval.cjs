const OWNER_ID = 79330197
const STATUS_CONTEXT = "Owner approval"

function approvalStatus(pr, reviews) {
  if (pr.user.id === OWNER_ID) {
    return { state: "success", description: "Owner-authored PR; no review required." }
  }

  const decision = reviews
    .filter((review) => review.user?.id === OWNER_ID)
    .filter((review) => ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
    .sort((a, b) => b.id - a.id)[0]

  if (decision?.state === "APPROVED" && decision.commit_id === pr.head.sha) {
    return { state: "success", description: "@viralcodex approved the current PR commit." }
  }

  return { state: "failure", description: "Requires @viralcodex approval of the current PR commit." }
}

async function reconcile({ github, context, core }) {
  const repo = context.repo
  const prs = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: "open",
    base: "main",
    per_page: 100,
  })
  const statuses = new Map()

  for (const listed of prs) {
    // Fetch current state rather than trusting a potentially old event payload.
    const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: listed.number })
    if (pr.state !== "open" || pr.base.ref !== "main") continue

    let status
    try {
      const reviews = pr.user.id === OWNER_ID ? [] : await github.paginate(github.rest.pulls.listReviews, {
        ...repo,
        pull_number: pr.number,
        per_page: 100,
      })
      status = approvalStatus(pr, reviews)
    } catch (error) {
      // Never leave a previous success intact if the review lookup fails.
      status = { state: "error", description: "Could not verify owner approval. Rerun this workflow." }
      core.error(`PR #${pr.number}: ${error.message}`)
    }

    // Statuses belong to commits, not PRs. A second PR sharing a head commit
    // must not overwrite a failed approval check with an owner exemption.
    const previous = statuses.get(pr.head.sha)
    if (!previous || previous.state === "success" || status.state === "error") {
      statuses.set(pr.head.sha, status)
    }
    core.info(`PR #${pr.number}: ${status.state} - ${status.description}`)
  }

  for (const [sha, status] of statuses) {
    await github.rest.repos.createCommitStatus({
      ...repo,
      sha,
      context: STATUS_CONTEXT,
      target_url: `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`,
      ...status,
    })
  }
}

module.exports = { approvalStatus, reconcile }
