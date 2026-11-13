import type { AdminUser, AuthAdapter } from './types.js';

export interface CustomAuthOptions {
  /**
   * Return the signed-in administrator for this request, or null. Called for the
   * dashboard page and for every dashboard API request, with the visitor's
   * cookies and headers on `request`.
   */
  getUser: (request: Request) => Promise<AdminUser | null> | AdminUser | null;
  /** Where to send people who are not signed in, e.g. `/login`. */
  loginUrl?: string;
}

/** Use the site's existing login system (Auth.js, Clerk, Supabase, your own) to protect the dashboard. */
export function customAuth(options: CustomAuthOptions): AuthAdapter {
  return {
    kind: 'custom',
    configured: true,
    loginUrl: options.loginUrl,
    async getUser(request) {
      const user = await options.getUser(request);
      return user && typeof user.id === 'string' ? { id: user.id, name: user.name } : null;
    },
  };
}
