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
let githubAuthTransition = Promise.resolve();
let githubAuthPollPromise = null;
const providerSyncRuns = { youtube: null, github: null };

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function scheduleSync(interval) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(1, Number(interval) || 1) });
}

export function runProviderSync(provider, trigger, task) {
  if (providerSyncRuns[provider]) return providerSyncRuns[provider];
  const attemptKey = provider === "github" ? "githubLastAttempt" : "lastAttempt";
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  providerSyncRuns[provider] = (async () => {
    await chrome.storage.local.set({ [attemptKey]: { runId, provider, trigger, status: "running", startedAt } });
    try {
      const result = await task();
      await chrome.storage.local.set({
        [attemptKey]: {
          runId,
          provider,
          trigger,
          status: result.success === false ? "partial" : "success",
          startedAt,
          finishedAt: new Date().toISOString()
        }
      });
      return result;
    } catch (error) {
      await chrome.storage.local.set({
        [attemptKey]: {
          runId,
          provider,
          trigger,
          status: "failed",
          error: error.message,
          startedAt,
          finishedAt: new Date().toISOString()
        }
      });
      throw error;
    }
  })().finally(() => {
    providerSyncRuns[provider] = null;
  });
  return providerSyncRuns[provider];
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

function runGitHubAuthTransition(task) {
  const next = githubAuthTransition.then(task, task);
  githubAuthTransition = next.catch(() => undefined);
  return next;
}

async function activeGitHubAuthAttempt(attemptId, statuses = ["pending"]) {
  const session = await getGitHubAuthSession();
  return session?.attemptId === attemptId && statuses.includes(session.status) ? session : null;
}

async function scheduleGitHubAuthAlarm(when) {
  chrome.alarms.create(GITHUB_AUTH_ALARM_NAME, { when });
  const alarm = await chrome.alarms.get(GITHUB_AUTH_ALARM_NAME);
  if (!alarm) throw new Error("Chrome could not schedule GitHub sign-in. Start again.");
  return alarm;
}

async function recoverGitHubAuthorization() {
  return runGitHubAuthTransition(async () => {
    const session = await getGitHubAuthSession();
    if (!session || session.status !== "pending") return session;
    if (session.expiresAt <= Date.now()) {
      await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
      return setGitHubAuthSession({ status: "failed", attemptId: session.attemptId, error: "The GitHub code expired. Start again." });
    }
    const alarm = await chrome.alarms.get(GITHUB_AUTH_ALARM_NAME);
    if (!alarm || Number(alarm.scheduledTime) < Date.now() - 5_000) {
      const nextPollAt = Math.max(Date.now() + 1_000, Number(session.nextPollAt) || 0);
      await scheduleGitHubAuthAlarm(nextPollAt);
      return setGitHubAuthSession({ ...session, nextPollAt });
    }
    return session;
  });
}

async function githubAuthStatus() {
  let session = await getGitHubAuthSession();
  if (session?.status === "pending") session = await recoverGitHubAuthorization();
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
    const attemptId = crypto.randomUUID();
    await runGitHubAuthTransition(async () => {
      await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
      await setGitHubAuthSession({ status: "requesting", attemptId });
    });
    const device = await requestDeviceCode(GITHUB_OAUTH_CLIENT_ID);
    const now = Date.now();
    return runGitHubAuthTransition(async () => {
      const active = await activeGitHubAuthAttempt(attemptId, ["requesting"]);
      if (!active) throw new Error("GitHub sign-in was canceled or replaced.");
      return setGitHubAuthSession({
        status: "code",
        attemptId,
        deviceCode: device.device_code,
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        intervalSeconds: Math.max(5, Number(device.interval) || 5),
        expiresAt: now + ((Number(device.expires_in) || 900) * 1000),
        nextPollAt: null,
        error: null
      });
    });
  })();
  try {
    return await githubAuthStartPromise;
  } finally {
    githubAuthStartPromise = null;
  }
}

async function continueGitHubAuthorization() {
  let shouldOpenTab = false;
  const pendingSession = await runGitHubAuthTransition(async () => {
    const session = await getGitHubAuthSession();
    if (!session || !["code", "pending"].includes(session.status)) throw new Error("Start GitHub sign-in again.");
    if (session.expiresAt <= Date.now()) throw new Error("The GitHub code expired. Start GitHub sign-in again.");
    if (session.status === "pending" && (session.tabOpening || session.tabOpened)) return session;
    shouldOpenTab = true;
    const nextPollAt = Date.now() + (session.intervalSeconds * 1000);
    const pending = { ...session, status: "pending", nextPollAt, tabOpening: true, tabOpened: false };
    await setGitHubAuthSession(pending);
    await scheduleGitHubAuthAlarm(nextPollAt);
    return pending;
  });
  if (!shouldOpenTab) return publicGitHubAuth(pendingSession);
  try {
    await chrome.tabs.create({ url: pendingSession.verificationUri });
  } catch (error) {
    await runGitHubAuthTransition(async () => {
      const active = await activeGitHubAuthAttempt(pendingSession.attemptId, ["pending"]);
      if (!active) return;
      await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
      await setGitHubAuthSession({ ...active, status: "code", nextPollAt: null, tabOpening: false, tabOpened: false });
    });
    throw error;
  }
  return runGitHubAuthTransition(async () => {
    const active = await activeGitHubAuthAttempt(pendingSession.attemptId, ["pending"]);
    if (!active) return publicGitHubAuth(await getGitHubAuthSession());
    return setGitHubAuthSession({ ...active, tabOpening: false, tabOpened: true });
  });
}

async function cancelGitHubAuthorization() {
  return runGitHubAuthTransition(async () => {
    const session = await getGitHubAuthSession();
    await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
    await chrome.storage.session.remove(GITHUB_AUTH_SESSION_KEY);
    if (session?.attemptId) {
      const stored = await chrome.storage.local.get(["githubAuthAttemptId"]);
      if (stored.githubAuthAttemptId === session.attemptId) {
        await chrome.storage.local.set({
          githubToken: null,
          githubRefreshToken: null,
          githubTokenExpiresAt: null,
          githubRefreshTokenExpiresAt: null,
          githubAccountLogin: null,
          githubAuthAttemptId: null
        });
      }
    }
    return githubAuthStatus();
  });
}

async function disconnectGitHub() {
  return runGitHubAuthTransition(async () => {
    await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
    await chrome.storage.session.remove(GITHUB_AUTH_SESSION_KEY);
    await chrome.storage.local.set({
      githubToken: null,
      githubRefreshToken: null,
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAuthAttemptId: null,
      githubLastResult: null,
      githubLastSync: null
    });
    return { status: "idle" };
  });
}

async function pollGitHubAuthorizationRun() {
  const session = await runGitHubAuthTransition(async () => {
    const active = await getGitHubAuthSession();
    if (!active || active.status !== "pending") return null;
    const pollLeaseUntil = Date.now() + 30_000;
    await scheduleGitHubAuthAlarm(pollLeaseUntil);
    await setGitHubAuthSession({ ...active, pollLeaseUntil });
    return { ...active, pollLeaseUntil };
  });
  if (!session || session.status !== "pending") return;
  if (session.expiresAt <= Date.now()) {
    await runGitHubAuthTransition(async () => {
      if (!await activeGitHubAuthAttempt(session.attemptId)) return;
      await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
      await setGitHubAuthSession({ status: "failed", attemptId: session.attemptId, error: "The GitHub code expired. Start again." });
    });
    return;
  }
  try {
    const result = await pollGitHubTokenOnce(session.deviceCode, GITHUB_OAUTH_CLIENT_ID);
    if (!await activeGitHubAuthAttempt(session.attemptId)) return;
    if (result.status === "authorized") {
      const viewer = await fetchGitHubViewer(result.credentials.accessToken);
      await runGitHubAuthTransition(async () => {
        if (!await activeGitHubAuthAttempt(session.attemptId)) return;
        await chrome.storage.local.set({
          githubToken: result.credentials.accessToken,
          githubRefreshToken: result.credentials.refreshToken,
          githubTokenExpiresAt: result.credentials.expiresAt,
          githubRefreshTokenExpiresAt: result.credentials.refreshTokenExpiresAt,
          githubAccountLogin: viewer.login,
          githubAuthAttemptId: session.attemptId
        });
        if (!await activeGitHubAuthAttempt(session.attemptId)) return;
        await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
        await setGitHubAuthSession({ status: "connected", accountLogin: viewer.login, attemptId: session.attemptId, completedAt: Date.now() });
      });
      return;
    }
    const intervalSeconds = result.status === "slow_down"
      ? Math.max(session.intervalSeconds + 5, result.intervalSeconds || 0)
      : session.intervalSeconds;
    const nextPollAt = Date.now() + (intervalSeconds * 1000);
    await runGitHubAuthTransition(async () => {
      const active = await activeGitHubAuthAttempt(session.attemptId);
      if (!active) return;
      await setGitHubAuthSession({ ...active, status: "pending", intervalSeconds, nextPollAt, pollLeaseUntil: null });
      await scheduleGitHubAuthAlarm(nextPollAt);
    });
  } catch (error) {
    await runGitHubAuthTransition(async () => {
      if (!await activeGitHubAuthAttempt(session.attemptId)) return;
      await chrome.alarms.clear(GITHUB_AUTH_ALARM_NAME);
      await setGitHubAuthSession({ status: "failed", attemptId: session.attemptId, error: error.message });
    });
  }
}

function pollGitHubAuthorization() {
  if (githubAuthPollPromise) return githubAuthPollPromise;
  githubAuthPollPromise = pollGitHubAuthorizationRun().finally(() => {
    githubAuthPollPromise = null;
  });
  return githubAuthPollPromise;
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
        managed: nextManaged[playlist.id],
        onProgress: async (checkpoint) => {
          nextFolders[playlist.id] = checkpoint.folderId;
          nextManaged[playlist.id] = checkpoint.managed;
          await chrome.storage.local.set({
            playlistFolderIds: { ...nextFolders },
            managedBookmarks: { ...nextManaged }
          });
        }
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

chrome.runtime.onStartup?.addListener(() => {
  recoverGitHubAuthorization().catch((error) => console.error("GitHub sign-in recovery failed", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === GITHUB_AUTH_ALARM_NAME) {
    void pollGitHubAuthorization().catch((error) => console.error("GitHub sign-in poll failed", error));
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  getSettings().then((settings) => {
    if (settings.rootFolderId) runProviderSync("youtube", "alarm", syncAll).catch((error) => console.error("YouTube sync failed", error));
    if (settings.githubRootFolderId && settings.githubToken) runProviderSync("github", "alarm", syncGitHubLists).catch((error) => console.error("GitHub sync failed", error));
  }).catch((error) => console.error("Scheduled sync setup failed", error));
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
  if (message.type === "github-auth-disconnect") {
    disconnectGitHub().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-auth-status") {
    githubAuthStatus().then((auth) => respond({ ok: true, auth })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "sync-now" || message.type === "youtube-sync-now") {
    runProviderSync("youtube", "manual", syncAll).then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "github-sync-now") {
    runProviderSync("github", "manual", syncGitHubLists).then((result) => respond({ ok: true, result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
});
