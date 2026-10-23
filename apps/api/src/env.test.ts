import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('accepts an empty environment with defaults', () => {
    expect(parseEnv({})).toEqual({
      port: 3333,
      host: '0.0.0.0',
      databaseUrl: undefined,
      corsOrigin: undefined,
      s3: undefined,
      fcm: undefined,
      apns: undefined,
      devRoutes: false,
    });
  });

  it('rejects S3_ENDPOINT without credentials', () => {
    expect(() => parseEnv({ S3_ENDPOINT: 'http://localhost:9000' })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => parseEnv({ S3_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY_ID: 'a' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
  });

  it('builds the S3 settings with defaults', () => {
    const env = parseEnv({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
    });
    expect(env.s3).toEqual({
      endpoint: 'http://localhost:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'alocidadao-dev',
      accessKeyId: 'a',
      secretAccessKey: 'b',
    });
  });

  it('rejects half of the FCM settings', () => {
    expect(() => parseEnv({ FCM_PROJECT_ID: 'p' })).toThrow(/FCM_SERVICE_ACCOUNT_FILE/);
    expect(() => parseEnv({ FCM_SERVICE_ACCOUNT_FILE: './f.json' })).toThrow(/FCM_PROJECT_ID/);
  });

  it('rejects half of the APNs settings', () => {
    expect(() => parseEnv({ APNS_TEAM_ID: 't' })).toThrow(/APNS_KEY_ID/);
  });

  it('treats empty strings as unset, as in .env.example', () => {
    const env = parseEnv({ FCM_PROJECT_ID: '', FCM_SERVICE_ACCOUNT_FILE: '', S3_ENDPOINT: '' });
    expect(env.fcm).toBeUndefined();
  });

  it('rejects a non numeric PORT', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => parseEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(parseEnv({ PORT: '8080' }).port).toBe(8080);
  });

  it('never enables dev routes in production', () => {
    expect(parseEnv({ ENABLE_DEV_ROUTES: 'true', NODE_ENV: 'production' }).devRoutes).toBe(false);
    expect(parseEnv({ ENABLE_DEV_ROUTES: 'true' }).devRoutes).toBe(true);
  });
});
