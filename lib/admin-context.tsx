'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { AdminRole } from '@/lib/admin-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminRoleContextValue {
  /** The resolved admin role, or null while loading */
  role: AdminRole | null;
  /** True while the role is being fetched */
  loading: boolean;
  /** Convenience boolean helpers */
  isSuperAdmin: boolean;
  isFinance: boolean;
  isSupport: boolean;
  isMarketing: boolean;
  isAnalyst: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AdminRoleContext = createContext<AdminRoleContextValue>({
  role: null,
  loading: true,
  isSuperAdmin: false,
  isFinance: false,
  isSupport: false,
  isMarketing: false,
  isAnalyst: false,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AdminRoleProviderProps {
  children: ReactNode;
  /** If the role is already known server-side, pass it directly to skip the fetch */
  initialRole?: AdminRole | null;
}

export function AdminRoleProvider({
  children,
  initialRole,
}: AdminRoleProviderProps) {
  const [role, setRole] = useState<AdminRole | null>(initialRole ?? null);
  const [loading, setLoading] = useState<boolean>(!initialRole);

  useEffect(() => {
    // If an initial role was provided server-side, no need to fetch
    if (initialRole) return;

    let cancelled = false;

    async function fetchRole() {
      try {
        const res = await fetch('/api/admin/me', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch admin role');
        const data: { role: AdminRole } = await res.json();
        if (!cancelled) {
          setRole(data.role);
        }
      } catch (error) {
        console.error('[AdminRoleProvider] Failed to fetch role:', error);
        if (!cancelled) {
          setRole(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRole();
    return () => {
      cancelled = true;
    };
  }, [initialRole]);

  const value: AdminRoleContextValue = {
    role,
    loading,
    isSuperAdmin: role === 'super_admin',
    isFinance: role === 'finance' || role === 'super_admin',
    isSupport: role === 'support' || role === 'super_admin',
    isMarketing: role === 'marketing' || role === 'super_admin',
    isAnalyst: role === 'analyst' || role === 'super_admin',
  };

  return (
    <AdminRoleContext.Provider value={value}>
      {children}
    </AdminRoleContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the current admin role and convenience booleans.
 *
 * Must be used inside an `<AdminRoleProvider>`.
 */
export function useAdminRole(): AdminRoleContextValue {
  const ctx = useContext(AdminRoleContext);
  if (ctx === undefined) {
    throw new Error('useAdminRole must be used within an AdminRoleProvider');
  }
  return ctx;
}
