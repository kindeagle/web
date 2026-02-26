import { Page, BrowserContext } from 'playwright';
import { config } from '../config';
import { launchBrowser, saveAuthState } from '../utils/browser';
import { createLogger } from '../utils/logger';

const log = createLogger('spotify:auth');

/**
 * Checks whether the current session is authenticated with Spotify for Creators.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(`${config.spotify.baseUrl}/dashboard`, {
      waitUntil: 'networkidle',
    });
    const url = page.url();
    // If we stay on dashboard (not redirected to login), we're authenticated
    return url.includes('/dashboard') || url.includes('/episodes');
  } catch {
    return false;
  }
}

/**
 * Logs into Spotify for Creators using email + password.
 */
export async function loginToSpotify(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  log.info('Navigating to Spotify for Creators login...');
  await page.goto(`${config.spotify.baseUrl}/dashboard`, {
    waitUntil: 'networkidle',
  });

  // Check if already logged in
  const url = page.url();
  if (url.includes('/dashboard') && !url.includes('login')) {
    log.info('Already logged in to Spotify for Creators');
    return;
  }

  log.info('Entering Spotify credentials...');

  // Spotify login form
  const emailInput = page.locator(
    'input[id="login-username"], input[name="username"], input[type="email"], input[placeholder*="email" i]',
  );
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(config.spotify.email);

  const passwordInput = page.locator(
    'input[id="login-password"], input[name="password"], input[type="password"]',
  );
  await passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
  await passwordInput.fill(config.spotify.password);

  // Click login button
  const loginBtn = page.locator(
    'button[id="login-button"], button:has-text("Log In"), button:has-text("Sign in"), button[type="submit"]',
  ).first();
  await loginBtn.click();

  // Wait for redirect to dashboard
  await page.waitForURL(/\/(dashboard|episodes|home)/, { timeout: 30_000 });
  log.info('Successfully logged in to Spotify for Creators');

  await saveAuthState(context, 'spotify');
}

/**
 * Standalone script: run `yarn auth:spotify` to interactively log in
 * and save the auth state for future headless runs.
 */
async function main() {
  log.info('Starting Spotify for Creators authentication (visible browser)...');
  log.info('This will save your session so future runs can be headless.');

  // Force visible browser for initial auth
  process.env.HEADLESS = 'false';
  const session = await launchBrowser('spotify');

  try {
    await loginToSpotify(session.page, session.context);
    log.info('Auth state saved. You can now run the agent in headless mode.');
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Authentication failed', err);
    process.exit(1);
  });
}
