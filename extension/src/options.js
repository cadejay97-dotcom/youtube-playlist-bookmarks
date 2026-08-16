import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { listFolders } from "./bookmarks.js";

const $ = (selector) => document.querySelector(selector);
let githubAuth = { status: "idle" };
const GITHUB_ORIGINS = ["https://github.com/*", "https://api.github.com/*"];

function playlistId(value) {
  try { return new URL(value).searchParams.get("list") || value.trim(); } catch { return value.trim(); }
}

function addPlaylist(playlist = { title: "", url: "", id: "" }) {
  const row = $("#playlist-template").content.firstElementChild.cloneNode(true);
  row.querySelector(".playlist-title").value = playlist.title;
  row.querySelector(".playlist-url").value = playlist.url || playlist.id;
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  $("#playlist-editor").append(row);
}

function populateFolderSelect(select, folders, selectedId, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  folders.forEach((folder) => select.add(new Option(folder.title, folder.id)));
  select.value = selectedId || "";
}

function updateGitHubConnection(settings) {
  const connected = Boolean(settings.githubToken && settings.githubAccountLogin);
  $("#github-account").textContent = connected ? `Connected as @${settings.githubAccountLogin}` : "Not connected";
  $("#github-account").classList.toggle("connected", connected);
  $("#github-connect").textContent = connected ? "Reconnect GitHub" : "Connect GitHub";
  $("#github-disconnect").hidden = !connected;
}

function renderGitHubAuth(auth) {
  githubAuth = auth || { status: "idle" };
  const feedback = $("#github-feedback");
  const deviceLine = $("#github-device");
  const actions = $("#github-auth-actions");
  const active = ["requesting", "code", "pending", "verifying"].includes(githubAuth.status);
  const hasCode = ["code", "pending"].includes(githubAuth.status);
  $("#github-connect").disabled = active;
  deviceLine.hidden = !hasCode;
  actions.hidden = !hasCode;
  $("#github-continue").hidden = githubAuth.status !== "code";
  if (["code", "pending"].includes(githubAuth.status)) deviceLine.textContent = `GitHub one-time code: ${githubAuth.userCode}`;
  if (githubAuth.status === "requesting") feedback.textContent = "Requesting a one-time code from GitHub...";
  if (githubAuth.status === "code") feedback.textContent = "Your code is ready. Copy it and continue to GitHub.";
  if (githubAuth.status === "pending") feedback.textContent = githubAuth.transientError
    ? `${githubAuth.transientError} The extension will retry automatically.`
    : "Waiting for GitHub approval. You may close and reopen Settings without losing this attempt.";
  if (githubAuth.status === "verifying") feedback.textContent = githubAuth.transientError
    ? `${githubAuth.transientError} Account verification will retry automatically.`
    : "GitHub approved access. Verifying the connected account...";
  if (githubAuth.status === "failed") feedback.textContent = githubAuth.error || "GitHub sign-in failed. Start again.";
}

async function refreshGitHubAuth() {
  const response = await chrome.runtime.sendMessage({ type: "github-auth-status" });
  if (!response.ok) throw new Error(response.error);
  renderGitHubAuth(response.auth);
  if (response.auth.status === "connected") {
    const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
    updateGitHubConnection(settings);
    $("#github-feedback").textContent = `Connected as @${response.auth.accountLogin}. Choose a destination, save, then sync.`;
  }
}

function collectYouTubePlaylists() {
  const playlists = [...document.querySelectorAll(".playlist-row")].map((row) => {
    const url = row.querySelector(".playlist-url").value.trim();
    return { id: playlistId(url), title: row.querySelector(".playlist-title").value.trim(), url };
  }).filter((playlist) => playlist.id && playlist.title);
  const seen = new Set();
  for (const playlist of playlists) {
    if (seen.has(playlist.id)) throw new Error(`YouTube playlist ${playlist.id} is configured more than once.`);
    seen.add(playlist.id);
  }
  return playlists;
}

async function saveSettings({ showFeedback = true } = {}) {
  await chrome.storage.local.set({
    rootFolderId: $("#folder").value || null,
    playlists: collectYouTubePlaylists(),
    syncIntervalMinutes: Number($("#interval").value),
    githubRootFolderId: $("#github-folder").value || null,
    githubIncludePrivateLists: $("#github-private-lists").checked
  });
  if (showFeedback) {
    $("#saved").textContent = "Settings saved.";
    setTimeout(() => { $("#saved").textContent = ""; }, 2500);
  }
}

async function load() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  const folders = await listFolders();
  populateFolderSelect($("#folder"), folders, settings.rootFolderId, "No YouTube destination selected");
  populateFolderSelect($("#github-folder"), folders, settings.githubRootFolderId, "No GitHub destination selected");
  $("#interval").value = String(settings.syncIntervalMinutes);
  $("#github-private-lists").checked = Boolean(settings.githubIncludePrivateLists);
  settings.playlists.forEach(addPlaylist);
  updateGitHubConnection(settings);
  await refreshGitHubAuth();
}

$("#add").addEventListener("click", () => addPlaylist());
$("#save").addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (error) {
    $("#saved").textContent = error.message;
  }
});

$("#github-connect").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  const button = $("#github-connect");
  button.disabled = true;
  feedback.textContent = "";
  try {
    const granted = await chrome.permissions.request({ origins: GITHUB_ORIGINS });
    if (!granted) throw new Error("GitHub access was not granted. Allow GitHub access to connect and sync Lists.");
    await saveSettings({ showFeedback: false });
    const response = await chrome.runtime.sendMessage({ type: "github-auth-start" });
    if (!response.ok) throw new Error(response.error);
    renderGitHubAuth(response.auth);
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = ["code", "pending", "requesting", "verifying"].includes(githubAuth.status);
  }
});

$("#github-continue").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  const button = $("#github-continue");
  button.disabled = true;
  let copied = false;
  try {
    await navigator.clipboard.writeText(githubAuth.userCode);
    copied = true;
  } catch {
    copied = false;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "github-auth-continue" });
    if (!response?.ok) throw new Error(response?.error || "GitHub sign-in did not respond.");
    renderGitHubAuth(response.auth);
    feedback.textContent = copied
      ? "Code copied. Paste it on GitHub and approve access."
      : `Copy ${githubAuth.userCode}, paste it on GitHub, and approve access.`;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = githubAuth.status !== "code";
  }
});

$("#github-cancel").addEventListener("click", async () => {
  const button = $("#github-cancel");
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "github-auth-cancel" });
    if (!response?.ok) throw new Error(response?.error || "GitHub sign-in cancellation did not respond.");
    renderGitHubAuth(response.auth);
    $("#github-feedback").textContent = "GitHub sign-in canceled.";
    if (response.auth.status === "idle") await chrome.permissions.remove({ origins: GITHUB_ORIGINS });
  } catch (error) {
    $("#github-feedback").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#github-disconnect").addEventListener("click", async () => {
  const button = $("#github-disconnect");
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "github-auth-disconnect" });
    if (!response?.ok) throw new Error(response?.error || "GitHub disconnect did not respond.");
    updateGitHubConnection({});
    renderGitHubAuth(response.auth);
    await chrome.permissions.remove({ origins: GITHUB_ORIGINS });
    $("#github-feedback").textContent = "GitHub forgotten on this device. Existing bookmarks were not changed.";
  } catch (error) {
    $("#github-feedback").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#github-sync").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  const button = $("#github-sync");
  button.disabled = true;
  try {
    await saveSettings({ showFeedback: false });
    feedback.textContent = "Syncing GitHub Lists...";
    const response = await chrome.runtime.sendMessage({ type: "github-sync-now" });
    if (!response?.ok) throw new Error(response?.error || "GitHub sync did not respond.");
    feedback.textContent = `${response.result.ok.length} Lists synced, ${response.result.failed.length} failed: ${response.result.created} added, ${response.result.updated} updated, ${response.result.removed} removed.`;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

load().catch((error) => {
  $("#github-feedback").textContent = `Settings could not load: ${error.message}`;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.githubAuthSession) refreshGitHubAuth().catch((error) => {
    $("#github-feedback").textContent = error.message;
  });
});
