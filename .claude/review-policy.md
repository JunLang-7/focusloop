# FocusLoop review policy

Every pull request gets an independent review before it can merge. The reviewer reads the issue, the
diff, the tests, the architecture rules and CI. It does **not** rely on the author's reasoning.

## Scope of the review

Review exactly these things:

1. **Scope correctness** — does the diff do the issue, and only the issue?
2. **Acceptance criteria** — is each one demonstrably met?
3. **TDD evidence** — is there a real RED, and a real GREEN?
4. **Test coverage** — are the new behaviours and the new error paths tested?
5. **Type safety** — no `any`, no non-null assertions papering over a real hole, no unchecked casts
   at a boundary that has one anyway.
6. **Electron security boundary** — the renderer stays isolated; the IPC surface stays a closed
   whitelist; every argument is re-validated in the main process.
7. **Local-first and privacy boundary** — no new network call, no new collection, no new permission
   without an explicit decision recorded in the issue.
8. **State and event correctness** — is the state machine still pure and deterministic? Is the
   event vocabulary still closed?
9. **Error handling** — what happens on failure? Is a failure silently swallowed?
10. **Race and duplicate events** — can the same event be applied twice? Can two ticks collide?
11. **Persistence integrity** — migrations append-only? Round-trips lossless? Transactions where
    they are needed?
12. **Unnecessary dependencies** — is each new dependency justified, and is it the smallest one?
13. **UI regressions** — screen count stays at five; no new top-level page.
14. **Documentation drift** — does the documentation still describe what the code does?
15. **Debug and AI scaffolding** — prompts, scratch notes, debug logs, commented-out code,
    unexplained `TODO`/`FIXME`, generated boilerplate.

## How to report a finding

Give the file, the symbol or line, the problem, the impact, and the **minimal** fix. Prefer the
smallest change that removes the risk over a redesign.

## Classification

- **BLOCKING** — must be fixed before merge. Includes: wrong behaviour, a missing or weakened test,
  a security or privacy boundary crossed, a broken acceptance criterion, a failing pipeline,
  undefined behaviour on an error path, scope creep into another issue.
- **NON-BLOCKING** — worth doing, but not a reason to hold the pull request. Includes: naming,
  comments, minor duplication, a nice-to-have test, a follow-up worth its own issue.

A NON-BLOCKING item that is really a missing acceptance criterion is not non-blocking. Downgrading a
finding to make a merge happen is the failure mode this policy exists to prevent.

## Things that are always BLOCKING here

- Any change that would let the renderer reach Node.
- Any new outbound network call that is not behind the provider adapter and off by default.
- Any case where the network becomes required for the golden path.
- Any addition to the extension's permission set or content scripts.
- Deleting or weakening a test to make a change pass.
- A native module that would need a per-runtime rebuild.
- Introducing a cloud service, a database server or an account system without its own issue.
- Merging with a red `lint`, `typecheck`, `test` or `build`.

## Verdict

Reply with the findings, then one of these two words, alone on the final line:

```text
APPROVE
```

```text
REQUEST CHANGES
```

## After the review

Blocking findings become minimal fixes on the same branch. The author re-runs the required commands
and posts the new evidence. The reviewer re-reviews the changed hunks, not the whole pull request.
Only then does CI run for the merge.
