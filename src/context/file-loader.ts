/**
 * File Loader - Pre-fetch task files for context prediction
 *
 * Loads file previews when a task is claimed to reduce round-trips.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FilePreview {
  path: string;
  exists: boolean;
  size?: number;
  lines?: number;
  preview?: string;
  isBinary?: boolean;
  error?: string;
}

export interface FileLoaderOptions {
  maxLines?: number;        // Max lines to include in preview (default: 100)
  maxFileSize?: number;     // Skip files larger than this (default: 100KB)
  includeHidden?: boolean;  // Include dotfiles (default: false)
}

const DEFAULT_OPTIONS: FileLoaderOptions = {
  maxLines: 100,
  maxFileSize: 100 * 1024, // 100KB
  includeHidden: false,
};

// Binary file extensions to skip
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.db', '.sqlite', '.sqlite3',
  '.lock', '.bin',
]);

/**
 * Check if a file is likely binary based on extension
 */
function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Load a single file preview
 */
export async function loadFilePreview(
  filePath: string,
  rootPath: string,
  options: FileLoaderOptions = {}
): Promise<FilePreview> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath);

  const result: FilePreview = {
    path: filePath,
    exists: false,
  };

  try {
    // Check if file exists
    const stats = fs.statSync(absolutePath);
    result.exists = true;
    result.size = stats.size;

    // Skip binary files
    if (isBinaryFile(filePath)) {
      result.isBinary = true;
      return result;
    }

    // Skip files that are too large
    if (stats.size > opts.maxFileSize!) {
      result.error = `File too large (${Math.round(stats.size / 1024)}KB > ${Math.round(opts.maxFileSize! / 1024)}KB limit)`;
      return result;
    }

    // Skip hidden files unless explicitly included
    const fileName = path.basename(filePath);
    if (fileName.startsWith('.') && !opts.includeHidden) {
      result.error = 'Hidden file skipped';
      return result;
    }

    // Read file content
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');
    result.lines = lines.length;

    // Get preview (first N lines)
    if (lines.length <= opts.maxLines!) {
      result.preview = content;
    } else {
      result.preview = lines.slice(0, opts.maxLines!).join('\n');
      result.preview += `\n\n... (${lines.length - opts.maxLines!} more lines)`;
    }

    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      result.exists = false;
      result.error = 'File not found';
    } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      result.exists = true;
      result.error = 'Permission denied';
    } else {
      result.error = `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
    return result;
  }
}

/**
 * Load previews for multiple files
 */
export async function loadFilePreviews(
  filePaths: string[],
  rootPath: string,
  options: FileLoaderOptions = {}
): Promise<FilePreview[]> {
  const previews: FilePreview[] = [];

  for (const filePath of filePaths) {
    const preview = await loadFilePreview(filePath, rootPath, options);
    previews.push(preview);
  }

  return previews;
}

/**
 * Format file previews for display
 */
export function formatFilePreviews(previews: FilePreview[]): string {
  const lines: string[] = ['Context Files:', ''];

  for (const preview of previews) {
    if (!preview.exists) {
      lines.push(`❌ ${preview.path} (not found)`);
      continue;
    }

    if (preview.isBinary) {
      lines.push(`📦 ${preview.path} (binary, ${formatSize(preview.size || 0)})`);
      continue;
    }

    if (preview.error) {
      lines.push(`⚠️  ${preview.path} (${preview.error})`);
      continue;
    }

    lines.push(`📄 ${preview.path} (${preview.lines} lines, ${formatSize(preview.size || 0)})`);
    if (preview.preview) {
      lines.push('```');
      lines.push(preview.preview);
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Get summary of file previews
 */
export function getPreviewSummary(previews: FilePreview[]): {
  total: number;
  loaded: number;
  missing: number;
  binary: number;
  errors: number;
  totalBytes: number;
} {
  let loaded = 0;
  let missing = 0;
  let binary = 0;
  let errors = 0;
  let totalBytes = 0;

  for (const preview of previews) {
    if (!preview.exists) {
      missing++;
    } else if (preview.isBinary) {
      binary++;
      totalBytes += preview.size || 0;
    } else if (preview.error) {
      errors++;
    } else {
      loaded++;
      totalBytes += preview.size || 0;
    }
  }

  return {
    total: previews.length,
    loaded,
    missing,
    binary,
    errors,
    totalBytes,
  };
}
