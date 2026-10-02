import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import {
  StorageObjectNotFoundError,
  assertSafeStorageKey,
  buildOpaqueStorageKey,
  type FileStorageService,
  type PutFileInput,
  type PutFileResult,
} from './file-storage.types';

export type ObjectStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/**
 * Provider S3-compatible générique (AWS, Scaleway, R2, MinIO…).
 * Bucket privé attendu. Aucune URL publique permanente.
 */
export class ObjectStorageProvider implements FileStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(input: PutFileInput): Promise<PutFileResult> {
    const key = buildOpaqueStorageKey({
      ownerId: input.ownerId,
      keyPrefix: input.keyPrefix,
    });
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
        // ACL jamais public-read : bucket privé + IAM.
      }),
    );
    return { key, sizeBytes: input.buffer.byteLength };
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeStorageKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body;
      if (!body) throw new StorageObjectNotFoundError(key);
      if (body instanceof Readable) return body;
      // SDK v3 browsers / undici : convertir en Readable Node.
      const bytes = await body.transformToByteArray();
      return Readable.from(Buffer.from(bytes));
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) throw error;
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeStorageKey(key);
    const ttl = Math.max(30, Math.min(ttlSeconds, 15 * 60));
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttl });
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
