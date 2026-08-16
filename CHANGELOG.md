# Changelog

## Unreleased

- Replace manual GitHub client-ID setup with a built-in, resumable Device Flow sign-in.
- Add authorization cancellation/race guards, alarm recovery, transient retry handling, and provider sync single-flight behavior.
- Request GitHub host access only when connecting and exclude private GitHub Lists unless explicitly enabled.
- Preserve manual bookmarks when configured sources disappear and verify packaged release contents in CI.

## 1.1.1 - 2026-08-16

- Removed the per-user GitHub OAuth Client ID field.
- Added one-click GitHub connection through the extension's built-in public OAuth client ID.
- Added automatic refresh for expiring GitHub Device Flow tokens.

## 1.0.0 - 2026-08-15

- Initial Manifest V3 Chrome extension.
- Mirrors the six configured YouTube playlists to `WATCH /d → 播放清单`.
- Supports folder selection, manual sync, and one-minute scheduled sync.
