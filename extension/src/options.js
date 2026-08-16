import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { listFolders } from "./bookmarks.js";

const $ = (selector) => document.querySelector(selector);
let githubAuth = { status: "idle" };

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
  const active = ["code", "pending"].includes(githubAuth.status);
  $("#github-connect").disabled = active;
  deviceLine.hidden = !active;
  actions.hidden = !active;
  $("#github-continue").hidden = githubAuth.status !== "code";
  if (active) deviceLine.textContent = `GitHub one-time code: ${githubAuth.userCode}`;
  if (githubAuth.status === "code") feedback.textContent = "Your code is ready. Copy it and continue to GitHub.";
  if (githubAuth.status === "pending") feedback.textContent = "Waiting for GitHub approval. You may close and reopen Settings without losing this attempt.";
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
  return [...document.querySelectorAll(".playlist-row")].map((row) => {
    const url = row.querySelector(".playlist-url").value.trim();
    return { id: playlistId(url), title: row.querySelector(".playlist-title").value.trim(), url };
  }).filter((playlist) => playlist.id && playlist.title);
}

async function saveSettings({ showFeedback = true } = {}) {
  await chrome.storage.local.set({
    rootFolderId: $("#folder").value || null,
    playlists: collectYouTubePlaylists(),
    syncIntervalMinutes: Number($("#interval").value),
    githubRootFolderId: $("#github-folder").value || null
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
  settings.playlists.forEach(addPlaylist);
  updateGitHubConnection(settings);
  await refreshGitHubAuth();
}

$("#add").addEventListener("click", () => addPlaylist());
$("#save").addEventListener("click", () => saveSettings());

$("#github-connect").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  feedback.textContent = "";
  try {
    await saveSettings({ showFeedback: false });
    const response = await chrome.runtime.sendMessage({ type: "github-auth-start" });
    if (!response.ok) throw new Error(response.error);
    renderGitHubAuth(response.auth);
  } catch (error) {
    feedback.textContent = error.message;
    $("#github-connect").disabled = false;
  }
});

$("#github-continue").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  let copied = false;
  try {
    await navigator.clipboard.writeText(githubAuth.userCode);
    copied = true;
  } catch {
    copied = false;
  }
  const response = await chrome.runtime.sendMessage({ type: "github-auth-continue" });
  if (!response.ok) {
    feedback.textContent = response.error;
    return;
  }
  renderGitHubAuth(response.auth);
  feedback.textContent = copied
    ? "Code copied. Paste it on GitHub and approve access."
    : `Copy ${githubAuth.userCode}, paste it on GitHub, and approve access.`;
});

$("#github-cancel").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "github-auth-cancel" });
  renderGitHubAuth(response.ok ? response.auth : { status: "failed", error: response.error });
  $("#github-feedback").textContent = response.ok ? "GitHub sign-in canceled." : response.error;
});

$("#github-disconnect").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "github-auth-disconnect" });
  if (!response.ok) throw new Error(response.error);
  updateGitHubConnection({});
  renderGitHubAuth(response.auth);
  $("#github-feedback").textContent = "GitHub disconnected. Existing bookmarks were not changed.";
});

$("#github-sync").addEventListener("click", async () => {
  const feedback = $("#github-feedback");
  await saveSettings({ showFeedback: false });
  feedback.textContent = "Syncing GitHub Lists...";
  const response = await chrome.runtime.sendMessage({ type: "github-sync-now" });
  feedback.textContent = response.ok
    ? `${response.result.ok.length} Lists synced: ${response.result.created} added, ${response.result.updated} updated, ${response.result.removed} removed.`
    : response.error;
});

load();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.githubAuthSession) refreshGitHubAuth().catch((error) => {
    $("#github-feedback").textContent = error.message;
  });
});
