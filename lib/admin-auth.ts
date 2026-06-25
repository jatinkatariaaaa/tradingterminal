import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminRole =
  | 'super_admin'
  | 'finance'
  | 'support'
  | 'marketing'
  | 'analyst';

export interface AdminUser {
  user: { id: string; email?: string };
  role: AdminRole;
  email: string;
}

export interface AuditLogParams {
  adminId: string;
  adminEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  request?: Request;
}

// ---------------------------------------------------------------------------
// Custom error for admin auth failures
// ---------------------------------------------------------------------------

export class AdminAuthError extends Error {
  status: number;

  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AdminAuthError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// getAdminUser
// ---------------------------------------------------------------------------
/**
 * Extracts the authenticated user from cookies, verifies they have an admin
 * role in the `admin_roles` table, and falls back to `profiles.is_admin` for
 * backwards compatibility.
 *
 * Returns `{ user, role, email }` on success or throws `AdminAuthError`.
 */
export async function getAdminUser(): Promise<AdminUser> {
  // 1. Resolve the session from cookies
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new AdminAuthError('Not authenticated', 401);
  }

  // 2. Check admin_roles table (service client bypasses RLS)
  const supabaseAdmin = createSupabaseServiceClient();

  const { data: adminRole } = await supabaseAdmin
    .from('admin_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (adminRole?.role) {
    return {
      user: { id: user.id, email: user.email },
      role: adminRole.role as AdminRole,
      email: user.email ?? '',
    };
  }

  // 3. Fallback: check profiles.is_admin for backwards compatibility
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profile?.is_admin) {
    return {
      user: { id: user.id, email: user.email },
      role: 'super_admin',
      email: user.email ?? '',
    };
  }

  throw new AdminAuthError('Insufficient permissions – admin role required', 403);
}

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------
/**
 * Calls `getAdminUser`, then verifies the resolved role is in the provided
 * allow-list. Throws `AdminAuthError` if the role is not permitted.
 *
 * Usage:
 * ```ts
 * const admin = await requireRole(['super_admin', 'finance']);
 * ```
 */
export async function requireRole(roles: AdminRole[]): Promise<AdminUser> {
  const admin = await getAdminUser();

  if (!roles.includes(admin.role)) {
    throw new AdminAuthError(
      `Role "${admin.role}" is not authorized for this action. Required: ${roles.join(', ')}`,
      403,
    );
  }

  return admin;
}

// ---------------------------------------------------------------------------
// logAudit
// ---------------------------------------------------------------------------
/**
 * Inserts a row into the `audit_logs` table. Extracts IP address and
 * user-agent from the incoming request headers when available.
 *
 * Failures are logged to the console but never thrown – audit logging should
 * never block the primary operation.
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  const {
    adminId,
    adminEmail,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    request,
  } = params;

  // Extract metadata from the request when available
  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  if (request) {
    // Vercel / Cloudflare forward real IP via these headers
    ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null;
    userAgent = request.headers.get('user-agent') ?? null;
  }

  try {
    const supabaseAdmin = createSupabaseServiceClient();

    await supabaseAdmin.from('audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    // Never let audit failures propagate – log and move on
    console.error('[audit_logs] Failed to write audit log:', error);
  }
}

// ---------------------------------------------------------------------------
// Helper: wrap admin route handlers with automatic auth + error handling
// ---------------------------------------------------------------------------
/**
 * Convenience wrapper for admin API route handlers. Catches `AdminAuthError`
 * and returns the appropriate JSON error response.
 *
 * Usage:
 * ```ts
 * export const GET = withAdminAuth(async (admin, request) => {
 *   // admin is AdminUser
 *   return NextResponse.json({ ok: true });
 * });
 * ```
 */
export function withAdminAuth(
  handler: (admin: AdminUser, request: Request) => Promise<NextResponse>,
  allowedRoles?: AdminRole[],
) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      const admin = allowedRoles
        ? await requireRole(allowedRoles)
        : await getAdminUser();

      return await handler(admin, request);
    } catch (error) {
      if (error instanceof AdminAuthError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      }
      console.error('[admin-auth] Unhandled error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}
