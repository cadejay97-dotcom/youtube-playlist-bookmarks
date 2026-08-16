function folderPath(node, parents) {
  return [...parents, node.title || "Bookmarks"].filter(Boolean).join(" / ");
}

function isBookmarkNotFound(error) {
  const message = String(error?.message || error || "");
  return /(?:can't|cannot) find bookmark|no bookmark (?:with|for)|bookmark .*not found|bookmark .*does not exist/i.test(message);
}

async function getBookmark(id) {
  if (!id) return null;
  try {
    const [bookmark] = await chrome.bookmarks.get(id);
    return bookmark || null;
  } catch (error) {
    if (isBookmarkNotFound(error)) return null;
    throw error;
  }
}

export async function listFolders() {
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  function visit(node, parents = []) {
    if (!node.url) folders.push({ id: node.id, title: folderPath(node, parents) });
    for (const child of node.children || []) visit(child, [...parents, node.title || ""]);
  }
  tree.forEach((node) => visit(node));
  return folders;
}

export async function ensureFolder(parentId, title, knownId) {
  if (knownId) {
    const folder = await getBookmark(knownId);
    if (folder?.parentId === parentId && !folder.url) {
      if (folder.title !== title) await chrome.bookmarks.update(folder.id, { title });
      return folder.id;
    }
  }
  const children = await chrome.bookmarks.getChildren(parentId);
  const existing = children.find((child) => !child.url && child.title === title);
  return existing ? existing.id : (await chrome.bookmarks.create({ parentId, title })).id;
}

export async function archiveManagedFolder(folderId, managed = {}) {
  const folder = await getBookmark(folderId);
  if (!folder || folder.url) return { removed: 0, archived: false, deleted: false };
  let removed = 0;
  for (const bookmarkId of Object.values(managed)) {
    const bookmark = await getBookmark(bookmarkId);
    if (bookmark?.parentId !== folder.id) continue;
    await chrome.bookmarks.remove(bookmark.id);
    removed += 1;
  }
  const children = await chrome.bookmarks.getChildren(folder.id);
  if (!children.length) {
    await chrome.bookmarks.remove(folder.id);
    return { removed, archived: false, deleted: true };
  }
  if (!folder.title.startsWith("[Archived] ")) {
    await chrome.bookmarks.update(folder.id, { title: `[Archived] ${folder.title}` });
  }
  return { removed, archived: true, deleted: false };
}

export async function mirrorPlaylist({ rootFolderId, playlist, folderId, managed = {}, onProgress }) {
  const resolvedFolderId = await ensureFolder(rootFolderId, playlist.title, folderId);
  const nextManaged = {};
  const checkpointManaged = { ...managed };
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const video of playlist.videos) {
    const existingId = managed[video.id];
    const existing = await getBookmark(existingId);
    if (existing?.parentId === resolvedFolderId) {
      if (existing.title !== video.title || existing.url !== video.url) {
        await chrome.bookmarks.update(existing.id, { title: video.title, url: video.url });
        updated += 1;
      }
      nextManaged[video.id] = existing.id;
      checkpointManaged[video.id] = existing.id;
    } else {
      const createdBookmark = await chrome.bookmarks.create({ parentId: resolvedFolderId, title: video.title, url: video.url });
      nextManaged[video.id] = createdBookmark.id;
      checkpointManaged[video.id] = createdBookmark.id;
      created += 1;
      if (onProgress) await onProgress({ folderId: resolvedFolderId, managed: { ...checkpointManaged }, phase: "items" });
    }
  }

  // Keep extension-managed bookmarks in the same order as their source list.
  for (const [index, video] of playlist.videos.entries()) {
    await chrome.bookmarks.move(nextManaged[video.id], { parentId: resolvedFolderId, index });
  }

  for (const [videoId, bookmarkId] of Object.entries(managed)) {
    if (nextManaged[videoId]) continue;
    const bookmark = await getBookmark(bookmarkId);
    if (bookmark?.parentId === resolvedFolderId) {
      await chrome.bookmarks.remove(bookmarkId);
      removed += 1;
      delete checkpointManaged[videoId];
      if (onProgress) await onProgress({ folderId: resolvedFolderId, managed: { ...checkpointManaged }, phase: "removals" });
    }
  }
  return { folderId: resolvedFolderId, managed: nextManaged, created, updated, removed };
}
