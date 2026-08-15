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

async function render() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  $("#destination").textContent = await folderTitle(settings.rootFolderId);
  $("#playlist-count").textContent = `${settings.playlists.length} selected`;
  $("#interval-note").textContent = `Automatic sync runs every ${settings.syncIntervalMinutes} minute${settings.syncIntervalMinutes === 1 ? "" : "s"} while Chrome is open.`;
  $("#playlists").replaceChildren(...settings.playlists.map((playlist) => {
    const item = document.createElement("li");
    item.textContent = playlist.title;
    return item;
  }));
  const result = settings.lastResult;
  $("#status-title").textContent = result?.success ? "Last sync completed" : "Ready to sync";
  $("#status-copy").textContent = result ? `${dateText(settings.lastSync)} - ${result.created} added, ${result.updated} updated, ${result.removed} removed` : "Choose a bookmark folder to begin.";
  $("#status-dot").classList.toggle("success", Boolean(result?.success));
}

$("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#sync").addEventListener("click", async () => {
  const button = $("#sync");
  button.disabled = true;
  button.textContent = "Syncing...";
  const response = await chrome.runtime.sendMessage({ type: "sync-now" });
  button.disabled = false;
  button.textContent = "Sync now";
  if (!response.ok) $("#status-copy").textContent = response.error;
  await render();
});
render();
