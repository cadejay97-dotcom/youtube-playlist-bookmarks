# Playlist & GitHub Bookmarks

A Manifest V3 Chrome extension that mirrors two independent sources into Chrome bookmarks:

- **YouTube playlists**: destination folder -> `播放清单` -> playlist -> video bookmarks.
- **GitHub Lists**: destination folder -> `项目清单` -> GitHub List -> repository bookmarks.

The two sources have different settings, destination folders, connection states, sync results, and managed-bookmark records. Configuring or syncing one never changes the other.

## Start Here

1. Clone this repository or download its source.
2. Run `npm run validate`.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the repository's `extension` directory, not the ZIP artifact.
5. Open the extension and use the settings button to configure YouTube, GitHub, or both.

After changing extension source code, return to `chrome://extensions` and press its reload icon before testing.

## YouTube Playlists

Choose a bookmark folder in Settings, add or remove playlist rows, save, and run **Sync YouTube**. Each row accepts a YouTube playlist URL or a playlist ID beginning with `PL`.

The bundled playlists are examples only. Every user can supply a different destination and different playlists.

YouTube has no browser event for playlist updates. The extension checks on the configured 1, 5, 15, 30, or 60 minute interval while Chrome is open; **Sync YouTube** provides an immediate check. Private playlists require the user to be signed into YouTube in the same Chrome profile.

## GitHub Lists

GitHub Lists is GitHub's collection feature for starred repositories. This extension reads every List visible to the connected GitHub account using GitHub's GraphQL API, then creates this structure under the independently selected GitHub destination:

```text
Chosen GitHub bookmark folder
└── 项目清单
    ├── GitHub List A
    │   ├── owner/repository-one
    │   └── owner/repository-two
    └── GitHub List B
        └── owner/repository-three
```

Repository bookmarks retain GitHub's `owner/repository` name and repository URL. Later syncs add, update, reorder, and remove only the extension-managed repository bookmarks; manually added bookmarks are not deleted.

### Connect GitHub

GitHub Lists must be authorized by GitHub. A Google identity alone cannot grant access to GitHub Lists, so the supported connection is **GitHub Device Flow**.

1. Create a GitHub OAuth App in [GitHub Developer Settings](https://github.com/settings/developers). Enable **Device Flow** for the app.
2. Copy the app's **Client ID**. Do not copy or store its client secret in this extension.
3. In extension Settings, paste the Client ID under **GitHub Lists**, then click **Connect GitHub**.
4. A GitHub page opens. Enter the displayed one-time code, authorize the app, then return to Settings.
5. Choose a separate **GitHub project bookmark folder**, click **Save settings**, and click **Sync GitHub Lists**.

The authorization asks GitHub for the `user` scope, which GitHub requires to read Lists. The resulting token remains only in local extension storage. **Disconnect** deletes the local token without removing bookmarks already synchronized.

## Configure With An Agent

When a user gives this repository to an agent, the agent should:

1. Read this README, [PRIVACY.md](PRIVACY.md), and `extension/manifest.json`; explain bookmark, storage, alarm, YouTube, and GitHub permissions before installation.
2. Ask separately whether the user wants YouTube, GitHub, or both.
3. For YouTube, ask for the destination folder, playlist names, playlist URLs or IDs, interval, and whether private playlists are expected.
4. For GitHub, ask for the destination folder and confirm that the user wants to connect their GitHub account. Explain the OAuth App Client ID setup; never request a GitHub password, personal access token, or OAuth client secret.
5. Guide the user through loading `extension` at `chrome://extensions`. Chrome may restrict agents from operating that internal page, so let the user click there when required.
6. Save the independent settings, run the first sync for each selected source, and verify the corresponding container and child folders in the bookmark bar.

## Development

```bash
npm test
npm run validate
npm run package
```

`npm run package` writes `outputs/youtube-playlist-bookmarks.zip`, ready for a Chrome Web Store upload.

## Chrome Web Store Release

1. Create a developer account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Upload `outputs/youtube-playlist-bookmarks.zip`.
3. Add screenshots and a public link to [PRIVACY.md](PRIVACY.md).
4. Explain host permissions: YouTube pages are read to mirror configured playlists; GitHub and GitHub API are used only after the user chooses to connect GitHub Lists.

## License

MIT. See [LICENSE](LICENSE).
