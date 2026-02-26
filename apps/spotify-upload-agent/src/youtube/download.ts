import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('youtube:download');

export interface YouTubeVideo {
  /** YouTube video ID */
  id: string;
  /** Video title */
  title: string;
  /** Local file path after download */
  filePath: string;
}

/**
 * Runs yt-dlp with the given arguments and returns stdout.
 */
function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        log.error(`yt-dlp failed: ${stderr}`);
        reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Lists video IDs and titles from a YouTube URL (channel, playlist, or single video).
 */
export async function listVideos(
  youtubeUrl: string,
): Promise<{ id: string; title: string }[]> {
  log.info(`Fetching video list from: ${youtubeUrl}`);

  const output = await runYtDlp([
    '--flat-playlist',
    '--print', '%(id)s\t%(title)s',
    '--no-warnings',
    youtubeUrl,
  ]);

  if (!output) {
    return [];
  }

  const videos = output
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [id, ...titleParts] = line.split('\t');
      return { id: id.trim(), title: titleParts.join('\t').trim() };
    });

  log.info(`Found ${videos.length} video(s)`);
  return videos;
}

/**
 * Downloads a single YouTube video at up to 1080p.
 *
 * Format selection: best video up to 1080p + best audio, merged into mp4.
 * Falls back to best available if 1080p isn't available.
 */
export async function downloadVideo(
  videoId: string,
  title: string,
): Promise<string> {
  log.info(`Downloading video: "${title}" (${videoId})...`);

  const downloadDir = config.export.downloadDir;
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Output template: use video title, sanitized by yt-dlp
  const outputTemplate = path.join(downloadDir, '%(title)s [%(id)s].%(ext)s');

  await runYtDlp([
    // Prefer up to 1080p video + best audio, merged into mp4
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    '--no-playlist',
    '--no-overwrites',
    '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);

  // Find the downloaded file (yt-dlp sanitizes the title in the filename)
  const files = fs.readdirSync(downloadDir).filter((f) => f.includes(videoId) && f.endsWith('.mp4'));
  if (files.length === 0) {
    throw new Error(`Download completed but file not found for video ${videoId}`);
  }

  const filePath = path.join(downloadDir, files[0]);
  log.info(`Downloaded: ${filePath}`);
  return filePath;
}

/**
 * Downloads all new videos from the configured YouTube URL that haven't
 * been downloaded yet. Tracks downloads via a manifest file keyed by video ID.
 */
export async function downloadNewVideos(): Promise<YouTubeVideo[]> {
  const youtubeUrl = config.youtube.url;
  const downloadDir = config.export.downloadDir;

  // Load manifest of already-downloaded video IDs
  const manifestPath = path.join(downloadDir, '.youtube-manifest.json');
  const manifest: Set<string> = fs.existsSync(manifestPath)
    ? new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
    : new Set();

  const videos = await listVideos(youtubeUrl);
  const results: YouTubeVideo[] = [];

  for (const { id, title } of videos) {
    if (manifest.has(id)) {
      log.info(`Skipping "${title}" (already downloaded)`);
      continue;
    }

    try {
      const filePath = await downloadVideo(id, title);
      manifest.add(id);
      // Persist manifest after each successful download
      fs.writeFileSync(manifestPath, JSON.stringify([...manifest], null, 2));
      results.push({ id, title, filePath });
    } catch (err) {
      log.error(`Failed to download "${title}" (${id})`, err);
    }
  }

  log.info(`Downloaded ${results.length} new video(s)`);
  return results;
}

/**
 * Standalone script: run `yarn download` to download videos from YouTube.
 */
async function main() {
  const results = await downloadNewVideos();
  for (const { title, filePath } of results) {
    log.info(`Done: ${title} -> ${filePath}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error('Download failed', err);
    process.exit(1);
  });
}
