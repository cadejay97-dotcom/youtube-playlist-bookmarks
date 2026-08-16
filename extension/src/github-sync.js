import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { archiveManagedFolder, ensureFolder, mirrorPlaylist } from "./bookmarks.js";
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
    await chrome.storage.local.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, githubRefreshTokenExpiresAt: null, githubAccountLogin: null, githubAuthState: "reauth_required" });
    throw new Error("GitHub authorization expired. Connect GitHub again.");
  }
  let credentials;
  try {
    credentials = await refreshGitHubToken(settings.githubRefreshToken, GITHUB_OAUTH_CLIENT_ID);
  } catch (error) {
    if (!settings.githubRefreshToken || error?.retryable !== true) {
      await chrome.storage.local.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, githubRefreshTokenExpiresAt: null, githubAccountLogin: null, githubAuthState: "reauth_required" });
      throw new Error("GitHub authorization expired. Connect GitHub again.");
    }
    throw error;
  }
  await chrome.storage.local.set({
    githubToken: credentials.accessToken,
    githubRefreshToken: credentials.refreshToken,
    githubTokenExpiresAt: credentials.expiresAt,
    githubRefreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
    githubAuthState: "connected"
  });
  return credentials.accessToken;
}

export async function syncGitHubLists() {
  const settings = await getSettings();
  if (!settings.githubRootFolderId) throw new Error("Choose a GitHub project destination folder in Settings before syncing.");
  const source = await fetchGitHubLists(await validGitHubToken(settings));
  const lists = settings.githubIncludePrivateLists ? source.lists : source.lists.filter((list) => !list.isPrivate);
  const result = { ok: [], failed: [], created: 0, updated: 0, removed: 0, skippedPrivate: source.lists.length - lists.length, at: new Date().toISOString() };
  const nextFolders = { ...settings.githubListFolderIds };
  const nextManaged = { ...settings.githubManagedBookmarks };
  const containerFolderId = await ensureFolder(
    settings.githubRootFolderId,
    settings.githubContainerName,
    settings.githubContainerId
  );

  for (const list of lists) {
    try {
      const mirrored = await mirrorPlaylist({
        rootFolderId: containerFolderId,
        playlist: { id: list.id, title: list.title, videos: list.repositories },
        folderId: nextFolders[list.id],
        managed: nextManaged[list.id],
        onProgress: async (checkpoint) => {
          nextFolders[list.id] = checkpoint.folderId;
          nextManaged[list.id] = checkpoint.managed;
          await chrome.storage.local.set({
            githubListFolderIds: { ...nextFolders },
            githubManagedBookmarks: { ...nextManaged }
          });
        }
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
  const currentListIds = new Set(lists.map((list) => list.id));
  for (const staleId of Object.keys(nextFolders)) {
    if (currentListIds.has(staleId)) continue;
    const archived = await archiveManagedFolder(nextFolders[staleId], nextManaged[staleId]);
    result.removed += archived.removed;
    delete nextFolders[staleId];
    delete nextManaged[staleId];
    await chrome.storage.local.set({
      githubListFolderIds: { ...nextFolders },
      githubManagedBookmarks: { ...nextManaged }
    });
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
  if (!result.ok.length && result.failed.length) throw new Error(result.failed.map((item) => `${item.title}: ${item.error}`).join(" "));
  return result;
}
