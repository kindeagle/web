import { Page, BrowserContext } from 'playwright';
import readline from 'readline';
import { config } from '../config';
import { launchBrowser, saveAuthState } from '../utils/browser';
import { createLogger } from '../utils/logger';

const log = createLogger('spotify:auth');

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Checks whether the current session is authenticated with Spotify for Creators.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(`${config.spotify.baseUrl}/dashboard`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(5000);
    const url = page.url();
    return url.includes('/dashboard') || url.includes('/episodes');
  } catch {
    return false;
  }
}

/**
 * Logs into Spotify for Creators. In visible mode, lets the user
 * log in manually. In headless mode, uses saved auth state.
 */
export async function loginToSpotify(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  log.info('Navigating to Spotify for Creators...');
  await page.goto(`${config.spotify.baseUrl}/dashboard`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const url = page.url();
  if (url.includes('/dashboard') && !url.includes('login')) {
    log.info('Already logged in to Spotify for Creators');
    return;
  }

  // Let the user log in manually
  log.info('');
  log.info('==> Please log in to Spotify for Creators in the browser window.');
  log.info('==> Once you are on the dashboard, come back here and press Enter.');
  log.info('');
  await waitForEnter('Press Enter after you have logged in... ');

  await saveAuthState(context, 'spotify');
  log.info('Session saved.');
}

/**
 * Standalone script: run `npm run auth:spotify` to interactively log in
 * and save the auth state for future headless runs.
 */
async function main() {
  log.info('Starting Spotify for Creators authentication (visible browser)...');

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
