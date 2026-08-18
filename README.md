# Playlist & GitHub Bookmarks

A Manifest V3 Chrome extension that mirrors two independent sources into Chrome bookmarks:

- **YouTube playlists**: destination folder -> `播放清单` -> playlist -> video bookmarks.
- **GitHub Lists**: destination folder -> `项目清单` -> GitHub List -> repository bookmarks.
- **Live Chrome tab groups**: choose any readable YouTube playlist or GitHub List in the popup -> a named tab group containing its current items; YouTube opens inactive with autoplay disabled.

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

1. In extension Settings, click **Connect GitHub**.
2. A GitHub page opens in the already signed-in browser. Enter the displayed one-time code and authorize the extension.
3. Return to Settings, choose a separate **GitHub project bookmark folder**, click **Save settings**, and click **Sync GitHub Lists**.

The authorization asks GitHub for the read-only `read:user` scope used to identify the account and read its Lists. The public OAuth client ID is built into the extension; no client secret is included. GitHub host access is requested only when you click **Connect GitHub**. Access and refresh tokens remain in trusted extension-local storage and are renewed automatically.

Private GitHub Lists are excluded by default. Enabling **Include private GitHub Lists** copies their names and repository links into ordinary Chrome bookmarks, which Chrome Sync may copy to your other signed-in devices. **Forget on this device** deletes local credentials without removing synchronized bookmarks or revoking the OAuth grant; use GitHub's Authorized OAuth Apps settings to revoke the grant itself.

## Tab Groups

The popup also exposes the currently readable YouTube playlists and GitHub Lists under **Open as tab groups**. Each row shows the number of current items:

1. Click **Open group** for a playlist or List.
2. The extension opens each video or repository URL in a new Chrome tab group named after that list.
3. Click **Close group** on the same row to close that group's tabs and clear its saved selection.

YouTube tabs are created in the background with `autoplay=0`; opening a playlist does not start every video. Select an individual YouTube tab and press play when you want to watch it.

Open groups are stored separately from bookmark state. During the existing automatic sync interval, the extension rereads every open playlist/List and converges only the tabs it created: new items are opened, changed URLs are updated, and removed items are closed. Manually opened tabs are not removed during refresh, but closing a selected group closes all tabs currently inside that Chrome group. If a source cannot be read temporarily, the current tabs remain open and the next scheduled check retries.

Opening a large playlist or List can create many tabs. Chrome may ask you to allow the extension's `tabGroups` permission when the updated unpacked extension is reloaded.

## Configure With An Agent

When a user gives this repository to an agent, the agent should:

1. Read this README, [PRIVACY.md](PRIVACY.md), and `extension/manifest.json`; explain bookmark, storage, alarm, YouTube, and GitHub permissions before installation.
2. Ask separately whether the user wants YouTube, GitHub, or both.
3. For YouTube, ask for the destination folder, playlist names, playlist URLs or IDs, interval, and whether private playlists are expected.
4. For GitHub, ask for the destination folder and confirm that the user wants to connect their GitHub account. Never request a GitHub password, personal access token, OAuth client ID, or OAuth client secret.
5. Guide the user through loading `extension` at `chrome://extensions`. Chrome may restrict agents from operating that internal page, so let the user click there when required.
6. Save the independent settings, run the first sync for each selected source, and verify the corresponding container and child folders in the bookmark bar.
7. From the popup, open one configured playlist or GitHub List as a tab group, verify its tabs and title, then close it from the same row.

## Development

```bash
npm test
npm run validate
npm run package
```

`npm run package` writes `outputs/youtube-playlist-bookmarks.zip`, ready for a Chrome Web Store upload.

## Continuous Delivery

Every pushed version tag in the form `vX.Y.Z` runs the same validation and packaging checks as CI. The tag must equal the versions in `package.json` and `extension/manifest.json`; a mismatch fails before publication. A successful run creates a [GitHub Release](https://github.com/cadejay97-dotcom/youtube-playlist-bookmarks/releases) and attaches `youtube-playlist-bookmarks.zip`.

To publish a version:

```bash
git switch main
git pull --ff-only
# Update package.json and extension/manifest.json to the same version.
git add package.json extension/manifest.json CHANGELOG.md
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

By default, Chrome Web Store publication is not automatic. Store uploads require a verified developer account, an extension listing, and protected Web Store credentials; upload the ZIP from the GitHub Release through the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/) after reviewing the generated release notes. No store credentials are stored in this repository.

For an explicitly approved store CD, configure a protected GitHub environment named `chrome-web-store`, add the repository variable `ENABLE_CWS_PUBLISH=true`, and add these Actions secrets: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN`. The release workflow then uploads and publishes the tagged ZIP after the environment's required approval. Leave the variable unset to keep store publication manual.

## Chrome Web Store Release

1. Create a developer account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Upload `outputs/youtube-playlist-bookmarks.zip`.
3. Add screenshots and a public link to [PRIVACY.md](PRIVACY.md).
4. Explain host permissions: YouTube pages are read to mirror configured playlists; GitHub and GitHub API are used only after the user chooses to connect GitHub Lists. The `tabGroups` permission lets the extension create, update, and close the groups it manages.

## License

MIT. See [LICENSE](LICENSE).
