function folderPath(node, parents) {
  return [...parents, node.title || "Bookmarks"].filter(Boolean).join(" / ");
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
    const [folder] = await chrome.bookmarks.get(knownId).catch(() => []);
    if (folder?.parentId === parentId && !folder.url) {
      if (folder.title !== title) await chrome.bookmarks.update(folder.id, { title });
      return folder.id;
    }
  }
  const children = await chrome.bookmarks.getChildren(parentId);
  const existing = children.find((child) => !child.url && child.title === title);
  return existing ? existing.id : (await chrome.bookmarks.create({ parentId, title })).id;
}

export async function mirrorPlaylist({ rootFolderId, playlist, folderId, managed = {} }) {
  const resolvedFolderId = await ensureFolder(rootFolderId, playlist.title, folderId);
  const nextManaged = {};
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const video of playlist.videos) {
    const existingId = managed[video.id];
    const [existing] = existingId ? await chrome.bookmarks.get(existingId).catch(() => []) : [];
    if (existing?.parentId === resolvedFolderId) {
      if (existing.title !== video.title || existing.url !== video.url) {
        await chrome.bookmarks.update(existing.id, { title: video.title, url: video.url });
        updated += 1;
      }
      nextManaged[video.id] = existing.id;
    } else {
      const createdBookmark = await chrome.bookmarks.create({ parentId: resolvedFolderId, title: video.title, url: video.url });
      nextManaged[video.id] = createdBookmark.id;
      created += 1;
    }
  }

  // Keep extension-managed bookmarks in the same order as their source list.
  for (const [index, video] of playlist.videos.entries()) {
    await chrome.bookmarks.move(nextManaged[video.id], { parentId: resolvedFolderId, index });
  }

  for (const [videoId, bookmarkId] of Object.entries(managed)) {
    if (nextManaged[videoId]) continue;
    const [bookmark] = await chrome.bookmarks.get(bookmarkId).catch(() => []);
    if (bookmark?.parentId === resolvedFolderId) {
      await chrome.bookmarks.remove(bookmarkId);
      removed += 1;
    }
  }
  return { folderId: resolvedFolderId, managed: nextManaged, created, updated, removed };
}
