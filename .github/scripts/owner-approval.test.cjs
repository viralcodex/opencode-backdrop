const test = require("node:test")
const assert = require("node:assert/strict")
const { approvalStatus, reconcile } = require("./owner-approval.cjs")

const owner = { id: 79330197 }
const contributor = { id: 123 }
const pr = { user: contributor, head: { sha: "current" } }
const review = (id, state, user = owner, commit_id = "current") => ({ id, state, user, commit_id })

test("owner-authored PRs need no reviews", () => {
  assert.equal(approvalStatus({ ...pr, user: owner }, []).state, "success")
})

test("other authors require the owner's approval, not a collaborator's", () => {
  assert.equal(approvalStatus(pr, []).state, "failure")
  assert.equal(approvalStatus(pr, [review(1, "APPROVED", contributor)]).state, "failure")
  assert.equal(approvalStatus(pr, [review(1, "APPROVED")]).state, "success")
})

test("approval must cover the current head commit", () => {
  assert.equal(approvalStatus(pr, [review(1, "APPROVED", owner, "old")]).state, "failure")
})

test("dismissal and requested changes revoke approval", () => {
  for (const state of ["DISMISSED", "CHANGES_REQUESTED"]) {
    assert.equal(approvalStatus(pr, [review(1, "APPROVED"), review(2, state)]).state, "failure")
    assert.equal(approvalStatus(pr, [review(3, "APPROVED"), review(2, state)]).state, "success")
  }
})

test("comments do not replace the owner's last review decision", () => {
  assert.equal(approvalStatus(pr, [review(1, "APPROVED"), review(2, "COMMENTED")]).state, "success")
  assert.equal(approvalStatus(pr, [review(1, "COMMENTED")]).state, "failure")
})

test("review lookup failures publish an error instead of preserving success", async () => {
  const published = []
  const github = {
    rest: {
      pulls: {
        list: "list",
        get: async () => ({ data: { ...pr, number: 1, state: "open", base: { ref: "main" } } }),
        listReviews: "reviews",
      },
      repos: { createCommitStatus: async (status) => published.push(status) },
    },
    paginate: async (method) => {
      if (method === "list") return [{ number: 1 }]
      throw new Error("Unavailable")
    },
  }
  await reconcile({
    github,
    context: { repo: { owner: "viralcodex", repo: "opencode-backdrop" }, serverUrl: "https://github.com", runId: 1 },
    core: { info() {}, error() {} },
  })
  assert.equal(published.length, 1)
  assert.equal(published[0].state, "error")
  assert.equal(published[0].sha, "current")
  assert.equal(published[0].context, "Owner approval")
})

test("an owner PR cannot bypass an unapproved PR sharing the same commit", async () => {
  for (const authors of [[owner, contributor], [contributor, owner]]) {
    const published = []
    const pulls = authors.map((user, index) => ({
      ...pr, user, number: index + 1, state: "open", base: { ref: "main" },
    }))
    const github = {
      rest: {
        pulls: {
          list: "list",
          get: async ({ pull_number }) => ({ data: pulls[pull_number - 1] }),
          listReviews: "reviews",
        },
        repos: { createCommitStatus: async (status) => published.push(status) },
      },
      paginate: async (method) => method === "list" ? pulls : [],
    }
    await reconcile({
      github,
      context: { repo: { owner: "viralcodex", repo: "opencode-backdrop" }, serverUrl: "https://github.com", runId: 1 },
      core: { info() {}, error() {} },
    })
    assert.equal(published.length, 1)
    assert.equal(published[0].state, "failure")
  }
})
