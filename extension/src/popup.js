import { DEFAULT_SETTINGS } from "./default-playlists.js";

const $ = (selector) => document.querySelector(selector);

function dateText(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

async function folderTitle(id) {
  if (!id) return "No destination folder selected";
  const [folder] = await chrome.bookmarks.get(id).catch(() => []);
  return folder ? `Destination: ${folder.title}` : "Destination folder is unavailable";
}

function resultText(result, timestamp, itemName) {
  if (!result) return "Not synced yet.";
  if (!result.success) return result.failed?.map((item) => `${item.title}: ${item.error}`).join(" ") || "The last sync did not finish.";
  return `${dateText(timestamp)} - ${result.ok.length} ${itemName}, ${result.created} added, ${result.updated} updated, ${result.removed} removed`;
}

async function render() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  $("#youtube-destination").textContent = await folderTitle(settings.rootFolderId);
  $("#youtube-count").textContent = `${settings.playlists.length} selected`;
  $("#youtube-status").textContent = settings.rootFolderId
    ? resultText(settings.lastResult, settings.lastSync, "playlists")
    : "Choose a bookmark folder in Settings to begin.";

  $("#github-destination").textContent = await folderTitle(settings.githubRootFolderId);
  $("#github-account").textContent = settings.githubAccountLogin ? `@${settings.githubAccountLogin}` : "Not connected";
  $("#github-status").textContent = settings.githubToken
    ? resultText(settings.githubLastResult, settings.githubLastSync, "Lists")
    : "Connect GitHub in Settings to begin.";
  const githubButton = $("#github-sync");
  githubButton.textContent = settings.githubToken && settings.githubRootFolderId ? "Sync GitHub Lists" : "Connect GitHub";
  $("#interval-note").textContent = `Automatic checks run every ${settings.syncIntervalMinutes} minute${settings.syncIntervalMinutes === 1 ? "" : "s"} while Chrome is open.`;
}

$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#youtube-sync").addEventListener("click", async () => {
  const button = $("#youtube-sync");
  button.disabled = true; button.textContent = "Syncing...";
  const response = await chrome.runtime.sendMessage({ type: "youtube-sync-now" });
  button.disabled = false; button.textContent = "Sync YouTube";
  if (!response.ok) $("#youtube-status").textContent = response.error;
  await render();
});
$("#github-sync").addEventListener("click", async () => {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  if (!settings.githubToken || !settings.githubRootFolderId) { chrome.runtime.openOptionsPage(); return; }
  const button = $("#github-sync");
  button.disabled = true; button.textContent = "Syncing...";
  const response = await chrome.runtime.sendMessage({ type: "github-sync-now" });
  button.disabled = false; button.textContent = "Sync GitHub Lists";
  if (!response.ok) $("#github-status").textContent = response.error;
  await render();
});
render();
