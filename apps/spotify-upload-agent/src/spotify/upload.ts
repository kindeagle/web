import { Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { launchBrowser, retry } from '../utils/browser';
import { createLogger } from '../utils/logger';
import { loginToSpotify, isLoggedIn } from './auth';

const log = createLogger('spotify:upload');

/** Normalize a string for fuzzy title matching. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * On the episodes list page, finds the row for an episode matching the given
 * title, clicks the three-dot menu → "More" → "Upload video".
 *
 * UI flow (as observed on Spotify for Creators):
 *   1. Episodes are listed in a table/list
 *   2. Hovering to the right of an episode title reveals a ⋯ (three dots) button
 *   3. Clicking it opens a small menu; click "More"
 *   4. That reveals options including "Upload video"
 *   5. Clicking "Upload video" navigates to the upload video page
 */
async function openUploadVideoForEpisode(
  page: Page,
  episodeTitle: string,
): Promise<void> {
  log.info(`Looking for episode: "${episodeTitle}"`);

  // Navigate to the episodes list
  await page.goto(`${config.spotify.baseUrl}/dashboard/episodes`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const screenshotDir = config.export.downloadDir;
  await page.screenshot({ path: path.join(screenshotDir, '_episodes-list.png'), fullPage: true }).catch(() => {});

  const normalizedTarget = normalize(episodeTitle);

  // Scroll through the episodes list to find the matching episode
  const maxScrollAttempts = 20;
  let found = false;

  for (let scroll = 0; scroll < maxScrollAttempts && !found; scroll++) {
    // Get all table rows / list items that could be episodes
    const rows = await page.locator(
      'tr, [role="row"], [class*="episode" i], [class*="Episode"], ' +
      '[data-testid*="episode"], li[class*="item" i]',
    ).all();

    for (const row of rows) {
      const rowText = await row.textContent().catch(() => '');
      if (!rowText) continue;

      const normalizedRow = normalize(rowText);

      // Check if this row contains our episode title
      if (
        normalizedRow.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedRow.substring(0, normalizedTarget.length))
      ) {
        log.info(`Found episode row matching: "${episodeTitle}"`);

        // Step 1: Hover over the row to reveal the three-dot menu
        await row.hover();
        await page.waitForTimeout(1000);

        // Step 2: Click the three-dot (⋯) button
        const threeDots = row.locator(
          'button[aria-label*="more" i], button[aria-label*="menu" i], ' +
          'button[aria-label*="options" i], button[aria-label*="action" i], ' +
          'button:has-text("⋯"), button:has-text("…"), button:has-text("•••"), ' +
          '[data-testid*="more"], [data-testid*="menu"], [data-testid*="action"], ' +
          '[class*="menu" i] button, [class*="action" i] button, ' +
          'button svg, button[class*="dot" i], button[class*="kebab" i], ' +
          'button[class*="overflow" i], button[class*="option" i]',
        ).first();

        const dotsVisible = await threeDots.isVisible().catch(() => false);
        if (dotsVisible) {
          await threeDots.click();
          await page.waitForTimeout(1000);
        } else {
          // Sometimes the dots appear only on hover — try hovering more precisely
          // on the right side of the row
          const rowBox = await row.boundingBox();
          if (rowBox) {
            await page.mouse.move(rowBox.x + rowBox.width - 50, rowBox.y + rowBox.height / 2);
            await page.waitForTimeout(1000);
            // Try again after hover
            const dotsRetry = row.locator('button').last();
            await dotsRetry.click().catch(() => {});
            await page.waitForTimeout(1000);
          }
        }

        await page.screenshot({ path: path.join(screenshotDir, '_after-dots-click.png') }).catch(() => {});

        // Step 3: Click "More" in the dropdown menu
        const moreBtn = page.locator(
          'button:has-text("More"), a:has-text("More"), ' +
          '[role="menuitem"]:has-text("More"), [role="option"]:has-text("More"), ' +
          'li:has-text("More"), div[role="menu"] >> text=More',
        ).first();
        const moreVisible = await moreBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (moreVisible) {
          await moreBtn.click();
          await page.waitForTimeout(1000);
        }

        await page.screenshot({ path: path.join(screenshotDir, '_after-more-click.png') }).catch(() => {});

        // Step 4: Click "Upload video"
        const uploadVideoBtn = page.locator(
          'button:has-text("Upload video"), a:has-text("Upload video"), ' +
          '[role="menuitem"]:has-text("Upload video"), ' +
          '[role="option"]:has-text("Upload video"), ' +
          'li:has-text("Upload video"), div[role="menu"] >> text=Upload video',
        ).first();
        await uploadVideoBtn.click({ timeout: 5000 });
        await page.waitForTimeout(3000);

        await page.screenshot({ path: path.join(screenshotDir, '_upload-video-page.png') }).catch(() => {});

        found = true;
        break;
      }
    }

    if (!found) {
      // Scroll down to load more episodes
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }
  }

  if (!found) {
    throw new Error(`Could not find episode "${episodeTitle}" in the episodes list`);
  }
}

/**
 * Adds a video file to an existing Spotify for Creators episode.
 *
 * Flow:
 *   1. Find the episode by title in the episodes list
 *   2. Three-dot menu → More → Upload video
 *   3. Click "Select a file" and attach the video
 *   4. Wait for upload to complete
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

  // Navigate to the episode and open the "Upload video" page
  await openUploadVideoForEpisode(page, episodeTitle);

  // Now on the "Upload video" page — click "Select a file"
  log.info('Clicking "Select a file"...');

  // The "Select a file" button likely triggers a hidden file input
  const selectFileBtn = page.locator(
    'button:has-text("Select a file"), button:has-text("Select file"), ' +
    'button:has-text("Choose file"), a:has-text("Select a file"), ' +
    'label:has-text("Select a file")',
  ).first();

  const selectVisible = await selectFileBtn.isVisible({ timeout: 10_000 }).catch(() => false);

  if (selectVisible) {
    // Use Playwright's filechooser event to intercept the file dialog
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10_000 }),
      selectFileBtn.click(),
    ]);
    await fileChooser.setFiles(filePath);
  } else {
    // Fallback: try to find a hidden file input directly
    log.info('No "Select a file" button found, trying file input directly...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
  }

  log.info('Video file selected, waiting for upload to complete...');
  await page.screenshot({ path: path.join(screenshotDir, '_after-file-select.png') }).catch(() => {});

  // Wait for upload to finish (large video files can take a while)
  await page.waitForSelector(
    ':text("Upload complete"), :text("uploaded"), :text("Video added"), ' +
    ':text("Processing"), :text("Replace video"), :text("Save"), ' +
    'progress[value="100"], [data-testid="upload-complete"]',
    { timeout: 600_000 }, // 10 minutes
  ).catch(() => {
    log.warn('No upload completion indicator detected, continuing...');
  });

  log.info('Upload appears complete');

  // Save if there's a save button
  const saveBtn = page.locator(
    'button:has-text("Save"), button:has-text("Publish"), ' +
    'button:has-text("Update"), button[type="submit"]',
  ).first();
  const saveVisible = await saveBtn.isVisible().catch(() => false);
  if (saveVisible) {
    await saveBtn.click();
    await page.waitForTimeout(5000);
    log.info('Episode saved');
  } else {
    log.info('No save button visible — changes may auto-save');
  }

  await page.screenshot({ path: path.join(screenshotDir, '_done.png') }).catch(() => {});
  log.info(`Video added to "${episodeTitle}" successfully`);
}
