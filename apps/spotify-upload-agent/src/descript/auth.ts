import { Page, BrowserContext } from 'playwright';
import { config } from '../config';
import { launchBrowser, saveAuthState } from '../utils/browser';
import { createLogger } from '../utils/logger';

const log = createLogger('descript:auth');

/**
 * Checks whether the current page session is already authenticated with Descript.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(config.descript.baseUrl, { waitUntil: 'networkidle' });
    // If we land on the dashboard / drive page, we are logged in
    const url = page.url();
    return url.includes('/drive') || url.includes('/projects') || url.includes('/home');
  } catch {
    return false;
  }
}

/**
 * Logs into Descript using email + password through the web UI.
 * Handles the Google OAuth flow if the login page redirects there.
 */
export async function loginToDescript(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  log.info('Navigating to Descript login...');
  await page.goto(`${config.descript.baseUrl}/login`, { waitUntil: 'networkidle' });

  // Check if already logged in
  if (page.url().includes('/drive') || page.url().includes('/home')) {
    log.info('Already logged in to Descript');
    return;
  }

  log.info('Entering credentials...');

  // Descript login form: email field
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(config.descript.email);

  // Click continue / next if there is a two-step form
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').first();
  await continueBtn.click();

  // Password field (may appear after clicking continue)
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
  await passwordInput.fill(config.descript.password);

  // Submit login
  const loginBtn = page.locator('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]').first();
  await loginBtn.click();

  // Wait for navigation to the dashboard
  await page.waitForURL(/\/(drive|projects|home)/, { timeout: 30_000 });
  log.info('Successfully logged in to Descript');

  // Save auth state for future runs
  await saveAuthState(context, 'descript');
}

/**
 * Standalone script: run `yarn auth:descript` to interactively log in
 * and save the auth state for future headless runs.
 */
async function main() {
  log.info('Starting Descript authentication (visible browser)...');
  log.info('This will save your session so future runs can be headless.');

  const session = await launchBrowser('descript');

  try {
    await loginToDescript(session.page, session.context);
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
