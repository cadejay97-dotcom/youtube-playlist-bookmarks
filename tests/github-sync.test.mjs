import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../extension/src/default-playlists.js";
import { syncGitHubLists } from "../extension/src/github-sync.js";

function createBookmarksMock() {
  let nextId = 10;
  const nodes = new Map([["0", { id: "0", title: "root" }], ["1", { id: "1", parentId: "0", title: "PROJECTS" }]]);
  const children = new Map([["0", ["1"]], ["1", []]]);
  return {
    nodes,
    children,
    api: {
      async get(id) { const node = nodes.get(String(id)); return node ? [{ ...node }] : []; },
      async getChildren(parentId) { return (children.get(String(parentId)) || []).map((id) => ({ ...nodes.get(id) })); },
      async create({ parentId, title, url }) { const id = String(nextId++); const node = { id, parentId: String(parentId), title, ...(url ? { url } : {}) }; nodes.set(id, node); children.set(id, []); children.get(node.parentId).push(id); return { ...node }; },
      async update(id, updates) { Object.assign(nodes.get(String(id)), updates); return { ...nodes.get(String(id)) }; },
      async remove(id) { const node = nodes.get(String(id)); children.set(node.parentId, children.get(node.parentId).filter((child) => child !== node.id)); nodes.delete(node.id); },
      async move(id, { parentId, index }) { const node = nodes.get(String(id)); const previous = children.get(node.parentId); previous.splice(previous.indexOf(node.id), 1); node.parentId = String(parentId); children.get(node.parentId).splice(index, 0, node.id); return { ...node }; }
    }
  };
}

test("creates project list, GitHub List, and repository bookmark hierarchy", async () => {
  const bookmarks = createBookmarksMock();
  const storage = { ...DEFAULT_SETTINGS, githubRootFolderId: "1", githubToken: "token" };
  globalThis.chrome = {
    bookmarks: bookmarks.api,
    storage: { local: { async get(defaults) { return { ...defaults, ...storage }; }, async set(values) { Object.assign(storage, values); } } }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { viewer: { login: "octocat", lists: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "UL_1", name: "Lark AI Native", slug: "lark-ai-native", items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "R_1", nameWithOwner: "acme/project", url: "https://github.com/acme/project" }] } }] } } } })
  });
  try {
    const result = await syncGitHubLists();
    const rootChildren = bookmarks.children.get("1").map((id) => bookmarks.nodes.get(id));
    const container = rootChildren.find((node) => node.title === "项目清单");
    const list = bookmarks.children.get(container.id).map((id) => bookmarks.nodes.get(id)).find((node) => node.title === "Lark AI Native");
    const repository = bookmarks.children.get(list.id).map((id) => bookmarks.nodes.get(id))[0];
    assert.equal(repository.title, "acme/project");
    assert.equal(repository.url, "https://github.com/acme/project");
    assert.equal(result.created, 1);
    assert.equal(storage.githubAccountLogin, "octocat");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
