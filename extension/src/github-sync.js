import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { ensureFolder, mirrorPlaylist } from "./bookmarks.js";
import { fetchGitHubLists } from "./github.js";
import { refreshGitHubToken } from "./github-auth.js";
import { GITHUB_OAUTH_CLIENT_ID } from "./github-config.js";

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function validGitHubToken(settings) {
  if (!settings.githubToken) throw new Error("Connect GitHub in Settings before syncing Lists.");
  if (!settings.githubTokenExpiresAt || Number(settings.githubTokenExpiresAt) > Date.now() + 60_000) return settings.githubToken;
  if (settings.githubRefreshTokenExpiresAt && Number(settings.githubRefreshTokenExpiresAt) <= Date.now()) {
    throw new Error("GitHub authorization expired. Connect GitHub again.");
  }
  const credentials = await refreshGitHubToken(settings.githubRefreshToken, GITHUB_OAUTH_CLIENT_ID);
  await chrome.storage.local.set({
    githubToken: credentials.accessToken,
    githubRefreshToken: credentials.refreshToken,
    githubTokenExpiresAt: credentials.expiresAt,
    githubRefreshTokenExpiresAt: credentials.refreshTokenExpiresAt
  });
  return credentials.accessToken;
}

export async function syncGitHubLists() {
  const settings = await getSettings();
  if (!settings.githubRootFolderId) throw new Error("Choose a GitHub project destination folder in Settings before syncing.");
  const source = await fetchGitHubLists(await validGitHubToken(settings));
  const result = { ok: [], failed: [], created: 0, updated: 0, removed: 0, at: new Date().toISOString() };
  const nextFolders = { ...settings.githubListFolderIds };
  const nextManaged = { ...settings.githubManagedBookmarks };
  const containerFolderId = await ensureFolder(
    settings.githubRootFolderId,
    settings.githubContainerName,
    settings.githubContainerId
  );

  for (const list of source.lists) {
    try {
      const mirrored = await mirrorPlaylist({
        rootFolderId: containerFolderId,
        playlist: { id: list.id, title: list.title, videos: list.repositories },
        folderId: nextFolders[list.id],
        managed: nextManaged[list.id]
      });
      nextFolders[list.id] = mirrored.folderId;
      nextManaged[list.id] = mirrored.managed;
      result.created += mirrored.created;
      result.updated += mirrored.updated;
      result.removed += mirrored.removed;
      result.ok.push({ id: list.id, title: list.title, repositories: list.repositories.length });
    } catch (error) {
      result.failed.push({ id: list.id, title: list.title, error: error.message });
    }
  }
  result.success = result.failed.length === 0;
  await chrome.storage.local.set({
    githubContainerId: containerFolderId,
    githubAccountLogin: source.login,
    githubListFolderIds: nextFolders,
    githubManagedBookmarks: nextManaged,
    githubLastSync: result.at,
    githubLastResult: result
  });
  if (!result.success) throw new Error(result.failed.map((item) => `${item.title}: ${item.error}`).join(" "));
  return result;
}
