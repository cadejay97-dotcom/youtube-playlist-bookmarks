import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { listFolders } from "./bookmarks.js";
import { requestDeviceCode, pollForGitHubToken } from "./github-auth.js";
import { fetchGitHubViewer } from "./github.js";

const $ = (selector) => document.querySelector(selector);

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
    githubRootFolderId: $("#github-folder").value || null,
    githubClientId: $("#github-client-id").value.trim()
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
  $("#github-client-id").value = settings.githubClientId || "";
  settings.playlists.forEach(addPlaylist);
  updateGitHubConnection(settings);
}

$("#add").addEventListener("click", () => addPlaylist());
$("#save").addEventListener("click", () => saveSettings());

$("#github-connect").addEventListener("click", async () => {
  const clientId = $("#github-client-id").value.trim();
  const feedback = $("#github-feedback");
  const deviceLine = $("#github-device");
  feedback.textContent = "";
  deviceLine.hidden = true;
  try {
    await saveSettings({ showFeedback: false });
    const device = await requestDeviceCode(clientId);
    deviceLine.textContent = `Enter code ${device.user_code} at ${device.verification_uri}`;
    deviceLine.hidden = false;
    await chrome.tabs.create({ url: device.verification_uri });
    feedback.textContent = "Waiting for GitHub authorization...";
    const token = await pollForGitHubToken(device, clientId);
    const viewer = await fetchGitHubViewer(token);
    await chrome.storage.local.set({ githubToken: token, githubAccountLogin: viewer.login });
    updateGitHubConnection({ githubToken: token, githubAccountLogin: viewer.login });
    feedback.textContent = `Connected as @${viewer.login}. Choose a destination, save, then sync.`;
  } catch (error) {
    feedback.textContent = error.message;
  }
});

$("#github-disconnect").addEventListener("click", async () => {
  await chrome.storage.local.set({ githubToken: null, githubAccountLogin: null, githubLastResult: null, githubLastSync: null });
  updateGitHubConnection({});
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
