import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPrivateStorageProvider } from './local-private-storage.provider';
import { StorageObjectNotFoundError } from './file-storage.types';
import { InMemoryStorageProvider } from './in-memory-storage.provider';
import {
  buildOpaqueStorageKey,
  isOpaqueStorageKey,
  sanitizeOriginalFilename,
} from './file-storage.types';

async function readAll(stream: AsyncIterable<Buffer | string>) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('storage keys & sanitize', () => {
  it('builds opaque verification keys without PII', () => {
    const key = buildOpaqueStorageKey({
      ownerId: 'user-uuid-123',
      keyPrefix: 'verification',
    });
    expect(isOpaqueStorageKey(key)).toBe(true);
    expect(key).not.toContain('user-uuid');
    expect(key.startsWith('verification/')).toBe(true);
  });

  it('sanitizes original filenames', () => {
    expect(sanitizeOriginalFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalFilename('CIP 2024.pdf')).toBe('CIP 2024.pdf');
    expect(sanitizeOriginalFilename('a<script>.jpg')).toBe('a_script_.jpg');
    expect(sanitizeOriginalFilename(null)).toBeNull();
  });
});

describe('LocalPrivateStorageProvider', () => {
  let root: string;
  let storage: LocalPrivateStorageProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kj-storage-'));
    storage = new LocalPrivateStorageProvider(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores under an opaque key and streams the content back', async () => {
    const buffer = Buffer.from('contenu secret');
    const { key, sizeBytes } = await storage.put({
      buffer,
      mimeType: 'application/pdf',
      ownerId: 'owner-1',
    });
    expect(sizeBytes).toBe(buffer.byteLength);
    expect(isOpaqueStorageKey(key)).toBe(true);
    expect(await readAll(await storage.getStream(key))).toEqual(buffer);
  });

  it('deletes objects and reports missing ones', async () => {
    const { key } = await storage.put({
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
      ownerId: 'owner-1',
    });
    await storage.delete(key);
    await expect(storage.getStream(key)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it.each(['../etc/passwd', '/etc/passwd', 'ab/../../x', 'not-a-key', ''])(
    'refuses the traversal / malformed key %j',
    async (key) => {
      await expect(storage.getStream(key)).rejects.toBeInstanceOf(
        StorageObjectNotFoundError,
      );
      await expect(storage.delete(key)).rejects.toBeInstanceOf(
        StorageObjectNotFoundError,
      );
    },
  );
});

describe('InMemoryStorageProvider', () => {
  it('supports put/get/delete/signedUrl without cloud', async () => {
    const storage = new InMemoryStorageProvider();
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const { key } = await storage.put({
      buffer,
      mimeType: 'image/jpeg',
      ownerId: 'u1',
    });
    expect(await readAll(await storage.getStream(key))).toEqual(buffer);
    expect(await storage.getSignedUrl!(key, 60)).toContain('memory://signed/');
    await storage.delete(key);
    await expect(storage.getStream(key)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });
});
