/**
 * Shared auth for terminal admin API endpoints (called by the TPP CRM).
 *
 * SECURITY: The key MUST come from the ADMIN_API_KEY environment variable.
 * Never hardcode keys or provide fallback values — a leaked/guessable
 * fallback lets anyone create or disable trading accounts.
 */

export function getAdminApiKey(): string | null {
  const key = process.env.ADMIN_API_KEY;
  if (!key || key.trim() === "") {
    console.error(
      "[admin-api-auth] ADMIN_API_KEY is not set — admin endpoints are disabled until it is configured."
    );
    return null;
  }
  return key;
}

/** Constant-time comparison to avoid trivial timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validates the request's API key from `x-api-key` or `Authorization: Bearer`.
 * Returns true only when ADMIN_API_KEY is configured and matches.
 */
export function isAuthorizedAdminRequest(request: Request): boolean {
  const adminKey = getAdminApiKey();
  if (!adminKey) return false;

  const apiKeyHeader = request.headers.get("x-api-key");
  const bearerToken = request.headers.get("Authorization")?.replace("Bearer ", "");
  const providedKey = apiKeyHeader || bearerToken;

  if (!providedKey) return false;
  return safeEqual(providedKey, adminKey);
}
