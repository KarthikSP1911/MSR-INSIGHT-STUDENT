export const SITE_SHUTDOWN_MESSAGE =
  "This service is temporarily paused. Sign-in and data sync are switched off.";

/**
 * On unless SITE_SHUTDOWN is explicitly "false", so a missing or mistyped value fails closed
 * rather than letting the site reach the college portal again by accident.
 */
export function isSiteShutdown(): boolean {
  return process.env.SITE_SHUTDOWN !== "false";
}

export class SiteShutdownError extends Error {
  constructor() {
    super(SITE_SHUTDOWN_MESSAGE);
    this.name = "SiteShutdownError";
  }
}
