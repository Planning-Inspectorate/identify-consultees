# Agent guidance

## GitHub and pull request practices (PINS)

PINS expects specific GitHub practices on their repos. Follow these for every PR in this project (and when preparing a branch for review).

### Requirements

| Requirement                    | What it means here                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear history                 | Prefer a straight line of commits on the PR branch (rebase onto `main`; avoid merge commits from `main` into the feature branch).                                                       |
| Squashed commits before review | Before requesting or refreshing review, squash noisy WIP / fixup commits so the PR presents a clean, reviewable history (often one commit per logical change, or a small coherent set). |
| Semantic commit messages       | Use Conventional Commits-style subjects, e.g. `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `ci:`. Imperative mood; explain the why in the body when needed.       |

Do not open or hand over a PR for review with a messy stack of “wip”, “fix typo”, or merge-from-main commits. Clean the history first.

### Cleaning history before review

When the feature branch has diverged or accumulated noise:

1. Update local `main`: `git fetch origin` then ensure `main` is current.
2. Rebase the feature branch onto `main` and squash/fix commits with an interactive rebase, e.g. `git rebase -i main` (mark commits as `pick` / `squash` / `fixup` / `reword` as needed).
3. Resolve any conflicts, finish the rebase, then update the remote feature branch with `git push --force-with-lease` (never plain `--force` unless explicitly required and understood).

`git rebase -i main` + `git push --force-with-lease` is the expected combination for fixing PR history after a rebase or squash. Agents must be able to use both when preparing or repairing a PR branch.

**Non-interactive squash alternative** (when interactive rebase is unavailable in the environment): soft-reset to the merge-base with `main`, then create one (or a few) semantic commit(s), then `git push --force-with-lease`. Prefer that over leaving WIP history on a review-ready PR.

### Agent rules for PRs

- Before creating or updating a PR for review: rebase onto latest `main`, squash to a clean history, ensure commit messages are semantic, then push with `--force-with-lease` if history was rewritten.
- Prefer rebasing the feature branch onto `main` over merging `main` into the feature branch.
- `--force-with-lease` is allowed on feature / PR branches only, and only after an intentional history rewrite (rebase/squash).
- Still never force-push `main` (or `master`).
- Still only commit / push / open PRs when the user asks (or existing user rules already authorize that step); when they do, apply the practices above.
- Do not identify as an AI (or name a model/product) in any GitHub-visible surface: PR titles/bodies, commit messages, code comments, docs, issue comments, review comments, or other repo content. Write as a normal human contributor.

### PR description checklist

When opening a PR with `gh pr create` (user-requested):

- [ ] Branch is based on current `main` with linear, squashed history.
- [ ] Commit subjects are semantic (`feat:` / `fix:` / `docs:` / …).
- [ ] Summary explains the change or outcome; test plan is concrete.
- [ ] No secrets, `.env`, or production data dumps in the diff.
- [ ] No AI self-identification in the PR description, commits, or diff.
