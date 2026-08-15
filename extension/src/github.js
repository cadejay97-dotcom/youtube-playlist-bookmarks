const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const GITHUB_LISTS_QUERY = `
  query ViewerLists {
    viewer {
      login
      lists(first: 100) {
        nodes {
          id
          name
          slug
          description
          isPrivate
          items(first: 100) {
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

export async function fetchGitHubLists(token, request = fetch) {
  if (!token) throw new Error("Connect GitHub in Settings before syncing Lists.");
  const response = await request(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: GITHUB_LISTS_QUERY })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `GitHub returned ${response.status}. Reconnect GitHub in Settings.`);
  return parseGitHubLists(payload);
}

export async function fetchGitHubViewer(token, request = fetch) {
  const response = await request("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.login) throw new Error(payload.message || "GitHub authorization could not be verified.");
  return payload;
}
