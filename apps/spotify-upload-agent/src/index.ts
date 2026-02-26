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
 * Main orchestrator: for each new YouTube video, downloads it, finds the
 * matching existing episode on Spotify for Creators via the three-dot menu,
 * uploads the video, then deletes the local file.
 *
 * Login is manual (user logs in once). Everything after that is automated.
 */
async function main() {
  log.info('=== Spotify Video Upload Agent ===');
  log.info(`YouTube source: ${config.youtube.url}`);
  log.info('Mode: download → find episode → three-dot menu → upload video → delete');
  log.info('');

  // Ensure download directory exists
  const downloadDir = config.export.downloadDir;
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Track which video IDs have been fully processed
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

  // Launch browser
  const session = await launchBrowser('spotify');

  try {
    // Manual login: user logs in once, then everything is automated
    if (!(await isLoggedIn(session.page))) {
      await loginToSpotify(session.page, session.context);
    }

    let successCount = 0;

    for (const { id, title } of newVideos) {
      log.info('');
      log.info(`--- Processing: "${title}" (${id}) ---`);
      let filePath: string | undefined;

      try {
        // Step 1: Download from YouTube
        filePath = await downloadVideo(id, title);

        // Step 2: Find episode on Spotify, open upload video page, attach file
        await retry(() => addVideoToEpisode(session.page, filePath!, title));

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
    await session.close();
  }
}

main().catch((err) => {
  log.error('Agent failed', err);
  process.exit(1);
});
