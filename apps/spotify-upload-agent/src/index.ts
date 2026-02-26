import { config } from './config';
import { launchBrowser } from './utils/browser';
import { createLogger } from './utils/logger';
import { downloadNewEpisodes } from './descript/download';
import { uploadNewEpisodes } from './spotify/upload';

const log = createLogger('agent');

/**
 * Main orchestrator: downloads new episodes from Descript, then uploads
 * them to Spotify for Creators.
 *
 * Usage:
 *   yarn start              # Run the full pipeline
 *   yarn download           # Only download from Descript
 *   yarn upload             # Only upload to Spotify
 *   yarn auth:descript      # Save Descript login session
 *   yarn auth:spotify       # Save Spotify login session
 */
async function main() {
  log.info('=== Spotify Upload Agent ===');
  log.info(`Project: ${config.descript.projectName}`);
  log.info(`Download directory: ${config.export.downloadDir}`);
  log.info(`Headless mode: ${config.browser.headless}`);
  log.info('');

  // --- Phase 1: Download from Descript ---
  log.info('--- Phase 1: Downloading episodes from Descript ---');
  const descriptSession = await launchBrowser('descript');
  let downloadedFiles: string[] = [];

  try {
    const results = await downloadNewEpisodes(
      descriptSession.page,
      descriptSession.context,
    );
    downloadedFiles = results.map((r) => r.filePath);

    if (results.length === 0) {
      log.info('No new episodes to download from Descript');
    } else {
      log.info(`Downloaded ${results.length} episode(s):`);
      for (const { episode, filePath } of results) {
        log.info(`  - ${episode.name} → ${filePath}`);
      }
    }
  } catch (err) {
    log.error('Descript download phase failed', err);
    throw err;
  } finally {
    await descriptSession.close();
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
