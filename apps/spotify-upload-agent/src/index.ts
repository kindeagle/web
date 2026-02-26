import fs from 'fs';
import path from 'path';
import { config } from './config';
import { launchBrowser, retry } from './utils/browser';
import { createLogger } from './utils/logger';
import { listVideos, downloadVideo } from './youtube/download';
import { uploadEpisode, getEpisodeMetadata } from './spotify/upload';
import { loginToSpotify, isLoggedIn } from './spotify/auth';

const log = createLogger('agent');

/**
 * Main orchestrator: for each new YouTube video, downloads it, uploads it
 * to Spotify for Creators, then deletes the local file to save disk space.
 */
async function main() {
  log.info('=== Spotify Upload Agent ===');
  log.info(`YouTube source: ${config.youtube.url}`);
  log.info('Mode: download → upload → delete (one at a time)');
  log.info('');

  // Single manifest tracking video IDs that have been fully processed
  const downloadDir = config.export.downloadDir;
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  const manifestPath = path.join(downloadDir, '.processed-manifest.json');
  const processed: Set<string> = fs.existsSync(manifestPath)
    ? new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
    : new Set();

  // Fetch the full video list from YouTube
  const videos = await listVideos(config.youtube.url);
  const newVideos = videos.filter((v) => !processed.has(v.id));

  if (newVideos.length === 0) {
    log.info('No new videos to process');
    return;
  }

  log.info(`${newVideos.length} new video(s) to process (${videos.length} total on channel)`);

  // Launch browser once for all uploads
  const spotifySession = await launchBrowser('spotify');

  try {
    // In visible mode, the user handles login + navigation manually via prompts.
    // In headless mode, rely on saved auth state.
    if (config.browser.headless) {
      if (!(await isLoggedIn(spotifySession.page))) {
        log.error('Not logged in. Run with HEADLESS=false first to save a session.');
        process.exit(1);
      }
    }

    let successCount = 0;

    for (const { id, title } of newVideos) {
      log.info('');
      log.info(`--- Processing: "${title}" (${id}) ---`);
      let filePath: string | undefined;

      try {
        // Step 1: Download from YouTube
        filePath = await downloadVideo(id, title);

        // Step 2: Upload to Spotify
        const metadata = getEpisodeMetadata(filePath);
        await retry(() => uploadEpisode(spotifySession.page, filePath!, metadata));

        // Step 3: Mark as processed
        processed.add(id);
        fs.writeFileSync(manifestPath, JSON.stringify([...processed], null, 2));
        successCount++;

        log.info(`Done: "${title}" uploaded to Spotify`);
      } catch (err) {
        log.error(`Failed to process "${title}" (${id})`, err);
      } finally {
        // Step 4: Delete local file to free disk space
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          log.info(`Deleted local file: ${filePath}`);
        }
      }
    }

    log.info('');
    log.info(`=== Done: ${successCount}/${newVideos.length} video(s) processed ===`);
  } finally {
    await spotifySession.close();
  }
}

main().catch((err) => {
  log.error('Agent failed', err);
  process.exit(1);
});
