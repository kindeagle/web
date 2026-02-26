import { Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { launchBrowser, retry } from '../utils/browser';
import { createLogger } from '../utils/logger';
import { loginToSpotify, isLoggedIn } from './auth';

const log = createLogger('spotify:upload');

export interface EpisodeMetadata {
  /** Episode title */
  title: string;
  /** Episode description */
  description: string;
  /** Season number (optional) */
  season?: number;
  /** Episode number (optional) */
  episodeNumber?: number;
  /** Whether to publish immediately or save as draft */
  publishImmediately: boolean;
}

/**
 * Extracts episode metadata from the filename and an optional sidecar JSON.
 *
 * Convention: if `episode.mp4` has a matching `episode.json` next to it,
 * that JSON is used for title, description, etc. Otherwise sensible
 * defaults are generated from the filename.
 */
export function getEpisodeMetadata(filePath: string): EpisodeMetadata {
  const baseName = path.basename(filePath, path.extname(filePath));
  const jsonPath = path.join(path.dirname(filePath), `${baseName}.json`);

  if (fs.existsSync(jsonPath)) {
    log.info(`Loading metadata from ${jsonPath}`);
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return {
      title: raw.title ?? baseName,
      description: raw.description ?? '',
      season: raw.season,
      episodeNumber: raw.episodeNumber,
      publishImmediately: raw.publishImmediately ?? false,
    };
  }

  // Generate from filename: "EP03 - Patient Retention Tips" → title
  const titleMatch = baseName.match(/^(?:EP?\s*\d+\s*[-–—]\s*)?(.+)$/i);
  const title = titleMatch ? titleMatch[1].trim() : baseName;

  // Try to extract episode number from filename
  const epMatch = baseName.match(/EP?\s*(\d+)/i);
  const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : undefined;

  return {
    title,
    description: title,
    episodeNumber,
    publishImmediately: false, // Default to draft for safety
  };
}

/**
 * Uploads a video episode to Spotify for Creators through the web UI.
 *
 * Flow:
 *   1. Navigate to the new episode page
 *   2. Upload the video file
 *   3. Fill in title, description, and other metadata
 *   4. Either publish or save as draft
 */
export async function uploadEpisode(
  page: Page,
  filePath: string,
  metadata: EpisodeMetadata,
): Promise<void> {
  log.info(`Uploading episode: "${metadata.title}" from ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Navigate to the new episode creation page
  await page.goto(`${config.spotify.baseUrl}/dashboard/episodes/new`, {
    waitUntil: 'domcontentloaded',
  });
  // Wait for the SPA to finish rendering
  await page.waitForTimeout(10_000);

  // -- Step 1: Upload the video file --
  log.info('Uploading video file...');

  // Spotify for Creators uses a file input that may be hidden.
  // Playwright can set files on hidden inputs directly via setInputFiles.
  const fileInput = page.locator('input[type="file"]').first();
  const inputExists = await fileInput.count().catch(() => 0);

  if (inputExists > 0) {
    // Force-set files even if hidden — Playwright handles this
    await fileInput.setInputFiles(filePath);
  } else {
    // No file input in DOM yet — click an upload button to trigger it
    const uploadBtn = page.locator(
      'button:has-text("Upload"), button:has-text("Select a file"), ' +
      'button:has-text("Choose file"), button:has-text("Select file"), ' +
      'button:has-text("Add episode"), button:has-text("Add video"), ' +
      '[data-testid*="upload"], [role="button"]:has-text("Upload"), ' +
      'a:has-text("Upload"), label:has-text("Upload")',
    ).first();
    await uploadBtn.click({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Now look for the file input that should have appeared
    const hiddenInput = page.locator('input[type="file"]').first();
    await hiddenInput.setInputFiles(filePath);
  }

  // Take a screenshot for debugging
  const screenshotDir = config.export.downloadDir;
  await page.screenshot({ path: path.join(screenshotDir, '_last-upload.png') }).catch(() => {});

  // Wait for the upload to complete (can take a while for large video files)
  log.info('Waiting for upload to complete...');
  await page.waitForSelector(
    '[data-testid="upload-complete"], ' +
    ':text("Upload complete"), :text("uploaded"), ' +
    ':text("Processing"), progress[value="100"]',
    { timeout: 600_000 }, // 10 minutes for large files
  );
  log.info('Upload complete');

  // -- Step 2: Fill in episode metadata --
  log.info('Filling in episode metadata...');

  // Title field
  const titleInput = page.locator(
    'input[name="title"], input[placeholder*="title" i], ' +
    '[data-testid="episode-title"], input[aria-label*="title" i]',
  ).first();
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
  await titleInput.fill(metadata.title);

  // Description field
  const descInput = page.locator(
    'textarea[name="description"], [contenteditable="true"], ' +
    'textarea[placeholder*="description" i], [data-testid="episode-description"]',
  ).first();
  const descVisible = await descInput.isVisible().catch(() => false);
  if (descVisible) {
    await descInput.fill(metadata.description);
  }

  // Episode number (if available and field exists)
  if (metadata.episodeNumber !== undefined) {
    const epNumInput = page.locator(
      'input[name*="episode" i][name*="number" i], ' +
      'input[placeholder*="episode number" i], ' +
      '[data-testid="episode-number"]',
    ).first();
    const epNumVisible = await epNumInput.isVisible().catch(() => false);
    if (epNumVisible) {
      await epNumInput.fill(String(metadata.episodeNumber));
    }
  }

  // Season number (if available and field exists)
  if (metadata.season !== undefined) {
    const seasonInput = page.locator(
      'input[name*="season" i], input[placeholder*="season" i], ' +
      '[data-testid="season-number"]',
    ).first();
    const seasonVisible = await seasonInput.isVisible().catch(() => false);
    if (seasonVisible) {
      await seasonInput.fill(String(metadata.season));
    }
  }

  // -- Step 3: Publish or save as draft --
  if (metadata.publishImmediately) {
    log.info('Publishing episode...');
    const publishBtn = page.locator(
      'button:has-text("Publish"), button:has-text("Submit"), ' +
      '[data-testid="publish-button"]',
    ).first();
    await publishBtn.click();
  } else {
    log.info('Saving as draft...');
    const draftBtn = page.locator(
      'button:has-text("Save as draft"), button:has-text("Save draft"), ' +
      'button:has-text("Draft"), [data-testid="save-draft"]',
    ).first();
    const draftVisible = await draftBtn.isVisible().catch(() => false);
    if (draftVisible) {
      await draftBtn.click();
    } else {
      // If no explicit draft button, try the primary save/submit
      const saveBtn = page.locator(
        'button:has-text("Save"), button:has-text("Submit"), button[type="submit"]',
      ).first();
      await saveBtn.click();
    }
  }

  // Wait for confirmation
  await page.waitForSelector(
    ':text("saved"), :text("published"), :text("success"), ' +
    '[data-testid="success-message"]',
    { timeout: 30_000 },
  ).catch(() => {
    log.warn('No explicit success confirmation detected, checking URL...');
  });

  // Verify by checking we redirected away from the /new page
  const finalUrl = page.url();
  if (finalUrl.includes('/new')) {
    log.warn('May still be on the new episode page - check for errors');
  } else {
    log.info(`Episode "${metadata.title}" saved successfully`);
  }
}

/**
 * Uploads all video files from the downloads directory that haven't been
 * uploaded yet. Tracks uploaded files via a manifest file.
 */
export async function uploadNewEpisodes(
  page: Page,
  context: BrowserContext,
  filePaths?: string[],
): Promise<string[]> {
  // Ensure we're logged in
  if (!(await isLoggedIn(page))) {
    await loginToSpotify(page, context);
  }

  // Determine which files to upload
  const files =
    filePaths ??
    (fs.existsSync(config.export.downloadDir)
      ? fs
          .readdirSync(config.export.downloadDir)
          .filter((f) => /\.(mp4|mov)$/i.test(f))
          .map((f) => path.join(config.export.downloadDir, f))
      : []);

  if (files.length === 0) {
    log.info('No video files found to upload');
    return [];
  }

  // Load the manifest of already-uploaded files
  const manifestPath = path.join(config.export.downloadDir, '.uploaded-manifest.json');
  const manifest: Set<string> = fs.existsSync(manifestPath)
    ? new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
    : new Set();

  const uploaded: string[] = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    if (manifest.has(fileName)) {
      log.info(`Skipping "${fileName}" (already uploaded)`);
      continue;
    }

    const metadata = getEpisodeMetadata(filePath);

    try {
      await retry(() => uploadEpisode(page, filePath, metadata));
      manifest.add(fileName);
      // Persist manifest after each successful upload
      fs.writeFileSync(manifestPath, JSON.stringify([...manifest], null, 2));
      uploaded.push(filePath);
    } catch (err) {
      log.error(`Failed to upload "${fileName}"`, err);
    }
  }

  log.info(`Uploaded ${uploaded.length} new episode(s) to Spotify for Creators`);
  return uploaded;
}

/**
 * Standalone script: run `yarn upload` to upload episodes to Spotify.
 */
async function main() {
  const session = await launchBrowser('spotify');
  try {
    const uploaded = await uploadNewEpisodes(session.page, session.context);
    for (const f of uploaded) {
      log.info(`✓ Uploaded: ${path.basename(f)}`);
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
