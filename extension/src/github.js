const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

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
    repositories: (list.items?.nodes || []).filter(Boolean).map((repository) => ({
      id: repository.id,
      title: repository.nameWithOwner,
      url: repository.url,
      description: repository.description || ""
    }))
  }));
  return { login: viewer.login, lists };
}

async function queryGitHub(token, query, variables, request) {
  const response = await request(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `GitHub returned ${response.status}. Reconnect GitHub in Settings.`);
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(" "));
  return payload;
}

function repositories(items) {
  return (items?.nodes || []).filter(Boolean).map((repository) => ({
    id: repository.id,
    title: repository.nameWithOwner,
    url: repository.url,
    description: repository.description || ""
  }));
}

export async function fetchGitHubLists(token, request = fetch) {
  if (!token) throw new Error("Connect GitHub in Settings before syncing Lists.");
  let after = null;
  let login = "";
  const lists = [];
  do {
    const payload = await queryGitHub(token, GITHUB_LISTS_QUERY, { after }, request);
    const viewer = payload.data?.viewer;
    if (!viewer) throw new Error("GitHub did not return the signed-in account.");
    login = viewer.login;
    const connection = viewer.lists;
    for (const list of connection?.nodes || []) {
      const repositoryBookmarks = repositories(list.items);
      let itemPage = list.items?.pageInfo;
      while (itemPage?.hasNextPage) {
        const itemPayload = await queryGitHub(token, GITHUB_LIST_ITEMS_QUERY, { id: list.id, after: itemPage.endCursor }, request);
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
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return { login, lists };
}

export async function fetchGitHubViewer(token, request = fetch) {
  const response = await request("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.login) throw new Error(payload.message || "GitHub authorization could not be verified.");
  return payload;
}
