import { DEFAULT_SETTINGS } from "./default-playlists.js";
import { listFolders } from "./bookmarks.js";

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

async function load() {
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  const folders = await listFolders();
  const select = $("#folder");
  select.add(new Option("Select a bookmark folder", ""));
  folders.forEach((folder) => select.add(new Option(folder.title, folder.id)));
  select.value = settings.rootFolderId || "";
  $("#interval").value = String(settings.syncIntervalMinutes);
  settings.playlists.forEach(addPlaylist);
}

$("#add").addEventListener("click", () => addPlaylist());
$("#save").addEventListener("click", async () => {
  const rootFolderId = $("#folder").value;
  const playlists = [...document.querySelectorAll(".playlist-row")].map((row) => {
    const url = row.querySelector(".playlist-url").value.trim();
    return { id: playlistId(url), title: row.querySelector(".playlist-title").value.trim(), url };
  }).filter((playlist) => playlist.id && playlist.title);
  if (!rootFolderId) { $("#saved").textContent = "Choose a destination folder."; return; }
  if (!playlists.length) { $("#saved").textContent = "Add at least one playlist."; return; }
  await chrome.storage.local.set({ rootFolderId, playlists, syncIntervalMinutes: Number($("#interval").value) });
  $("#saved").textContent = "Settings saved.";
  setTimeout(() => { $("#saved").textContent = ""; }, 2500);
});
load();
