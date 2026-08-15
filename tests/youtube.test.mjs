import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaylistHtml } from "../extension/src/youtube.js";

const payload = { contents: [{ playlistVideoRenderer: { videoId: "abc123", title: { runs: [{ text: "First video" }] } } }, { playlistPanelVideoRenderer: { videoId: "xyz789", title: { simpleText: "Second video" } } }], sidebar: { playlistSidebarPrimaryInfoRenderer: { title: { runs: [{ text: "Sample list" }] } } } };
const html = `<script>var ytInitialData = ${JSON.stringify(payload)};</script>`;

test("parses YouTube playlist renderers into canonical bookmark URLs", () => {
  const result = parsePlaylistHtml(html, "PLsample");
  assert.equal(result.title, "Sample list");
  assert.deepEqual(result.videos.map((video) => video.title), ["First video", "Second video"]);
  assert.equal(result.videos[1].url, "https://www.youtube.com/watch?v=xyz789&list=PLsample&index=2");
});

test("throws a useful error when a playlist contains no video renderer", () => {
  assert.throws(() => parsePlaylistHtml('<script>var ytInitialData = {};</script>', "PLsample"), /No videos/);
});

test("does not terminate JSON parsing at a semicolon inside a video title", () => {
  const special = { contents: [{ playlistVideoRenderer: { videoId: "abc123", title: { simpleText: "A title }; still inside JSON" } } }] };
  const result = parsePlaylistHtml(`<script>var ytInitialData = ${JSON.stringify(special)};</script>`, "PLsample");
  assert.equal(result.videos[0].title, "A title }; still inside JSON");
});
