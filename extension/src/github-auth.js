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

export async function requestDeviceCode(clientId, request = fetch) {
  if (!clientId?.trim()) throw new Error("Enter a GitHub OAuth App client ID first.");
  const response = await request(DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ client_id: clientId.trim(), scope: "user" })
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
    const response = await request(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: clientId.trim(),
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.access_token) return payload.access_token;
    if (payload.error === "authorization_pending") continue;
    if (payload.error === "slow_down") { intervalSeconds += 5; continue; }
    throw new Error(payload.error_description || payload.error || `GitHub authorization failed (${response.status}).`);
  }
  throw new Error("GitHub sign-in timed out. Start the connection again.");
}
