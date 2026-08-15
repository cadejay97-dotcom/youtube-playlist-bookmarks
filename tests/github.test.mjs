import assert from "node:assert/strict";
import test from "node:test";
import { fetchGitHubLists, parseGitHubLists } from "../extension/src/github.js";
import { pollForGitHubToken, requestDeviceCode } from "../extension/src/github-auth.js";

const graphQlPayload = {
  data: {
    viewer: {
      login: "octocat",
      lists: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          id: "UL_1",
          name: "AI projects",
          slug: "ai-projects",
          description: "Useful repositories",
          isPrivate: false,
          items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "R_1", nameWithOwner: "openai/openai-node", url: "https://github.com/openai/openai-node", description: "Node SDK" }] }
        }]
      }
    }
  }
};

test("parses GitHub Lists into folders and repository bookmarks", () => {
  const result = parseGitHubLists(graphQlPayload);
  assert.equal(result.login, "octocat");
  assert.equal(result.lists[0].title, "AI projects");
  assert.deepEqual(result.lists[0].repositories[0], {
    id: "R_1",
    title: "openai/openai-node",
    url: "https://github.com/openai/openai-node",
    description: "Node SDK"
  });
});

test("calls the official GraphQL endpoint with the GitHub bearer token", async () => {
  let request;
  const result = await fetchGitHubLists("token-123", async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => graphQlPayload };
  });
  assert.equal(request.url, "https://api.github.com/graphql");
  assert.equal(request.options.headers.Authorization, "Bearer token-123");
  assert.match(JSON.parse(request.options.body).query, /viewer\s*\{/);
  assert.equal(result.lists.length, 1);
});

test("paginates through repository bookmarks in a GitHub List", async () => {
  const pages = [{
    data: { viewer: { login: "octocat", lists: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "UL_1", name: "AI projects", slug: "ai-projects", description: "", isPrivate: false, items: { pageInfo: { hasNextPage: true, endCursor: "page-2" }, nodes: [{ id: "R_1", nameWithOwner: "acme/one", url: "https://github.com/acme/one" }] } }] } } }
  }, {
    data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "R_2", nameWithOwner: "acme/two", url: "https://github.com/acme/two" }] } } }
  }];
  const result = await fetchGitHubLists("token", async () => ({ ok: true, json: async () => pages.shift() }));
  assert.deepEqual(result.lists[0].repositories.map((repository) => repository.title), ["acme/one", "acme/two"]);
});

test("paginates through GitHub Lists as well as their repository bookmarks", async () => {
  const pages = [{
    data: { viewer: { login: "octocat", lists: { pageInfo: { hasNextPage: true, endCursor: "lists-page-2" }, nodes: [{ id: "UL_1", name: "One", slug: "one", description: "", isPrivate: false, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }] } } }
  }, {
    data: { viewer: { login: "octocat", lists: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "UL_2", name: "Two", slug: "two", description: "", isPrivate: false, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }] } } }
  }];
  const requestedVariables = [];
  const result = await fetchGitHubLists("token", async (_url, options) => {
    requestedVariables.push(JSON.parse(options.body).variables);
    return { ok: true, json: async () => pages.shift() };
  });
  assert.deepEqual(result.lists.map((list) => list.title), ["One", "Two"]);
  assert.deepEqual(requestedVariables, [{ after: null }, { after: "lists-page-2" }]);
});

test("requests GitHub Device Flow with the user scope required for Lists", async () => {
  let body;
  const device = await requestDeviceCode("Iv1.client", async (_url, options) => {
    body = new URLSearchParams(options.body);
    return { ok: true, json: async () => ({ device_code: "device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }) };
  });
  assert.equal(body.get("client_id"), "Iv1.client");
  assert.equal(body.get("scope"), "user");
  assert.equal(device.user_code, "ABCD-EFGH");
});

test("polls through authorization_pending and returns the approved token", async () => {
  let calls = 0;
  const token = await pollForGitHubToken({ device_code: "device", expires_in: 30, interval: 5 }, "Iv1.client", {
    sleep: async () => undefined,
    request: async () => {
      calls += 1;
      return { ok: true, json: async () => calls === 1 ? { error: "authorization_pending" } : { access_token: "approved-token" } };
    }
  });
  assert.equal(calls, 2);
  assert.equal(token, "approved-token");
});
