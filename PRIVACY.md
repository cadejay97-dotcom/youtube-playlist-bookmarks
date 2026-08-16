# Privacy Policy

Last updated: August 16, 2026. Version 1.1.1.

Playlist & GitHub Bookmarks works inside the user's Chrome profile. It has no backend, analytics, advertising, tracking, or external data store.

## Data the extension reads

- YouTube playlist pages selected by the user.
- Chrome bookmarks, only to let the user choose destinations and maintain extension-managed bookmarks below them.
- GitHub Lists and the repository names and URLs they contain, only after the user completes GitHub authorization.

## Data stored locally

Trusted Chrome extension-local storage holds destination bookmark-folder IDs, YouTube playlist configuration, GitHub access and refresh tokens, token expiry times, GitHub account login, IDs of bookmarks created by the extension, and sync summaries.

The GitHub access token stays in the local Chrome profile. It is sent only to GitHub's OAuth and API endpoints. Clicking **Forget on this device** deletes it from local extension storage, but does not revoke the GitHub OAuth grant or delete existing bookmarks. Revoke the grant separately in GitHub's Authorized OAuth Apps settings. The extension never asks for or stores a GitHub password, personal access token, or OAuth client secret.

## Data sharing

No data is sent to any service operated by this project. Requests go only to YouTube for the configured playlist pages and to GitHub for the GitHub authorization and Lists requested by the user.

## Private content

Private YouTube playlists require a YouTube session in the same Chrome profile. Their titles and video links become ordinary Chrome bookmarks and may be copied to other signed-in devices by Chrome Sync; Settings displays this warning beside the YouTube destination. Private GitHub Lists are excluded by default and require explicit opt-in with the same Chrome Sync warning.

## Contact

Open an issue in this repository for privacy questions or requests.
