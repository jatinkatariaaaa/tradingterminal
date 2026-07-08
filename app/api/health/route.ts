import { NextResponse } from "next/server";
import { isAuthorizedAdminRequest, getAdminApiKey } from "@/lib/admin-api-auth";

export const dynamic = "force-dynamic";

/**
 * Health endpoint used by the TPP CRM ("Test Connection" in Admin > Trading > Platforms).
 * - Returns 200 when the server is up and the provided API key is valid.
 * - Returns 401 when the API key is missing/invalid, so the CRM can surface
 *   "Invalid API Key (Unauthorized)" instead of a false positive.
 */
export async function GET(request: Request) {
  if (!getAdminApiKey()) {
    return NextResponse.json(
      { status: "error", message: "ADMIN_API_KEY not configured on terminal" },
      { status: 503 }
    );
  }

  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    status: "ok",
    service: "tpp-trading-terminal",
    timestamp: new Date().toISOString(),
  });
}
