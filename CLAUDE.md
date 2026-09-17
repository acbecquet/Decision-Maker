# DecisionMaker (N:\decision-maker)

A small web app that helps a group make a decision without anyone stepping on anyone's toes.
A host creates an event with options and shares one link.
Participants rank the options, set a private budget limit, and write an opinion.
A language model rewrites every opinion to strip out who wrote it, then produces a report with the best option, runner-up, worst, unexpected option, charts, and anonymized themes.

GitHub remote: https://github.com/acbecquet/Decision-Maker (public, so never commit keys, real events, or personal data).

## Source of truth

- `docs/superpowers/specs/2026-09-17-decision-maker-design.md` is the approved design.
  Every product or architecture question is answered there first.
- Per-phase implementation plans live under `docs/superpowers/plans/`.

## Non-negotiables from the design

- The host never sees a link between a name and a choice, and never sees opinion text.
- Per-option numbers appear only after the roster is final, and closing is final.
- Raw rankings and opinions are purged on publish.
- Cost counts below three and any breakdown below five approved responses are never displayed.
- Provider keys live in the host's browser and are never written to the database or logs.
- Cost-tagged anonymized points are never used as report quotes.

## Coding and build philosophy

- Harness first: the Playwright end-to-end suite with the fake provider is the definition of working.
  Never claim a feature works without a green run.
- Think before coding, simplest thing that works, surgical changes, verifiable success criteria.
- Prefer quality, simplicity, robustness, and long-term maintainability over development cost.
- Fix lint, test failures, and flakiness when you see them, even if unrelated to the current task.

## Writing rules

- Never use the em dash; use a plain dash.
- In long markdown files, put each full sentence on its own line.
- Commit messages carry no agent co-author line.
