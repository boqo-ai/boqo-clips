// The environment the tools run ffmpeg, ffprobe, yt-dlp and whisper-cli with.
// On macOS, Homebrew's ffmpeg-full (the build with libass) is keg-only: it is
// not linked onto PATH, and every agent command runs in a new shell, so an
// `export PATH=...` hint is gone by the next command. The tools find it here.
import { existsSync } from 'node:fs';
import { posix } from 'node:path';

/** ffmpeg-full's bin folder, Apple silicon first, then Intel. */
export const MAC_FFMPEG_DIRS = ['/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin'];
/** Homebrew's own bin folders, which a non-login shell may not have. */
export const MAC_BREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];

/**
 * `baseEnv` with, on macOS only, every ffmpeg-full bin folder that exists put
 * first on PATH, and every Homebrew bin folder that exists and is missing
 * added last. Any other OS gets `baseEnv` as it is. Never changes `baseEnv`.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @param {string} [platform]
 * @param {(path: string) => boolean} [exists]
 * @returns {NodeJS.ProcessEnv}
 */
export function toolEnv(baseEnv = process.env, platform = process.platform, exists = existsSync) {
  if (platform !== 'darwin') return baseEnv;
  const sep = posix.delimiter;
  const parts = String(baseEnv.PATH ?? '').split(sep).filter(Boolean);
  const front = MAC_FFMPEG_DIRS.filter((d) => exists(d));
  const back = MAC_BREW_BINS.filter((d) => !parts.includes(d) && exists(d));
  if (front.length === 0 && back.length === 0) return baseEnv;
  return { ...baseEnv, PATH: [...front, ...parts.filter((p) => !front.includes(p)), ...back].join(sep) };
}
