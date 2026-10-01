import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

export function getUserDataDir(userId: string) {
  return path.join(DATA_DIR, userId);
}

export function getNoteDir(userId: string, noteId: string) {
  return path.join(getUserDataDir(userId), noteId);
}

export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function saveFile(filePath: string, data: Buffer | string) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function readFile(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

export function deleteFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function deleteDir(dirPath: string) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}
