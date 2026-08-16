const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const REQUEST_TIMEOUT_MS = 15_000;

export class GitHubAuthError extends Error {
  constructor(message, { code = "github_auth_error", retryable = false, status = null } = {}) {
    super(message);
    this.name = "GitHubAuthError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function requestWithTimeout(request, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await request(url, { ...options, signal: controller.signal });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw new GitHubAuthError(
      timedOut ? "GitHub did not respond in time." : "GitHub could not be reached.",
      { code: timedOut ? "timeout" : "network_error", retryable: true }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    throw new GitHubAuthError("GitHub returned an unreadable response.", {
      code: "invalid_response",
      retryable: true,
      status: response.status || null
    });
  }
}

async function readJson(response) {
  const payload = await readPayload(response);
  if (!response.ok || payload.error) {
    const status = Number(response.status) || null;
    throw new GitHubAuthError(payload.error_description || payload.error || "GitHub authorization request failed.", {
      code: payload.error || "http_error",
      retryable: status === 429 || status >= 500,
      status
    });
  }
  return payload;
}

function tokenCredentials(payload, now = Date.now()) {
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("GitHub authorization returned an invalid access token.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: payload.expires_in ? now + (Number(payload.expires_in) * 1000) : null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in ? now + (Number(payload.refresh_token_expires_in) * 1000) : null
  };
}

function deviceAuthorization(payload) {
  if (typeof payload.device_code !== "string" || !payload.device_code || typeof payload.user_code !== "string" || !payload.user_code) {
    throw new Error("GitHub authorization returned an invalid device code.");
  }
  let verificationUrl;
  try { verificationUrl = new URL(payload.verification_uri); } catch { throw new Error("GitHub authorization returned an invalid verification URL."); }
  if (verificationUrl.protocol !== "https:" || verificationUrl.hostname !== "github.com" || verificationUrl.pathname !== "/login/device") {
    throw new Error("GitHub authorization returned an untrusted verification URL.");
  }
  return {
    ...payload,
    verification_uri: verificationUrl.toString(),
    expires_in: Math.max(1, Number(payload.expires_in) || 900),
    interval: Math.max(5, Number(payload.interval) || 5)
  };
}

export async function requestDeviceCode(clientId, request = fetch) {
  if (!clientId?.trim()) throw new Error("Enter a GitHub OAuth App client ID first.");
  const response = await requestWithTimeout(request, DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ client_id: clientId.trim(), scope: "read:user" })
  });
  return deviceAuthorization(await readJson(response));
}

export async function pollForGitHubToken(device, clientId, { request = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let intervalSeconds = Math.max(5, Number(device.interval) || 5);
  let elapsedSeconds = 0;
  const expiresIn = Number(device.expires_in) || 900;
  while (elapsedSeconds < expiresIn) {
    await sleep(intervalSeconds * 1000);
    elapsedSeconds += intervalSeconds;
    const result = await pollGitHubTokenOnce(device.device_code, clientId, { request });
    if (result.status === "authorized") return result.credentials;
    if (result.status === "slow_down") intervalSeconds = Math.max(intervalSeconds + 5, result.intervalSeconds || 0);
  }
  throw new Error("GitHub sign-in timed out. Start the connection again.");
}

export async function pollGitHubTokenOnce(deviceCode, clientId, { request = fetch, now = Date.now() } = {}) {
  const response = await requestWithTimeout(request, ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: clientId.trim(),
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });
  const payload = await readPayload(response);
  if (payload.access_token) return { status: "authorized", credentials: tokenCredentials(payload, now) };
  if (payload.error === "authorization_pending") return { status: "pending" };
  if (payload.error === "slow_down") return { status: "slow_down", intervalSeconds: Number(payload.interval) || null };
  const status = Number(response.status) || null;
  throw new GitHubAuthError(payload.error_description || payload.error || `GitHub authorization failed (${response.status}).`, {
    code: payload.error || "http_error",
    retryable: status === 429 || status >= 500,
    status
  });
}

export async function refreshGitHubToken(refreshToken, clientId, { request = fetch, now = Date.now() } = {}) {
  if (!refreshToken) throw new Error("GitHub authorization expired. Connect GitHub again.");
  const response = await requestWithTimeout(request, ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: clientId.trim(),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  return tokenCredentials(await readJson(response), now);
}
