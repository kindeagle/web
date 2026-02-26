import { Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { launchBrowser, waitForDownload, retry } from '../utils/browser';
import { createLogger } from '../utils/logger';
import { loginToDescript, isLoggedIn } from './auth';

const log = createLogger('descript:download');

export interface DescriptEpisode {
  /** The name of the composition/episode as shown in Descript */
  name: string;
  /** URL to the project in Descript web */
  url: string;
}

/**
 * Navigates to the Descript project (e.g. "Podiatry Marketing") and returns
 * a list of compositions (episodes) found inside it.
 */
export async function listEpisodes(page: Page): Promise<DescriptEpisode[]> {
  log.info(`Looking for project: "${config.descript.projectName}"...`);

  // Navigate to the drive / projects page
  await page.goto(`${config.descript.baseUrl}/drive`, { waitUntil: 'networkidle' });

  // Click into the target project folder
  const projectLink = page.locator(
    `[data-testid="project-name"]:has-text("${config.descript.projectName}"), ` +
    `a:has-text("${config.descript.projectName}"), ` +
    `div[role="button"]:has-text("${config.descript.projectName}"), ` +
    `span:has-text("${config.descript.projectName}")`,
  ).first();

  await projectLink.waitFor({ state: 'visible', timeout: 15_000 });
  await projectLink.click();
  await page.waitForLoadState('networkidle');

  log.info('Entered project, scanning for compositions...');

  // Gather all composition / episode entries visible in the project
  // Descript shows compositions as cards or list items
  const compositionLocators = page.locator(
    '[data-testid="composition-item"], ' +
    '[class*="composition"], ' +
    '[class*="CompositionCard"], ' +
    '[role="listitem"]',
  );

  await compositionLocators.first().waitFor({ state: 'visible', timeout: 15_000 });
  const count = await compositionLocators.count();

  const episodes: DescriptEpisode[] = [];
  for (let i = 0; i < count; i++) {
    const el = compositionLocators.nth(i);
    const name = await el.innerText();
    // Try to extract the href, fall back to a placeholder
    const link = await el.locator('a').first().getAttribute('href').catch(() => null);
    episodes.push({
      name: name.trim().split('\n')[0], // First line is typically the title
      url: link ? new URL(link, config.descript.baseUrl).href : page.url(),
    });
  }

  log.info(`Found ${episodes.length} episode(s) in "${config.descript.projectName}"`);
  return episodes;
}

/**
 * Downloads a single episode as an MP4 video from Descript.
 * Uses the Descript web UI export flow:
 *   1. Open the composition
 *   2. Click File > Export (or the export button)
 *   3. Select video format + quality
 *   4. Wait for render + download
 *
 * Returns the local file path of the downloaded video.
 */
export async function downloadEpisode(
  page: Page,
  episode: DescriptEpisode,
): Promise<string> {
  log.info(`Downloading episode: "${episode.name}"...`);

  // Navigate to the episode's composition
  await page.goto(episode.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Let the editor fully load

  // Open the export dialog via the Share/Export button or File menu
  // Strategy 1: Look for an Export button in the toolbar
  const exportBtn = page.locator(
    'button:has-text("Export"), button:has-text("Share"), ' +
    '[data-testid="export-button"], [aria-label="Export"]',
  ).first();

  const exportBtnVisible = await exportBtn.isVisible().catch(() => false);

  if (exportBtnVisible) {
    await exportBtn.click();
  } else {
    // Strategy 2: Use the File menu
    log.info('Export button not found directly, trying File menu...');
    const fileMenu = page.locator('button:has-text("File"), [data-testid="file-menu"]').first();
    await fileMenu.click();
    await page.locator('text=Export').first().click();
  }

  await page.waitForTimeout(1000);

  // Select video export format
  const videoOption = page.locator(
    'button:has-text("Video"), [data-testid="export-video"], ' +
    'label:has-text("Video"), div[role="tab"]:has-text("Video")',
  ).first();
  const videoOptionVisible = await videoOption.isVisible().catch(() => false);
  if (videoOptionVisible) {
    await videoOption.click();
    await page.waitForTimeout(500);
  }

  // Select quality if a dropdown or option exists
  if (config.export.quality === 'high') {
    const qualitySelector = page.locator(
      'select:near(:text("Quality")), [data-testid="quality-select"]',
    ).first();
    const qualityVisible = await qualitySelector.isVisible().catch(() => false);
    if (qualityVisible) {
      await qualitySelector.selectOption({ label: /high/i.source });
    }
  }

  // Click the final Export / Download button
  const finalExportBtn = page.locator(
    'button:has-text("Export"), button:has-text("Download"), ' +
    '[data-testid="export-submit"], [data-testid="download-button"]',
  ).last();
  await finalExportBtn.click();

  log.info('Export started, waiting for render and download...');

  // Wait for the file to download (rendering may take several minutes)
  const filePath = await waitForDownload(page);

  log.info(`Episode "${episode.name}" downloaded to: ${filePath}`);
  return filePath;
}

/**
 * Downloads all episodes from the Descript project that haven't been
 * downloaded yet (checks the downloads directory for existing files).
 */
export async function downloadNewEpisodes(
  page: Page,
  context: BrowserContext,
): Promise<{ episode: DescriptEpisode; filePath: string }[]> {
  // Ensure we're logged in
  if (!(await isLoggedIn(page))) {
    await loginToDescript(page, context);
  }

  const episodes = await listEpisodes(page);
  const results: { episode: DescriptEpisode; filePath: string }[] = [];

  // Check which episodes already exist in the download directory
  const existingFiles = fs.existsSync(config.export.downloadDir)
    ? new Set(fs.readdirSync(config.export.downloadDir).map((f) => f.toLowerCase()))
    : new Set<string>();

  for (const episode of episodes) {
    const sanitizedName = episode.name.replace(/[^a-zA-Z0-9_\- ]/g, '').toLowerCase();
    const alreadyDownloaded = [...existingFiles].some((f) =>
      f.includes(sanitizedName),
    );

    if (alreadyDownloaded) {
      log.info(`Skipping "${episode.name}" (already downloaded)`);
      continue;
    }

    try {
      const filePath = await retry(() => downloadEpisode(page, episode));
      results.push({ episode, filePath });
    } catch (err) {
      log.error(`Failed to download "${episode.name}"`, err);
    }
  }

  log.info(`Downloaded ${results.length} new episode(s)`);
  return results;
}

/**
 * Standalone script: run `yarn download` to download episodes from Descript.
 */
async function main() {
  const session = await launchBrowser('descript');
  try {
    const results = await downloadNewEpisodes(session.page, session.context);
    for (const { episode, filePath } of results) {
      log.info(`✓ ${episode.name} → ${filePath}`);
    }
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Download failed', err);
    process.exit(1);
  });
}
