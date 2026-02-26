import { Page, BrowserContext } from 'playwright';
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { launchBrowser, retry } from '../utils/browser';
import { createLogger } from '../utils/logger';
import { loginToSpotify, isLoggedIn } from './auth';

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

const log = createLogger('spotify:upload');

/**
 * Adds a video file to an existing Spotify for Creators episode.
 *
 * In visible mode: prompts the user to navigate to the episode's edit page,
 * then attaches the video and saves.
 *
 * In headless mode: attempts to find the episode by title in the episodes list,
 * opens it, attaches the video, and saves.
 */
export async function addVideoToEpisode(
  page: Page,
  filePath: string,
  episodeTitle: string,
): Promise<void> {
  log.info(`Adding video to episode: "${episodeTitle}"`);
  log.info(`Video file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const screenshotDir = config.export.downloadDir;

  if (!config.browser.headless) {
    // In visible mode: user navigates to the episode edit page
    log.info('');
    log.info(`==> Episode: "${episodeTitle}"`);
    log.info('==> In the browser, find this episode and open its edit page.');
    log.info('==> Once you are on the edit page, come back here and press Enter.');
    log.info('');
    await waitForEnter('Press Enter when on the episode edit page... ');
  } else {
    // In headless mode: try to find the episode in the episodes list
    await page.goto(`${config.spotify.baseUrl}/dashboard/episodes`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(8000);

    // Look for the episode by title
    const episodeLink = page.locator(`a:has-text("${episodeTitle.replace(/"/g, '\\"')}")`).first();
    const found = await episodeLink.isVisible({ timeout: 10_000 }).catch(() => false);

    if (found) {
      await episodeLink.click();
      await page.waitForTimeout(5000);
    } else {
      log.warn(`Could not find episode "${episodeTitle}" in the list`);
      throw new Error(`Episode not found: "${episodeTitle}"`);
    }
  }

  await page.screenshot({ path: path.join(screenshotDir, '_episode-page.png'), fullPage: true }).catch(() => {});

  // Attach the video file to the existing episode
  log.info('Attaching video file...');

  const fileInput = page.locator('input[type="file"]').first();
  const inputExists = await fileInput.count().catch(() => 0);

  if (inputExists > 0) {
    await fileInput.setInputFiles(filePath);
  } else {
    // Look for an "Add video" / "Upload video" button
    log.info('No file input found, looking for video upload trigger...');
    const uploadBtn = page.locator(
      'button:has-text("Add video"), button:has-text("Upload video"), ' +
      'button:has-text("Replace video"), button:has-text("Upload"), ' +
      'button:has-text("Select a file"), button:has-text("Choose file"), ' +
      'a:has-text("Add video"), label:has-text("Upload"), ' +
      '[data-testid*="upload"], [data-testid*="video"], ' +
      '[class*="upload"], [class*="dropzone"]',
    ).first();
    await uploadBtn.click({ timeout: 15_000 });
    await page.waitForTimeout(3000);

    const hiddenInput = page.locator('input[type="file"]').first();
    await hiddenInput.setInputFiles(filePath);
  }

  log.info('Video file attached, waiting for upload to complete...');
  await page.screenshot({ path: path.join(screenshotDir, '_after-attach.png') }).catch(() => {});

  // Wait for upload progress to finish
  await page.waitForSelector(
    '[data-testid="upload-complete"], ' +
    ':text("Upload complete"), :text("uploaded"), :text("Video added"), ' +
    ':text("Processing"), :text("Replace video"), progress[value="100"]',
    { timeout: 600_000 }, // 10 minutes
  ).catch(() => {
    log.warn('No upload completion indicator detected, continuing...');
  });

  log.info('Upload appears complete');

  // Save the episode
  const saveBtn = page.locator(
    'button:has-text("Save"), button:has-text("Publish"), ' +
    'button:has-text("Update"), button[type="submit"]',
  ).first();
  const saveVisible = await saveBtn.isVisible().catch(() => false);
  if (saveVisible) {
    await saveBtn.click();
    await page.waitForTimeout(3000);
    log.info('Episode saved');
  } else {
    log.info('No save button found — changes may auto-save');
  }

  await page.screenshot({ path: path.join(screenshotDir, '_after-save.png') }).catch(() => {});
  log.info(`Video added to "${episodeTitle}" successfully`);
}

/**
 * Standalone script: run `npm run upload` to upload videos to existing episodes.
 */
async function main() {
  const session = await launchBrowser('spotify');
  try {
    if (!(await isLoggedIn(session.page))) {
      await loginToSpotify(session.page, session.context);
    }

    const files = fs.existsSync(config.export.downloadDir)
      ? fs
          .readdirSync(config.export.downloadDir)
          .filter((f) => /\.(mp4|mov)$/i.test(f))
          .map((f) => path.join(config.export.downloadDir, f))
      : [];

    if (files.length === 0) {
      log.info('No video files found to upload');
      return;
    }

    for (const filePath of files) {
      const baseName = path.basename(filePath, path.extname(filePath));
      // Strip the YouTube video ID suffix: "Title [videoId]" → "Title"
      const title = baseName.replace(/\s*\[[^\]]+\]\s*$/, '');
      await retry(() => addVideoToEpisode(session.page, filePath, title));
    }
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Upload failed', err);
    process.exit(1);
  });
}
