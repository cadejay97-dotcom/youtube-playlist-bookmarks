import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { ensureFolder, mirrorPlaylist } from "./bookmarks.js";
import { fetchPlaylist } from "./youtube.js";
import { syncGitHubLists } from "./github-sync.js";
import { pollGitHubTokenOnce, requestDeviceCode } from "./github-auth.js";
import { fetchGitHubViewer } from "./github.js";
import { GITHUB_OAUTH_CLIENT_ID } from "./github-config.js";

const ALARM_NAME = "playlist-bookmark-sync";
const GITHUB_AUTH_ALARM_NAME = "github-auth-poll";
const GITHUB_AUTH_SESSION_KEY = "githubAuthSession";
let githubAuthStartPromise = null;

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function scheduleSync(interval) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(1, Number(interval) || 1) });
}

function publicGitHubAuth(session) {
  if (!session) return { status: "idle" };
  return {
    status: session.status,
    userCode: session.userCode || null,
    verificationUri: session.verificationUri || null,
    expiresAt: session.expiresAt || null,
    accountLogin: session.accountLogin || null,
    error: session.error || null
  };
}

async function getGitHubAuthSession() {
  const stored = await chrome.storage.session.get(GITHUB_AUTH_SESSION_KEY);
  return stored[GITHUB_AUTH_SESSION_KEY] || null;
}

async function setGitHubAuthSession(session) {
  await chrome.storage.session.set({ [GITHUB_AUTH_SESSION_KEY]: session });
  return publicGitHubAuth(session);
}

async function githubAuthStatus() {
  const session = await getGitHubAuthSession();
  if (session && ["code", "pending", "failed"].includes(session.status)) return publicGitHubAuth(session);
  const account = await chrome.storage.local.get(["githubToken", "githubAccountLogin"]);
  if (account.githubToken && account.githubAccountLogin) {
    return { status: "connected", accountLogin: account.githubAccountLogin };
  }
  return publicGitHubAuth(session);
}

async function startGitHubAuthorization() {
  if (githubAuthStartPromise) return githubAuthStartPromise;
  githubAuthStartPromise = (async () => {
    await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
    const device = await requestDeviceCode(GITHUB_OAUTH_CLIENT_ID);
    const now = Date.now();
    return setGitHubAuthSession({
      status: "code",
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      intervalSeconds: Math.max(5, Number(device.interval) || 5),
      expiresAt: now + ((Number(device.expires_in) || 900) * 1000),
      nextPollAt: null,
      error: null
    });
  })();
  try {
    return await githubAuthStartPromise;
  } finally {
    githubAuthStartPromise = null;
  }
}

async function continueGitHubAuthorization() {
  const session = await getGitHubAuthSession();
  if (!session || !["code", "pending"].includes(session.status)) throw new Error("Start GitHub sign-in again.");
  if (session.expiresAt <= Date.now()) throw new Error("The GitHub code expired. Start GitHub sign-in again.");
  const nextPollAt = Date.now() + (session.intervalSeconds * 1000);
  await setGitHubAuthSession({ ...session, status: "pending", nextPollAt });
  await chrome.tabs.create({ url: session.verificationUri });
  chrome.alarms.create(GITHUB_AUTH_ALARM_NAME, { when: nextPollAt });
  return publicGitHubAuth({ ...session, status: "pending", nextPollAt });
}

async function cancelGitHubAuthorization() {
  await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
  await chrome.storage.session.remove(GITHUB_AUTH_SESSION_KEY);
  return { status: "idle" };
}

async function pollGitHubAuthorization() {
  const session = await getGitHubAuthSession();
  if (!session || session.status !== "pending") return;
  if (session.expiresAt <= Date.now()) {
    await setGitHubAuthSession({ ...session, status: "failed", error: "The GitHub code expired. Start again." });
    return;
  }
  try {
    const result = await pollGitHubTokenOnce(session.deviceCode, GITHUB_OAUTH_CLIENT_ID);
    if (result.status === "authorized") {
      const viewer = await fetchGitHubViewer(result.credentials.accessToken);
      await chrome.storage.local.set({
        githubToken: result.credentials.accessToken,
        githubRefreshToken: result.credentials.refreshToken,
        githubTokenExpiresAt: result.credentials.expiresAt,
        githubRefreshTokenExpiresAt: result.credentials.refreshTokenExpiresAt,
        githubAccountLogin: viewer.login
      });
      await setGitHubAuthSession({ status: "connected", accountLogin: viewer.login, completedAt: Date.now() });
      return;
    }
    const intervalSeconds = result.status === "slow_down"
      ? Math.max(session.intervalSeconds + 5, result.intervalSeconds || 0)
      : session.intervalSeconds;
    const nextPollAt = Date.now() + (intervalSeconds * 1000);
    await setGitHubAuthSession({ ...session, status: "pending", intervalSeconds, nextPollAt });
    chrome.alarms.create(GITHUB_AUTH_ALARM_NAME, { when: nextPollAt });
  } catch (error) {
    await setGitHubAuthSession({ ...session, status: "failed", error: error.message });
  }
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
  if (alarm.name === GITHUB_AUTH_ALARM_NAME) {
    pollGitHubAuthorization();
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  getSettings().then((settings) => {
    if (settings.rootFolderId) syncAll().catch(() => undefined);
    if (settings.githubRootFolderId && settings.githubToken) syncGitHubLists().catch(() => undefined);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === "github-auth-start") {
    startGitHubAuthorization().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-auth-continue") {
    continueGitHubAuthorization().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-auth-cancel") {
    cancelGitHubAuthorization().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-auth-status") {
    githubAuthStatus().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "sync-now" || message.type === "youtube-sync-now") {
    syncAll().then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-sync-now") {
    syncGitHubLists().then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
});
