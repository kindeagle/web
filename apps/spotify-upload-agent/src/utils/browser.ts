import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { createLogger } from './logger';

const log = createLogger('browser');

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Launches a Playwright browser with persistent auth state support.
 * Auth state is saved per-service so Descript and Spotify sessions are independent.
 */
export async function launchBrowser(
  service: 'descript' | 'spotify',
): Promise<BrowserSession> {
  const authStatePath = path.join(config.browser.authStateDir, `${service}.json`);

  log.info(`Launching browser for ${service} (headless: ${config.browser.headless})`);

  const browser = await chromium.launch({
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
  });

  // Restore saved auth state if available
  const hasAuthState = fs.existsSync(authStatePath);
  const context = await browser.newContext({
    ...(hasAuthState ? { storageState: authStatePath } : {}),
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });

  if (hasAuthState) {
    log.info(`Restored auth state for ${service} from ${authStatePath}`);
  }

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Saves the current browser auth state (cookies, localStorage) so future
 * sessions can skip the login flow.
 */
export async function saveAuthState(
  context: BrowserContext,
  service: 'descript' | 'spotify',
): Promise<void> {
  const authDir = config.browser.authStateDir;
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const authStatePath = path.join(authDir, `${service}.json`);
  await context.storageState({ path: authStatePath });
  log.info(`Saved auth state for ${service}`);
}

/**
 * Waits for a file to finish downloading by watching for the download event.
 */
export async function waitForDownload(page: Page): Promise<string> {
  const download = await page.waitForEvent('download', { timeout: 300_000 });
  const downloadPath = path.join(
    config.export.downloadDir,
    download.suggestedFilename(),
  );

  if (!fs.existsSync(config.export.downloadDir)) {
    fs.mkdirSync(config.export.downloadDir, { recursive: true });
  }

  await download.saveAs(downloadPath);
  log.info(`Downloaded file to ${downloadPath}`);
  return downloadPath;
}

/**
 * Retry helper for flaky browser interactions. Retries up to `attempts` times
 * with a short delay between each attempt.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  delayMs: number = 2000,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      log.warn(`Attempt ${i + 1} failed, retrying in ${delayMs}ms...`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Unreachable');
}
