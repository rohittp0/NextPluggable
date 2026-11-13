/** An error whose message is safe and useful to show to a non-technical dashboard user. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * A plugin's stored files are gone. Normally this means it was removed (or
 * updated) on another server instance and this instance's cached list is stale.
 */
export class PluginGoneError extends Error {
  constructor(public readonly pluginId: string) {
    super(`The files of plugin "${pluginId}" are missing from storage. If it should be installed, remove it and install it again.`);
    this.name = 'PluginGoneError';
  }
}
