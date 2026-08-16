const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error_description || payload.error || "GitHub authorization request failed.");
  return payload;
}

function tokenCredentials(payload, now = Date.now()) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: payload.expires_in ? now + (Number(payload.expires_in) * 1000) : null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in ? now + (Number(payload.refresh_token_expires_in) * 1000) : null
  };
}

export async function requestDeviceCode(clientId, request = fetch) {
  if (!clientId?.trim()) throw new Error("Enter a GitHub OAuth App client ID first.");
  const response = await request(DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ client_id: clientId.trim(), scope: "read:user" })
  });
  return readJson(response);
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
  const response = await request(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: clientId.trim(),
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.access_token) return { status: "authorized", credentials: tokenCredentials(payload, now) };
  if (payload.error === "authorization_pending") return { status: "pending" };
  if (payload.error === "slow_down") return { status: "slow_down", intervalSeconds: Number(payload.interval) || null };
  throw new Error(payload.error_description || payload.error || `GitHub authorization failed (${response.status}).`);
}

export async function refreshGitHubToken(refreshToken, clientId, { request = fetch, now = Date.now() } = {}) {
  if (!refreshToken) throw new Error("GitHub authorization expired. Connect GitHub again.");
  const response = await request(ACCESS_TOKEN_URL, {
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
