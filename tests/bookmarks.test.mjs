import assert from "node:assert/strict";
import test from "node:test";
import { archiveManagedFolder, ensureFolder, mirrorPlaylist } from "../extension/src/bookmarks.js";

function createBookmarksMock() {
  let nextId = 10;
  const nodes = new Map([
    ["1", { id: "1", parentId: "0", title: "WATCH /d" }],
    ["0", { id: "0", title: "root" }]
  ]);
  const children = new Map([["0", ["1"]], ["1", []]]);
  const bookmarkApi = {
    async get(id) { const node = nodes.get(String(id)); return node ? [{ ...node }] : []; },
    async getChildren(parentId) { return (children.get(String(parentId)) || []).map((id) => ({ ...nodes.get(id) })); },
    async create({ parentId, title, url }) {
      const id = String(nextId++); const node = { id, parentId: String(parentId), title, ...(url ? { url } : {}) };
      nodes.set(id, node); if (!children.has(id)) children.set(id, []); children.get(node.parentId).push(id); return { ...node };
    },
    async update(id, updates) { Object.assign(nodes.get(String(id)), updates); return { ...nodes.get(String(id)) }; },
    async remove(id) { const node = nodes.get(String(id)); if (!node) return; children.set(node.parentId, children.get(node.parentId).filter((child) => child !== node.id)); nodes.delete(node.id); },
    async move(id, { parentId, index }) {
      const node = nodes.get(String(id)); const oldChildren = children.get(node.parentId); oldChildren.splice(oldChildren.indexOf(node.id), 1);
      node.parentId = String(parentId); const nextChildren = children.get(node.parentId); nextChildren.splice(index, 0, node.id); return { ...node };
    }
  };
  return { bookmarkApi, nodes, children };
}

function playlist(videos) { return { id: "PLone", title: "Living in the vibe.", videos }; }
function video(id, title) { return { id, title, url: `https://www.youtube.com/watch?v=${id}&list=PLone` }; }

test("creates the requested container hierarchy and mirrors videos in playlist order", async () => {
  const mock = createBookmarksMock();
  globalThis.chrome = { bookmarks: mock.bookmarkApi };
  const containerId = await ensureFolder("1", "播放清单");
  const result = await mirrorPlaylist({ rootFolderId: containerId, playlist: playlist([video("a", "A"), video("b", "B")]) });
  const folder = mock.nodes.get(result.folderId);
  assert.equal(mock.nodes.get(containerId).title, "播放清单");
  assert.equal(folder.title, "Living in the vibe.");
  assert.deepEqual(mock.children.get(result.folderId).map((id) => mock.nodes.get(id).title), ["A", "B"]);
});

test("updates and removes only managed bookmarks while preserving manual bookmarks", async () => {
  const mock = createBookmarksMock();
  globalThis.chrome = { bookmarks: mock.bookmarkApi };
  const containerId = await ensureFolder("1", "播放清单");
  const initial = await mirrorPlaylist({ rootFolderId: containerId, playlist: playlist([video("a", "A"), video("b", "B")]) });
  const manual = await mock.bookmarkApi.create({ parentId: initial.folderId, title: "Manual bookmark", url: "https://example.com" });
  const next = await mirrorPlaylist({
    rootFolderId: containerId,
    folderId: initial.folderId,
    managed: initial.managed,
    playlist: playlist([video("b", "B revised"), video("c", "C")])
  });
  assert.equal(next.created, 1);
  assert.equal(next.updated, 1);
  assert.equal(next.removed, 1);
  assert.ok(mock.nodes.has(manual.id));
  assert.deepEqual(mock.children.get(initial.folderId).slice(0, 2).map((id) => mock.nodes.get(id).title), ["B revised", "C"]);
});

test("checkpoints created bookmarks so retry converges after a partial failure", async () => {
  const mock = createBookmarksMock();
  globalThis.chrome = { bookmarks: mock.bookmarkApi };
  const containerId = await ensureFolder("1", "播放清单");
  const originalCreate = mock.bookmarkApi.create;
  let failSecondVideo = true;
  mock.bookmarkApi.create = async (details) => {
    if (failSecondVideo && details.url?.includes("watch?v=b")) throw new Error("injected create failure");
    return originalCreate(details);
  };
  let checkpoint;
  await assert.rejects(
    mirrorPlaylist({
      rootFolderId: containerId,
      playlist: playlist([video("a", "A"), video("b", "B")]),
      onProgress: async (value) => { checkpoint = value; }
    }),
    /injected create failure/
  );
  assert.deepEqual(Object.keys(checkpoint.managed), ["a"]);

  failSecondVideo = false;
  const retried = await mirrorPlaylist({
    rootFolderId: containerId,
    folderId: checkpoint.folderId,
    managed: checkpoint.managed,
    playlist: playlist([video("a", "A"), video("b", "B")])
  });
  assert.equal(retried.created, 1);
  assert.deepEqual(mock.children.get(checkpoint.folderId).map((id) => mock.nodes.get(id).title), ["A", "B"]);
});

test("archives a removed source without deleting manual bookmarks", async () => {
  const mock = createBookmarksMock();
  globalThis.chrome = { bookmarks: mock.bookmarkApi };
  const containerId = await ensureFolder("1", "播放清单");
  const mirrored = await mirrorPlaylist({ rootFolderId: containerId, playlist: playlist([video("a", "A")]) });
  const manual = await mock.bookmarkApi.create({ parentId: mirrored.folderId, title: "Manual", url: "https://example.com" });
  const result = await archiveManagedFolder(mirrored.folderId, mirrored.managed);
  assert.deepEqual(result, { removed: 1, archived: true, deleted: false });
  assert.equal(mock.nodes.get(mirrored.folderId).title, "[Archived] Living in the vibe.");
  assert.ok(mock.nodes.has(manual.id));
});

test("does not create duplicates when bookmark lookup infrastructure fails", async () => {
  const mock = createBookmarksMock();
  globalThis.chrome = { bookmarks: mock.bookmarkApi };
  const containerId = await ensureFolder("1", "播放清单");
  const initial = await mirrorPlaylist({ rootFolderId: containerId, playlist: playlist([video("a", "A")]) });
  const originalGet = mock.bookmarkApi.get;
  mock.bookmarkApi.get = async (id) => {
    if (String(id) === initial.managed.a) throw new Error("Chrome bookmark service unavailable");
    return originalGet(id);
  };
  const childCount = mock.children.get(initial.folderId).length;
  await assert.rejects(
    mirrorPlaylist({ rootFolderId: containerId, folderId: initial.folderId, managed: initial.managed, playlist: playlist([video("a", "A")]) }),
    /bookmark service unavailable/
  );
  assert.equal(mock.children.get(initial.folderId).length, childCount);
});
