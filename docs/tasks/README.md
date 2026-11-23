# Task briefs

Each task is a markdown file in this folder named after its ID, for example `t1.3-shot-controls.md`.
Agents and humans pick a task by reading its brief; the brief is the source of truth for scope.

## Format

```markdown
# T<milestone>.<n>: Title

## Goal
One or two sentences: what and why.

## Files
Files or packages to create or change (and ones to leave alone).

## Acceptance criteria
- [ ] Concrete, checkable statements.

## How to test
Exact commands and manual steps to verify each criterion.
```

Branch name: `m<milestone>/<task-id>-short-name`. See `CONTRIBUTING.md`.
