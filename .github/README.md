# Main branch policy

- All changes to `main` must go through a pull request, including the owner's changes.
- Only @viralcodex can merge. Direct pushes, force pushes, and branch deletion are blocked.
- PRs authored by @viralcodex need no reviews.
- Other PRs require @viralcodex to approve the current head commit. New commits, dismissed approvals, and requested changes block merging.
- The `Owner approval` status is mandatory and has no ruleset bypass.

The privileged approval workflow uses code from `main`, never contributor code. A permissionless review-event workflow wakes it after reviews. A scheduled reconciliation also handles reviews if a fork's event workflow cannot run. GitHub may delay scheduled runs. To refresh immediately, run **Enforce owner approval** from the Actions tab or post a PR comment.

Commit statuses are shared across PRs with the same head commit. All such open PRs must satisfy the policy to prevent one PR from bypassing another's approval requirement.

Accept untrusted contributions from forks without granting repository write access. This policy trusts the GitHub Actions app to publish the approval status. Repository writers can author Actions workflows and must be trusted.

Run the policy tests with `node --test .github/scripts/owner-approval.test.cjs`.
