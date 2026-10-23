import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
  /** Endpoint usado pelo servidor (head etc.). */
  endpoint: string;
  /** Endpoint que o aparelho enxerga; é com ele que as URLs são assinadas. */
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Storage {
  presignUpload(key: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** URL assinada de leitura (GET) do objeto, válida por `seconds` segundos. */
  presignGet(key: string, seconds: number): Promise<string>;
  head(key: string): Promise<{ bytes: number; contentType: string } | null>;
}

const UPLOAD_CONTENT_TYPE = 'image/jpeg';
const UPLOAD_EXPIRES_SECONDS = 600;

export function createStorage(config: StorageConfig): Storage {
  const client = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  // Assinar não faz chamada de rede, então o endpoint público não precisa ser alcançável daqui.
  const signer = client(config.publicEndpoint);
  const server = client(config.endpoint);

  return {
    async presignUpload(key) {
      const url = await getSignedUrl(
        signer,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: UPLOAD_CONTENT_TYPE,
        }),
        { expiresIn: UPLOAD_EXPIRES_SECONDS },
      );
      return { url, headers: { 'Content-Type': UPLOAD_CONTENT_TYPE } };
    },

    async presignGet(key, seconds) {
      return getSignedUrl(signer, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: seconds,
      });
    },

    async head(key) {
      try {
        const out = await server.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return { bytes: out.ContentLength ?? 0, contentType: out.ContentType ?? '' };
      } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
  };
}

export function newPhotoKey(tenantId: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/uploads/${yyyy}/${mm}/${randomUUID()}.jpg`;
}

/** Chave da foto de uma solicitação do cidadão: `requests/<userId>/<yyyy>/<uuid>.jpg`. */
export function newRequestPhotoKey(userId: string, now: Date = new Date()): string {
  return `requests/${userId}/${now.getUTCFullYear()}/${randomUUID()}.jpg`;
}
