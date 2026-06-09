---
"@changesets/changelog-github": major
---

Replace `template`, `autolinkIssues`, and `disableThanks` with `composeReleaseLine`. Point `changelog` at a small local module and compose each line in JS - `pr`, `commit`, `authors[]`, `linkRefs`/`linkHints` helpers, and an optional `separator` override (e.g. for compact output). Default output is unchanged.

Migration: `disableThanks: true` becomes a `composeReleaseLine` callback that omits the `Thanks ...!` segment. See `docs/config-file-options.md`.
