## Summary

<!-- What does this change do, and why? List the main changes and any deviation from the brief. -->

## Task

<!-- Link the task brief, e.g. [T01 — Foundation](docs/tasks/T01-foundation.md). -->

Task: [Txx — title](docs/tasks/Txx-short-name.md)

## Screenshots (UI)

<!--
For UI changes: dark and light themes, desktop (≥ 1024 px) and mobile (360 px).
Write "No UI change" otherwise.
-->

## Test evidence

<!-- Paste the tail of each command's output. Add coverage if it changed. -->

<details>
<summary><code>npm run check</code></summary>

```text

```

</details>

<details>
<summary><code>npm run e2e</code></summary>

```text

```

</details>

Coverage (statements / branches / functions / lines):

Initial JS (gzip, from `npm run check:size`):

## New dependencies

<!-- One row per new runtime or dev dependency. Write "None" if there are none. -->

| Package | License | Gzip size | Why it is needed |
| ------- | ------- | --------- | ---------------- |
|         |         |           |                  |

## SPEC questions / ambiguities

<!--
Anything in docs/SPEC-finance.md or the brief that was unclear, incomplete or looked wrong,
with section numbers. Financial rules are never decided in code. Write "None" if there are none.
-->

## Checklist

- [ ] `npm run check` passes
- [ ] `npm run e2e` passes (Chromium and WebKit)
- [ ] New behavior is covered by tests; engine changes pass property tests and golden vectors
- [ ] User-facing text is in all four locales (en, zh-CN, ru, uk); no hard-coded strings
- [ ] Accessibility checked in the dark and light themes and at 360 px width
- [ ] SPDX headers present in new source files
- [ ] Docs updated where behavior or architecture changed
- [ ] Completion notes added to the task file
