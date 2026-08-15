# YouTube Playlist Bookmarks

A Manifest V3 Chrome extension that mirrors chosen YouTube playlists into a chosen Chrome bookmark folder. Each playlist is a folder; each video in it is a bookmark.

## What it does

- Starts with the six playlists supplied for this project.
- Lets the user choose any Chrome bookmark folder as the destination, including `WATCH /d`.
- Creates the requested hierarchy: `WATCH /d → 播放清单 → playlist → video bookmarks`.
- Checks YouTube every minute by default, with 5, 15, 30 and 60 minute alternatives and a manual **Sync now** action.
- Creates, updates, orders, and removes only bookmarks created by the extension. Manually added bookmarks are never removed.
- Uses the signed-in Chrome YouTube session where required for private playlists. It does not send playlist data to any server.

## Install locally

1. In Chrome, visit `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked**, then select the `extension` directory from this repository.
3. Open the extension, select the destination folder in **Settings**, and click **Sync now**.

The default lists are the six provided playlists, including `Living in the vibe.` and `Podcast in the era.`.

## Develop

```bash
npm test
npm run validate
npm run package
```

`npm run package` creates `outputs/youtube-playlist-bookmarks.zip`, ready for Chrome Web Store upload.

## Publish to GitHub

```bash
git init
git add .
git commit -m "Initial Chrome extension"
gh repo create youtube-playlist-bookmarks --public --source=. --push
```

Choose the final repository name and GitHub account at publish time. The supplied commands do not create a remote repository until they are run.

## Chrome Web Store release

1. Create a developer account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Upload `outputs/youtube-playlist-bookmarks.zip`.
3. Add 1280x800 screenshots, the public GitHub URL for [PRIVACY.md](PRIVACY.md), and the listing copy below.
4. Set the single-site host permission explanation: “Used only to read the YouTube playlist pages selected by the user, then create matching local Chrome bookmarks.”

### Listing copy

**Short description:** Mirror selected YouTube playlists into organized Chrome bookmark folders.

**Privacy:** Playlist metadata is read from YouTube and stored only in Chrome extension storage and Chrome bookmarks. No analytics, accounts, or external servers are used.

## Known constraint

YouTube does not provide a browser extension event when a playlist changes. The closest reliable real-time behavior is the configurable scheduled check plus manual sync. Private playlists require the user to be signed into YouTube in the same Chrome profile.

## License

MIT. See [LICENSE](LICENSE).
