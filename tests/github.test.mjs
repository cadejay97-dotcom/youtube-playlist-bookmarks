import assert from "node:assert/strict";
import test from "node:test";
import { fetchGitHubLists, parseGitHubLists } from "../extension/src/github.js";
import { pollForGitHubToken, pollGitHubTokenOnce, refreshGitHubToken, requestDeviceCode } from "../extension/src/github-auth.js";

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

test("requests GitHub Device Flow with read-only user access", async () => {
  let body;
  const device = await requestDeviceCode("Iv1.client", async (_url, options) => {
    body = new URLSearchParams(options.body);
    return { ok: true, json: async () => ({ device_code: "device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }) };
  });
  assert.equal(body.get("client_id"), "Iv1.client");
  assert.equal(body.get("scope"), "read:user");
  assert.equal(device.user_code, "ABCD-EFGH");
});

test("polls through authorization_pending and returns the approved token", async () => {
  let calls = 0;
  const credentials = await pollForGitHubToken({ device_code: "device", expires_in: 30, interval: 5 }, "Iv1.client", {
    sleep: async () => undefined,
    request: async () => {
      calls += 1;
      return { ok: true, json: async () => calls === 1 ? { error: "authorization_pending" } : { access_token: "approved-token", refresh_token: "refresh-token", expires_in: 28800, refresh_token_expires_in: 15897600 } };
    }
  });
  assert.equal(calls, 2);
  assert.equal(credentials.accessToken, "approved-token");
  assert.equal(credentials.refreshToken, "refresh-token");
  assert.ok(credentials.expiresAt > Date.now());
});

test("reports one Device Flow poll without owning the page lifecycle", async () => {
  const pending = await pollGitHubTokenOnce("device", "Iv1.client", {
    request: async () => ({ ok: true, json: async () => ({ error: "authorization_pending" }) })
  });
  assert.deepEqual(pending, { status: "pending" });

  const slowed = await pollGitHubTokenOnce("device", "Iv1.client", {
    request: async () => ({ ok: true, json: async () => ({ error: "slow_down", interval: 10 }) })
  });
  assert.deepEqual(slowed, { status: "slow_down", intervalSeconds: 10 });

  const approved = await pollGitHubTokenOnce("device", "Iv1.client", {
    now: 1_000,
    request: async () => ({ ok: true, json: async () => ({ access_token: "approved-token", expires_in: 100 }) })
  });
  assert.deepEqual(approved, {
    status: "authorized",
    credentials: { accessToken: "approved-token", refreshToken: null, expiresAt: 101_000, refreshTokenExpiresAt: null }
  });
});

test("refreshes an expiring Device Flow token without a client secret", async () => {
  let body;
  const credentials = await refreshGitHubToken("old-refresh", "Iv1.client", {
    now: 1_000,
    request: async (_url, options) => {
      body = new URLSearchParams(options.body);
      return { ok: true, json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 100, refresh_token_expires_in: 200 }) };
    }
  });
  assert.equal(body.get("client_id"), "Iv1.client");
  assert.equal(body.get("refresh_token"), "old-refresh");
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("client_secret"), null);
  assert.deepEqual(credentials, { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 101_000, refreshTokenExpiresAt: 201_000 });
});

test("keeps GitHub authorization in the background until the account is connected", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const local = {};
  const session = {};
  const alarms = new Map();
  const openedTabs = [];
  let tokenPolls = 0;
  let alarmCreates = 0;
  let onAlarm;
  let onMessage;

  const read = (store, query) => {
    if (Array.isArray(query)) return Object.fromEntries(query.map((key) => [key, store[key]]));
    if (typeof query === "string") return { [query]: store[query] };
    if (query && typeof query === "object") return { ...query, ...store };
    return { ...store };
  };

  globalThis.chrome = {
    alarms: {
      clear: async (name) => alarms.delete(name),
      create: (name, value) => { alarmCreates += 1; alarms.set(name, value); },
      onAlarm: { addListener: (listener) => { onAlarm = listener; } }
    },
    bookmarks: {},
    runtime: {
      onInstalled: { addListener: () => undefined },
      onMessage: { addListener: (listener) => { onMessage = listener; } }
    },
    storage: {
      local: {
        get: async (query) => read(local, query),
        set: async (values) => Object.assign(local, values)
      },
      session: {
        get: async (query) => read(session, query),
        set: async (values) => Object.assign(session, values),
        remove: async (key) => { delete session[key]; }
      },
      onChanged: { addListener: () => undefined }
    },
    tabs: { create: async ({ url }) => { openedTabs.push(url); } }
  };
  globalThis.fetch = async (url) => {
    if (url === "https://github.com/login/device/code") {
      return { ok: true, json: async () => ({ device_code: "device", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }) };
    }
    if (url === "https://github.com/login/oauth/access_token") {
      tokenPolls += 1;
      return { ok: true, json: async () => tokenPolls === 1
        ? ({ error: "authorization_pending" })
        : ({ access_token: "approved-token", expires_in: 28800 }) };
    }
    if (url === "https://api.github.com/user") {
      return { ok: true, json: async () => ({ login: "octocat" }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await import(`../extension/src/background.js?auth-test=${Date.now()}`);
    const send = (message) => new Promise((resolve) => onMessage(message, {}, resolve));
    const started = await send({ type: "github-auth-start" });
    assert.equal(started.auth.status, "code");
    assert.equal(started.auth.userCode, "ABCD-EFGH");
    assert.equal(started.auth.deviceCode, undefined);

    const continued = await send({ type: "github-auth-continue" });
    assert.equal(continued.auth.status, "pending");
    assert.deepEqual(openedTabs, ["https://github.com/login/device"]);
    assert.ok(alarms.has("github-auth-poll"));

    onAlarm({ name: "github-auth-poll" });
    for (let attempt = 0; attempt < 20 && alarmCreates < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(session.githubAuthSession.status, "pending");
    assert.equal(tokenPolls, 1);
    assert.equal(alarmCreates, 2);
    assert.ok(alarms.has("github-auth-poll"));

    onAlarm({ name: "github-auth-poll" });
    for (let attempt = 0; attempt < 20 && session.githubAuthSession?.status !== "connected"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(session.githubAuthSession.status, "connected");
    assert.equal(local.githubToken, "approved-token");
    assert.equal(local.githubAccountLogin, "octocat");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
