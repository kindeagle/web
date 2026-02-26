import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from './config';
import { launchBrowser, retry } from './utils/browser';
import { createLogger } from './utils/logger';
import { listVideos, downloadVideo } from './youtube/download';
import { addVideoToEpisode } from './spotify/upload';
import { loginToSpotify, isLoggedIn } from './spotify/auth';

const log = createLogger('agent');

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
 * Main orchestrator: for each new YouTube video, downloads it, adds the video
 * to the matching existing Spotify episode, then deletes the local file.
 */
async function main() {
  log.info('=== Spotify Video Upload Agent ===');
  log.info(`YouTube source: ${config.youtube.url}`);
  log.info('Mode: download → add video to existing episode → delete (one at a time)');
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
    if (!config.browser.headless) {
      // In visible mode: open Spotify login and let user log in
      await spotifySession.page.goto('https://accounts.spotify.com/login', {
        waitUntil: 'domcontentloaded',
      });
      log.info('');
      log.info('==> Browser is open. Please log in to Spotify for Creators.');
      log.info('==> Once you are logged in and on the dashboard, press Enter.');
      log.info('');
      await waitForEnter('Press Enter after logging in... ');
    } else {
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

        // Step 2: Add video to existing Spotify episode
        await retry(() => addVideoToEpisode(spotifySession.page, filePath!, title));

        // Step 3: Mark as processed
        processed.add(id);
        fs.writeFileSync(manifestPath, JSON.stringify([...processed], null, 2));
        successCount++;

        log.info(`Done: "${title}" — video added to Spotify episode`);
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
