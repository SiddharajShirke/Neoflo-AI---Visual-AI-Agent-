/** MV3 control-plane permissions. Browser-content capabilities are intentionally absent. */
export const extensionName = 'Visual AI Browser Agent';
export const permissions = ['storage', 'alarms', 'webNavigation'] as const;

function exactHostPermission(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('A public HTTPS or HTTP URL is required.');
  return `${url.protocol}//${url.host}/*`;
}

export const hostPermissions = [
  exactHostPermission(process.env.VITE_API_BASE_URL ?? 'http://localhost:8000'),
  exactHostPermission(process.env.VITE_SUPABASE_URL ?? 'https://your-project.supabase.co')
] as const;

export const manifestControlPlane = {
  permissions: [...permissions],
  host_permissions: [...hostPermissions],
  incognito: 'not_allowed' as const
};
