export interface AdminUser {
  id: string;
  name?: string;
}

export interface AuthEnv {
  /** The site secret, for signing sessions. */
  secret: string;
}

/**
 * Decides who may use the dashboard. Use `passwordAuth()` for a single shared
 * password, or `customAuth()` to defer to the site's own login (Auth.js, Clerk, …).
 */
export interface AuthAdapter {
  kind: 'password' | 'custom';
  /** False when the adapter cannot work yet (e.g. no password set); the dashboard then shows setup steps. */
  configured: boolean;
  getUser(request: Request, env: AuthEnv): Promise<AdminUser | null>;
  /** Password adapters: handle a sign-in attempt. */
  login?(request: Request, env: AuthEnv): Promise<Response>;
  logout?(request: Request, env: AuthEnv): Promise<Response>;
  /** Custom adapters: where to send someone who is not signed in. */
  loginUrl?: string;
}
