const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 20_000;

function githubRequestError(message, { retryable = false, status = null } = {}) {
  const error = new Error(message);
  error.retryable = retryable;
  error.status = status;
  return error;
}

async function requestGitHub(url, options, request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await request(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw githubRequestError(
      error?.name === "AbortError" ? "GitHub did not respond in time." : "GitHub could not be reached.",
      { retryable: true }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const GITHUB_LISTS_QUERY = `
  query ViewerLists($after: String) {
    viewer {
      login
      lists(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          slug
          description
          isPrivate
          items(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              ... on Repository {
                id
                nameWithOwner
                url
                description
              }
            }
          }
        }
      }
    }
  }
`;

export const GITHUB_LIST_ITEMS_QUERY = `
  query UserListItems($id: ID!, $after: String) {
    node(id: $id) {
      ... on UserList {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on Repository {
              id
              nameWithOwner
              url
              description
            }
          }
        }
      }
    }
  }
`;

export function parseGitHubLists(payload) {
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(" "));
  const viewer = payload.data?.viewer;
  if (!viewer) throw new Error("GitHub did not return the signed-in account.");
  const lists = (viewer.lists?.nodes || []).map((list) => ({
    id: list.id,
    title: list.name,
    slug: list.slug,
    description: list.description || "",
    isPrivate: Boolean(list.isPrivate),
    repositories: repositories(list.items)
  }));
  return { login: viewer.login, lists };
}

async function queryGitHub(token, query, variables, request) {
  const response = await requestGitHub(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  }, request);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw githubRequestError(payload.message || `GitHub returned ${response.status}. Reconnect GitHub in Settings.`, {
    retryable: response.status === 429 || response.status >= 500,
    status: response.status
  });
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(" "));
  return payload;
}

function repositories(items) {
  return (items?.nodes || []).filter(Boolean).map((repository) => {
    if (typeof repository.id !== "string" || typeof repository.nameWithOwner !== "string") {
      throw new Error("GitHub returned a repository without a stable ID or name.");
    }
    let url;
    try { url = new URL(repository.url); } catch { throw new Error(`GitHub returned an invalid URL for ${repository.nameWithOwner}.`); }
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
      throw new Error(`GitHub returned an untrusted URL for ${repository.nameWithOwner}.`);
    }
    return {
      id: repository.id,
      title: repository.nameWithOwner,
      url: url.toString(),
      description: repository.description || ""
    };
  });
}

function nextCursor(pageInfo, seen, context) {
  if (!pageInfo?.hasNextPage) return null;
  const cursor = pageInfo.endCursor;
  if (typeof cursor !== "string" || !cursor || seen.has(cursor)) {
    throw new Error(`GitHub pagination stopped making progress for ${context}.`);
  }
  seen.add(cursor);
  if (seen.size >= MAX_PAGES) throw new Error(`GitHub pagination exceeded ${MAX_PAGES} pages for ${context}.`);
  return cursor;
}

export async function fetchGitHubLists(token, request = fetch) {
  if (!token) throw new Error("Connect GitHub in Settings before syncing Lists.");
  let after = null;
  let login = "";
  const lists = [];
  const listCursors = new Set();
  do {
    const payload = await queryGitHub(token, GITHUB_LISTS_QUERY, { after }, request);
    const viewer = payload.data?.viewer;
    if (!viewer) throw new Error("GitHub did not return the signed-in account.");
    login = viewer.login;
    const connection = viewer.lists;
    for (const list of connection?.nodes || []) {
      const repositoryBookmarks = repositories(list.items);
      let itemPage = list.items?.pageInfo;
      const itemCursors = new Set();
      while (itemPage?.hasNextPage) {
        const itemAfter = nextCursor(itemPage, itemCursors, `List ${list.name || list.id}`);
        const itemPayload = await queryGitHub(token, GITHUB_LIST_ITEMS_QUERY, { id: list.id, after: itemAfter }, request);
        const items = itemPayload.data?.node?.items;
        repositoryBookmarks.push(...repositories(items));
        itemPage = items?.pageInfo;
      }
      lists.push({
        id: list.id,
        title: list.name,
        slug: list.slug,
        description: list.description || "",
        isPrivate: Boolean(list.isPrivate),
        repositories: repositoryBookmarks
      });
    }
    after = nextCursor(connection?.pageInfo, listCursors, "GitHub Lists");
  } while (after);
  return { login, lists };
}

export async function fetchGitHubViewer(token, request = fetch) {
  const response = await requestGitHub("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }
  }, request);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.login) throw githubRequestError(payload.message || "GitHub authorization could not be verified.", {
    retryable: response.status === 429 || response.status >= 500 || response.ok,
    status: response.status
  });
  return payload;
}
