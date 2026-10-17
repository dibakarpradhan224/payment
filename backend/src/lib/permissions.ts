export type Role = 'SUPER_ADMIN' | 'FINANCE_ADMIN' | 'SUPPORT_ADMIN' | 'READ_ONLY';
export type Perm =
  | 'users:read' | 'users:write' | 'tx:read' | 'deposits:write' | 'withdrawals:write' | 'refunds:write'
  | 'reconcile:write' | 'settings:read' | 'settings:write' | 'analytics:read' | 'audit:read' | 'admins:write' | 'api:write';

const READ: Perm[] = ['users:read', 'tx:read', 'analytics:read', 'audit:read'];
export const ROLE_PERMS: Record<Role, Perm[] | '*'> = {
  SUPER_ADMIN: '*',
  FINANCE_ADMIN: [...READ, 'deposits:write', 'withdrawals:write', 'refunds:write', 'reconcile:write', 'settings:read'],
  SUPPORT_ADMIN: [...READ, 'users:write', 'api:write'],
  READ_ONLY: READ,
};
export const can = (role: Role, perm: Perm) => ROLE_PERMS[role] === '*' || (ROLE_PERMS[role] as Perm[]).includes(perm);
