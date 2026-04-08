let cachedToken: string | null = null;
let expiresOn: number | null = null;

export async function getMultisetToken(): Promise<string> {
  const clientId = process.env.MULTISET_CLIENT_ID?.trim();
  const clientSecret = process.env.MULTISET_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("MULTISET_CLIENT_ID and MULTISET_CLIENT_SECRET must be set");
  }

  const now = Date.now();
  if (cachedToken && expiresOn && now < expiresOn - 120_000) {
    return cachedToken;
  }

  // Match @multisetai/vps MultisetClient.authorize(): POST with empty body, HTTP Basic only.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.multiset.ai/v1/m2m/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Multiset token: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { token?: string; access_token?: string; expiresOn?: string };
  const token = data.token ?? data.access_token;
  if (!token) {
    throw new Error("Multiset token response missing token or access_token");
  }
  cachedToken = token;
  expiresOn = data.expiresOn ? new Date(data.expiresOn).getTime() : now + 25 * 60_000;
  return cachedToken;
}
