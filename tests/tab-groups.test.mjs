import assert from "node:assert/strict";
import test from "node:test";
import { closeTabGroup, openTabGroupSummaries, reconcileTabGroup } from "../extension/src/tab-groups.js";

function createChromeMock() {
  let nextTabId = 10;
  let nextGroupId = 20;
  const tabs = new Map();
  const groups = new Map();
  const state = { openTabGroups: { youtube: {}, github: {} } };
  const api = {
    tabs: {
      async get(id) {
        const tab = tabs.get(Number(id));
        if (!tab) throw new Error("No tab with that id");
        return { ...tab };
      },
      async create({ url, active, windowId }) {
        const tab = { id: nextTabId++, url, active, windowId: windowId || 1, groupId: -1 };
        tabs.set(tab.id, tab);
        return { ...tab };
      },
      async update(id, updates) {
        Object.assign(tabs.get(Number(id)), updates);
        return { ...tabs.get(Number(id)) };
      },
      async group({ tabIds, groupId }) {
        const id = Number.isInteger(groupId) ? groupId : nextGroupId++;
        if (!groups.has(id)) groups.set(id, { id, title: "" });
        for (const tabId of tabIds) tabs.get(Number(tabId)).groupId = id;
        return id;
      },
      async query({ groupId }) {
        return [...tabs.values()].filter((tab) => tab.groupId === groupId).map((tab) => ({ ...tab }));
      },
      async remove(tabIds) {
        for (const tabId of (Array.isArray(tabIds) ? tabIds : [tabIds])) tabs.delete(Number(tabId));
      }
    },
    tabGroups: {
      async get(id) {
        const group = groups.get(Number(id));
        if (!group) throw new Error("No group with that id");
        return { ...group };
      },
      async update(id, updates) {
        Object.assign(groups.get(Number(id)), updates);
        return { ...groups.get(Number(id)) };
      }
    },
    storage: {
      async get(defaults) { return { ...defaults, openTabGroups: structuredClone(state.openTabGroups) }; },
      async set(values) { Object.assign(state, structuredClone(values)); }
    }
  };
  return { api, tabs, groups, state };
}

test("opens a list in a named group and converges updates without duplicates", async () => {
  const mock = createChromeMock();
  const first = await reconcileTabGroup({
    provider: "youtube",
    sourceId: "PL_ONE",
    title: "Living in the vibe.",
    items: [{ id: "video-1", url: "https://www.youtube.com/watch?v=one" }, { id: "video-2", url: "https://www.youtube.com/watch?v=two" }]
  }, mock.api);
  assert.equal(first.created, 2);
  assert.equal(mock.groups.get(first.groupId).title, "Living in the vibe.");
  assert.equal(mock.tabs.size, 2);

  const second = await reconcileTabGroup({
    provider: "youtube",
    sourceId: "PL_ONE",
    title: "Living in the vibe.",
    items: [{ id: "video-1", url: "https://www.youtube.com/watch?v=updated" }, { id: "video-3", url: "https://www.youtube.com/watch?v=three" }]
  }, mock.api);
  assert.deepEqual({ created: second.created, updated: second.updated, removed: second.removed }, { created: 1, updated: 1, removed: 1 });
  assert.equal(mock.tabs.size, 2);
  assert.equal((await openTabGroupSummaries(mock.api)).youtube[0].title, "Living in the vibe.");

  const managedTab = [...mock.tabs.values()][0];
  managedTab.groupId = -1;
  await reconcileTabGroup({
    provider: "youtube",
    sourceId: "PL_ONE",
    title: "Living in the vibe.",
    items: [{ id: "video-1", url: "https://www.youtube.com/watch?v=updated" }, { id: "video-3", url: "https://www.youtube.com/watch?v=three" }]
  }, mock.api);
  assert.equal(managedTab.groupId, first.groupId);
});

test("closing a selected group removes its tabs and persisted selection", async () => {
  const mock = createChromeMock();
  const opened = await reconcileTabGroup({ provider: "github", sourceId: "UL_ONE", title: "Lark AI Native", items: [{ id: "repo-1", url: "https://github.com/acme/one" }] }, mock.api);
  const result = await closeTabGroup({ provider: "github", sourceId: "UL_ONE" }, mock.api);
  assert.equal(result.closed, true);
  assert.equal(result.removed, 1);
  assert.equal(mock.tabs.size, 0);
  assert.deepEqual((await openTabGroupSummaries(mock.api)).github, []);
  assert.equal((await closeTabGroup({ provider: "github", sourceId: "UL_ONE" }, mock.api)).closed, false);
  assert.ok(opened.groupId > 0);
});

test("rejects non-HTTPS tab group content", async () => {
  const mock = createChromeMock();
  await assert.rejects(
    reconcileTabGroup({ provider: "github", sourceId: "UL_ONE", title: "Unsafe", items: [{ id: "repo-1", url: "javascript:alert(1)" }] }, mock.api),
    /untrusted URL/
  );
});
