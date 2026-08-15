# YouTube Playlist Bookmarks

Mirror any set of YouTube playlists into a Chrome bookmark folder. The extension creates one folder per playlist and keeps its video bookmarks in sync with YouTube.

This repository is a reusable starting point, not a configuration for one person. The bundled playlists are examples; remove, replace, or add to them in Settings.

## What It Does

- Lets each user choose a Chrome bookmark folder as the destination.
- Creates a `播放清单` (Playlists) folder below that destination, then one folder for every selected playlist.
- Creates, updates, removes, and orders only the bookmarks managed by the extension. It does not delete manually added bookmarks.
- Checks YouTube every minute by default, with 5, 15, 30, and 60 minute options plus a **Sync now** action.
- Reads playlists from YouTube in the same Chrome profile. No server, analytics, or external account is involved.

## Start Here

### For People

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
3. Select this repository's `extension` directory, not the ZIP file.
4. Open **YouTube Playlist Bookmarks** and use the gear icon to open **Settings**.
5. Choose the bookmark folder where playlist folders should live, configure playlists, click **Save settings**, then click **Sync now**.

The first successful sync creates this shape:

```text
Chosen bookmark folder
└── 播放清单
    ├── Playlist A
    │   ├── Video 1
    │   └── Video 2
    └── Playlist B
        └── Video 1
```

### For Agents

When a user provides this repository and asks for help deploying it, guide them through the following workflow:

1. Read this README, [PRIVACY.md](PRIVACY.md), and `extension/manifest.json`; explain the requested Chrome permissions before installation.
2. Ask the configuration questions in [Personalize Playlists](#personalize-playlists). Do not assume the example playlists are wanted.
3. Run `npm run validate` before installation. Use `npm run package` only when a ZIP artifact is needed.
4. Guide the user to load the `extension` directory through Chrome's `chrome://extensions` page. Chrome may restrict agents from operating that internal page, so let the user perform those clicks when necessary.
5. In Settings, select the agreed destination folder, enter the playlists, save, and run the first sync.
6. Verify that `播放清单` and every requested playlist folder appear under the selected destination. Open one playlist folder to confirm its video bookmarks.
7. Tell the user that future changes are made in Settings, followed by **Save settings** and **Sync now**; scheduled checks handle later YouTube changes.

## Personalize Playlists

Before configuring the extension, ask the user:

1. Which Chrome bookmark folder should receive the playlist folders? The container folder is currently named `播放清单` (Playlists).
2. Which YouTube playlists should be mirrored? For each one, collect:
   - The desired folder name.
   - A YouTube playlist URL, or the playlist ID beginning with `PL`.
3. Which update interval is appropriate: 1, 5, 15, 30, or 60 minutes?
4. Are any playlists private? If so, the user must stay signed into YouTube in this same Chrome profile.

In **Settings**, each row has a playlist name and a **Playlist URL or ID** field. Click **Add playlist** to create another row and use the `×` button to remove one. A full URL is recommended because it is easy to validate, but a playlist ID also works.

Example configuration:

| Playlist folder name | Playlist URL or ID |
| --- | --- |
| Design inspiration | `https://www.youtube.com/playlist?list=PL...` |
| Interviews | `PL...` |

The six bundled playlists are starter examples only. Keeping them is optional.

## Update Behavior

The extension tracks the bookmarks it creates. On a later sync it adds new videos, updates changed titles and URLs, preserves the YouTube playlist order, and removes videos no longer in the playlist. It leaves bookmarks added manually by the user intact.

YouTube does not offer a browser event for playlist changes. The scheduled check plus **Sync now** is the closest reliable near-real-time behavior. Private playlists need an active YouTube session in the same Chrome profile.

## Develop And Package

```bash
npm test
npm run validate
npm run package
```

`npm run package` creates `outputs/youtube-playlist-bookmarks.zip`, ready for Chrome Web Store upload. After changing extension code, return to `chrome://extensions` and click the extension's reload icon before testing again.

## Publish To GitHub

```bash
git init
git add .
git commit -m "Initial Chrome extension"
gh repo create youtube-playlist-bookmarks --public --source=. --push
```

Choose the final repository name and GitHub account at publish time.

## Chrome Web Store Release

This repository includes a packaged artifact but is not itself a Chrome Web Store listing. To publish it:

1. Create a developer account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Upload `outputs/youtube-playlist-bookmarks.zip`.
3. Add 1280x800 screenshots and a public link to [PRIVACY.md](PRIVACY.md).
4. Explain the YouTube host permission: “Used only to read the YouTube playlist pages selected by the user, then create matching local Chrome bookmarks.”

### Store Listing Copy

**Short description:** Mirror selected YouTube playlists into organized Chrome bookmark folders.

**Privacy:** Playlist metadata is read from YouTube and stored only in Chrome extension storage and Chrome bookmarks. No analytics, accounts, or external servers are used.

## License

MIT. See [LICENSE](LICENSE).
