const PLAYLIST_RENDERERS = ["playlistVideoRenderer", "playlistPanelVideoRenderer"];

function extractInitialData(html) {
  const assignment = /(?:var\s+)?ytInitialData\s*=\s*/.exec(html);
  if (!assignment) throw new Error("YouTube page data was not found. Open the playlist in Chrome once, then retry.");
  const start = assignment.index + assignment[0].length;
  if (html[start] !== "{") throw new Error("YouTube page data has an unexpected format.");
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  throw new Error("YouTube page data is incomplete.");
}

function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  for (const child of Object.values(value)) walk(child, visit);
}

function textFrom(runs) {
  if (!runs) return "";
  if (typeof runs.simpleText === "string") return runs.simpleText;
  return (runs.runs || []).map((run) => run.text || "").join("");
}

export function parsePlaylistHtml(html, playlistId) {
  const data = extractInitialData(html);
  const seen = new Set();
  const videos = [];
  let detectedTitle = "";

  walk(data, (node) => {
    for (const rendererKey of PLAYLIST_RENDERERS) {
      const renderer = node[rendererKey];
      if (!renderer?.videoId || seen.has(renderer.videoId)) continue;
      const title = textFrom(renderer.title);
      if (!title) continue;
      seen.add(renderer.videoId);
      videos.push({
        id: renderer.videoId,
        title,
        url: `https://www.youtube.com/watch?v=${renderer.videoId}&list=${encodeURIComponent(playlistId)}&index=${videos.length + 1}`
      });
    }
  });

  walk(data, (node) => {
    if (!detectedTitle && node.playlistSidebarPrimaryInfoRenderer?.title) {
      detectedTitle = textFrom(node.playlistSidebarPrimaryInfoRenderer.title);
    }
  });

  if (!videos.length) {
    throw new Error("No videos were found. The playlist may be private, unavailable, or blocked by YouTube.");
  }
  return { title: detectedTitle, videos };
}

export async function fetchPlaylist(playlist) {
  const playlistId = String(playlist.id || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(playlistId)) throw new Error(`Invalid YouTube playlist ID for ${playlist.title}.`);
  const url = new URL("https://www.youtube.com/playlist");
  url.searchParams.set("list", playlistId);
  url.searchParams.set("hl", "en");
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`YouTube returned ${response.status} for ${playlist.title}.`);
  const result = parsePlaylistHtml(await response.text(), playlistId);
  return { ...playlist, title: result.title || playlist.title, videos: result.videos };
}
