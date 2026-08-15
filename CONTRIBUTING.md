# Contributing

## Local setup

Load the `extension` directory through Chrome's `chrome://extensions` page with Developer mode enabled. Run `npm run validate` before opening a pull request.

## Scope

Keep the extension local-first: no remote service, telemetry, or new data collection without explicit discussion and an update to [PRIVACY.md](PRIVACY.md).

## Pull requests

- Describe the user-visible behavior change.
- Add or update focused tests for parsing or bookmark synchronization behavior.
- Do not add dependencies unless they solve a demonstrated need.
