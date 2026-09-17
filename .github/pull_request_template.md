Closes #<issue>

## What changed

<!-- A short, concrete list. Name the packages and the files that carry the behaviour. -->

## Why

<!-- The problem this solves. Link the acceptance criteria you are satisfying. -->

## TDD evidence

<!-- Required for feature and fix issues. Paste the real command output. -->

RED:

```text
pnpm --filter <package> test   → 1 failed: "<the failing test name>"
```

GREEN:

```text
pnpm --filter <package> test   → 33 passed (33)
```

## Tests

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm e2e` (if the change touches the desktop app)

## Risk

<!-- What could this break? What did you check that gives you confidence it does not? -->

## Screenshots / Demo

<!-- For UI changes. For domain changes, describe what a reviewer can run to see the behaviour. -->

## Checklist

- [ ] Scope matches the issue — nothing extra was folded in
- [ ] Tests were added for the new behaviour and the new error paths
- [ ] No secrets, tokens or credentials
- [ ] No unrelated refactor
- [ ] No debug logs, scratch files or generated notes
- [ ] No new dependency without an explanation above
- [ ] Docs updated if behaviour or architecture changed
- [ ] An independent reviewer has approved
