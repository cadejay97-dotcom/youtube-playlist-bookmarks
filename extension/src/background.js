import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { ensureFolder, mirrorPlaylist } from "./bookmarks.js";
import { fetchPlaylist } from "./youtube.js";
import { syncGitHubLists } from "./github-sync.js";

const ALARM_NAME = "playlist-bookmark-sync";

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function scheduleSync(interval) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(1, Number(interval) || 1) });
}

export async function syncAll() {
  const settings = await getSettings();
  if (!settings.rootFolderId) throw new Error("Choose a destination bookmark folder in Settings before syncing.");
  const result = { ok: [], failed: [], created: 0, updated: 0, removed: 0, at: new Date().toISOString() };
  const nextFolders = { ...settings.playlistFolderIds };
  const nextManaged = { ...settings.managedBookmarks };
  const containerFolderId = await ensureFolder(
    settings.rootFolderId,
    settings.playlistContainerName,
    settings.playlistContainerId
  );

  for (const playlist of settings.playlists) {
    try {
      const fetched = await fetchPlaylist(playlist);
      const mirrored = await mirrorPlaylist({
        rootFolderId: containerFolderId,
        playlist: fetched,
        folderId: nextFolders[playlist.id],
        managed: nextManaged[playlist.id]
      });
      nextFolders[playlist.id] = mirrored.folderId;
      nextManaged[playlist.id] = mirrored.managed;
      result.created += mirrored.created;
      result.updated += mirrored.updated;
      result.removed += mirrored.removed;
      result.ok.push({ id: playlist.id, title: fetched.title, videos: fetched.videos.length });
    } catch (error) {
      result.failed.push({ id: playlist.id, title: playlist.title, error: error.message });
    }
  }
  result.success = result.ok.length > 0 && result.failed.length === 0;
  await chrome.storage.local.set({
    playlistFolderIds: nextFolders,
    playlistContainerId: containerFolderId,
    managedBookmarks: nextManaged,
    lastSync: result.at,
    lastResult: result
  });
  if (!result.ok.length) throw new Error(result.failed.map((item) => `${item.title}: ${item.error}`).join(" "));
  return result;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get();
  if (!stored.playlists) await chrome.storage.local.set(DEFAULT_SETTINGS);
  await scheduleSync(stored.syncIntervalMinutes || DEFAULT_SETTINGS.syncIntervalMinutes);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.syncIntervalMinutes) scheduleSync(changes.syncIntervalMinutes.newValue);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  getSettings().then((settings) => {
    if (settings.rootFolderId) syncAll().catch(() => undefined);
    if (settings.githubRootFolderId && settings.githubToken) syncGitHubLists().catch(() => undefined);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "sync-now" || message.type === "youtube-sync-now") {
    syncAll().then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-sync-now") {
    syncGitHubLists().then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
});
