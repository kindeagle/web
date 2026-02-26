import { config } from './config';
import { launchBrowser } from './utils/browser';
import { createLogger } from './utils/logger';
import { downloadNewVideos } from './youtube/download';
import { uploadNewEpisodes } from './spotify/upload';

const log = createLogger('agent');

/**
 * Main orchestrator: downloads new videos from YouTube, then uploads
 * them to Spotify for Creators.
 *
 * Usage:
 *   yarn start              # Run the full pipeline
 *   yarn download           # Only download from YouTube
 *   yarn upload             # Only upload to Spotify
 *   yarn auth:spotify       # Save Spotify login session
 */
async function main() {
  log.info('=== Spotify Upload Agent ===');
  log.info(`YouTube source: ${config.youtube.url}`);
  log.info(`Download directory: ${config.export.downloadDir}`);
  log.info('');

  // --- Phase 1: Download from YouTube ---
  log.info('--- Phase 1: Downloading videos from YouTube ---');
  let downloadedFiles: string[] = [];

  try {
    const results = await downloadNewVideos();
    downloadedFiles = results.map((r) => r.filePath);

    if (results.length === 0) {
      log.info('No new videos to download from YouTube');
    } else {
      log.info(`Downloaded ${results.length} video(s):`);
      for (const { title, filePath } of results) {
        log.info(`  - ${title} -> ${filePath}`);
      }
    }
  } catch (err) {
    log.error('YouTube download phase failed', err);
    throw err;
  }

  // --- Phase 2: Upload to Spotify for Creators ---
  log.info('');
  log.info('--- Phase 2: Uploading episodes to Spotify for Creators ---');
  const spotifySession = await launchBrowser('spotify');

  try {
    // Upload the newly downloaded files (or any pending files in the downloads dir)
    const uploaded = await uploadNewEpisodes(
      spotifySession.page,
      spotifySession.context,
      downloadedFiles.length > 0 ? downloadedFiles : undefined,
    );

    if (uploaded.length === 0) {
      log.info('No new episodes to upload to Spotify');
    } else {
      log.info(`Uploaded ${uploaded.length} episode(s) to Spotify for Creators`);
    }
  } catch (err) {
    log.error('Spotify upload phase failed', err);
    throw err;
  } finally {
    await spotifySession.close();
  }

  log.info('');
  log.info('=== Agent run complete ===');
}

main().catch((err) => {
  log.error('Agent failed', err);
  process.exit(1);
});
