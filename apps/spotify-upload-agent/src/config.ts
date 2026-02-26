import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Copy .env.example to .env and fill in your values.`,
    );
  }
  return value;
}

export const config = {
  descript: {
    email: requireEnv('DESCRIPT_EMAIL'),
    password: requireEnv('DESCRIPT_PASSWORD'),
    projectName: process.env.DESCRIPT_PROJECT_NAME ?? 'Podiatry Marketing',
    baseUrl: 'https://web.descript.com',
  },

  spotify: {
    email: requireEnv('SPOTIFY_EMAIL'),
    password: requireEnv('SPOTIFY_PASSWORD'),
    baseUrl: 'https://creators.spotify.com',
  },

  export: {
    downloadDir: path.resolve(
      process.env.DOWNLOAD_DIR ?? path.join(__dirname, '../downloads'),
    ),
    format: (process.env.EXPORT_FORMAT ?? 'mp4') as 'mp4' | 'mov',
    quality: (process.env.EXPORT_QUALITY ?? 'high') as 'high' | 'medium' | 'low',
  },

  browser: {
    headless: process.env.HEADLESS !== 'false',
    slowMo: parseInt(process.env.SLOW_MO ?? '0', 10),
    authStateDir: path.resolve(__dirname, '../.auth'),
  },
} as const;

export type Config = typeof config;
