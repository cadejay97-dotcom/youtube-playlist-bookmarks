export const OPEN_TAB_GROUPS_KEY = "openTabGroups";

const EMPTY_GROUPS = { youtube: {}, github: {} };

function apiFor(api) {
  return api || {
    tabs: chrome.tabs,
    tabGroups: chrome.tabGroups,
    storage: chrome.storage.local
  };
}

function cloneEmptyGroups() {
  return { youtube: {}, github: {} };
}

function normalizedGroups(value) {
  const groups = cloneEmptyGroups();
  for (const provider of Object.keys(groups)) {
    if (!value?.[provider] || typeof value[provider] !== "object" || Array.isArray(value[provider])) continue;
    for (const [sourceId, group] of Object.entries(value[provider])) {
      if (!group || typeof group !== "object" || !Number.isInteger(group.groupId) || group.groupId < 0) continue;
      groups[provider][sourceId] = {
        groupId: group.groupId,
        title: typeof group.title === "string" ? group.title : sourceId,
        managedTabs: group.managedTabs && typeof group.managedTabs === "object" ? group.managedTabs : {},
        updatedAt: group.updatedAt || null
      };
    }
  }
  return groups;
}

async function readGroups(storage) {
  const stored = await storage.get({ [OPEN_TAB_GROUPS_KEY]: EMPTY_GROUPS });
  return normalizedGroups(stored[OPEN_TAB_GROUPS_KEY]);
}

async function writeGroups(storage, groups) {
  await storage.set({ [OPEN_TAB_GROUPS_KEY]: groups });
}

function validateSelection({ provider, sourceId, title, items }) {
  if (!Object.hasOwn(EMPTY_GROUPS, provider)) throw new Error("Unsupported tab group source.");
  if (typeof sourceId !== "string" || !sourceId) throw new Error("The selected list has no stable ID.");
  if (typeof title !== "string" || !title.trim()) throw new Error("The selected list has no title.");
  if (!Array.isArray(items) || !items.length) throw new Error(`${title} has no items to open.`);
  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id)) throw new Error(`${title} contains an invalid item.`);
    seen.add(item.id);
    let url;
    try { url = new URL(item.url); } catch { throw new Error(`${title} contains an invalid URL.`); }
    if (url.protocol !== "https:") throw new Error(`${title} contains an untrusted URL.`);
    return { id: item.id, url: url.toString() };
  });
}

async function liveTab(tabs, tabId) {
  if (!Number.isInteger(tabId)) return null;
  try { return await tabs.get(tabId); } catch { return null; }
}

async function liveGroup(tabGroups, groupId) {
  if (!Number.isInteger(groupId)) return null;
  try { return await tabGroups.get(groupId); } catch { return null; }
}

async function createTab(tabs, url, windowId) {
  const properties = { url, active: false };
  if (Number.isInteger(windowId)) properties.windowId = windowId;
  return tabs.create(properties);
}

async function ensureGroup(tabApi, groupId, tabIds, title) {
  let nextGroupId = groupId;
  if (await liveGroup(tabApi.tabGroups, groupId)) {
    if (tabIds.length) await tabApi.tabs.group({ groupId, tabIds });
  } else {
    nextGroupId = await tabApi.tabs.group({ tabIds });
  }
  await tabApi.tabGroups.update(nextGroupId, { title, collapsed: false });
  return nextGroupId;
}

export async function reconcileTabGroup(selection, api) {
  const tabApi = apiFor(api);
  const items = validateSelection(selection);
  const groups = await readGroups(tabApi.storage);
  const previous = groups[selection.provider][selection.sourceId] || null;
  const managedTabs = {};
  const newTabIds = [];
  let created = 0;
  let updated = 0;
  let removed = 0;
  let windowId = null;

  for (const item of items) {
    const known = previous?.managedTabs?.[item.id];
    const tab = await liveTab(tabApi.tabs, known?.tabId);
    if (tab) {
      if (known.url !== item.url) {
        await tabApi.tabs.update(tab.id, { url: item.url });
        updated += 1;
      }
      managedTabs[item.id] = { tabId: tab.id, url: item.url };
      windowId = windowId ?? tab.windowId;
      continue;
    }
    const createdTab = await createTab(tabApi.tabs, item.url, windowId);
    managedTabs[item.id] = { tabId: createdTab.id, url: item.url };
    newTabIds.push(createdTab.id);
    windowId = windowId ?? createdTab.windowId;
    created += 1;
  }

  for (const [itemId, known] of Object.entries(previous?.managedTabs || {})) {
    if (managedTabs[itemId]) continue;
    const tab = await liveTab(tabApi.tabs, known?.tabId);
    if (tab) {
      await tabApi.tabs.remove(tab.id);
      removed += 1;
    }
  }

  const allManagedTabIds = Object.values(managedTabs).map((tab) => tab.tabId);
  const groupId = await ensureGroup(tabApi, previous?.groupId, newTabIds.length ? newTabIds : allManagedTabIds, selection.title.trim());
  groups[selection.provider][selection.sourceId] = {
    groupId,
    title: selection.title.trim(),
    managedTabs,
    updatedAt: new Date().toISOString()
  };
  await writeGroups(tabApi.storage, groups);
  return { groupId, created, updated, removed, total: allManagedTabIds.length };
}

export async function closeTabGroup({ provider, sourceId }, api) {
  const tabApi = apiFor(api);
  if (!Object.hasOwn(EMPTY_GROUPS, provider)) throw new Error("Unsupported tab group source.");
  const groups = await readGroups(tabApi.storage);
  const group = groups[provider][sourceId];
  if (!group) return { closed: false, removed: 0 };
  let tabs = [];
  try { tabs = await tabApi.tabs.query({ groupId: group.groupId }); } catch { /* The group may already be gone. */ }
  if (!tabs.length) {
    tabs = await Promise.all(Object.values(group.managedTabs).map(async ({ tabId }) => liveTab(tabApi.tabs, tabId)));
    tabs = tabs.filter(Boolean);
  }
  if (tabs.length) await tabApi.tabs.remove(tabs.map((tab) => tab.id));
  delete groups[provider][sourceId];
  await writeGroups(tabApi.storage, groups);
  return { closed: true, removed: tabs.length };
}

export async function openTabGroupSummaries(api) {
  const tabApi = apiFor(api);
  const groups = await readGroups(tabApi.storage);
  return Object.fromEntries(Object.entries(groups).map(([provider, entries]) => [
    provider,
    Object.entries(entries).map(([sourceId, group]) => ({ sourceId, groupId: group.groupId, title: group.title }))
  ]));
}

export async function selectedTabGroupIds(provider, api) {
  const groups = await openTabGroupSummaries(api);
  return new Set((groups[provider] || []).map((group) => group.sourceId));
}
