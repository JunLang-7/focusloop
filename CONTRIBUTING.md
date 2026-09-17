# Contributing to FocusLoop

Thanks for reading this before opening a pull request. The rules below are what keeps this project
reviewable and the demo trustworthy.

## The loop

```text
Issue → Branch → RED → GREEN → REFACTOR → Commit → PR → independent review → CI → Merge
```

Everything follows from that. Concretely:

1. **One issue at a time.** Never mix two issues in one branch or one PR.
2. **Never push to `main`.** Every change arrives through a pull request.
3. **A branch belongs to one issue** and must contain the issue number.
4. **Feature work is TDD.** Write the failing test first, prove it fails, then make it pass.
5. **An independent review precedes every merge.** The reviewer reads the diff, not the author's
   reasoning.
6. **Nothing merges with a red pipeline.** `lint`, `typecheck`, `test` and `build` must all pass.
7. **`main` stays releasable** after every merge.

## Branches

```text
feat/12-learning-checkpoint
fix/31-resume-latency-rounding
test/27-golden-path-e2e
chore/4-ci-quality-gates
docs/31-readme-privacy-section
```

The number is the issue. `main` is protected.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), scoped by package or area:

```text
feat(state): detect interruption after the tab-left threshold
fix(resume): do not offer a card that was already dismissed
test(continuity): cover checkpoint determinism
refactor(policy): extract the action priority table
chore(ci): add the windows packaging job
docs(privacy): describe the bridge token
```

`update`, `final`, `misc`, `wip`, `claude changes` and similar are rejected in review.

## TDD

Feature issues must show both halves of the loop in the pull request:

```text
RED:   pnpm --filter @focusloop/continuity test   → 1 failing: "marks a concept mastered…"
GREEN: pnpm --filter @focusloop/continuity test   → 33 passed (33)
```

Documentation, CI and packaging changes may skip strict TDD, but they must include a verification
command or a smoke check that a reviewer can run.

Rules that have no exceptions:

- Never weaken or delete a test to make a change pass.
- Never hide a failing test.
- Never use `any` to silence the type checker without saying why in the PR.
- Never hard-code secrets, tokens or API keys.
- Never leave prompts, debug logs, generated notes or unexplained `TODO`/`FIXME` behind.
- Never fold an unrelated refactor into a feature issue.
- Update documentation whenever behaviour or architecture changes.

## Definition of Done

- [ ] Acceptance criteria in the issue are all met
- [ ] New behaviour has tests
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass
- [ ] No unexplained `TODO`/`FIXME`
- [ ] An independent reviewer approved
- [ ] CI is green
- [ ] Documentation is in sync

## Review policy

The reviewer checklist lives in [`.claude/review-policy.md`](.claude/review-policy.md). Findings are
classified **BLOCKING** or **NON-BLOCKING**, and the verdict is exactly `APPROVE` or
`REQUEST CHANGES`.

## Local commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e                     # requires a desktop build first
node scripts/verify-no-scaffolding.mjs
```

Formatting is Prettier's job: `pnpm format` before you push.

## Scope discipline

FocusLoop v0.1 stays small on purpose. New cloud infrastructure, new always-on sensors, new
top-level screens or a new required dependency each need their own issue and an explicit decision —
they are not part of a feature branch.
