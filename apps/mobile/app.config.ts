import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Estende o app.json. O google-services.json é segredo (fora do git): sem o arquivo
// o build continua funcionando, só que sem push no Android.
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const hasGoogleServices = existsSync(resolve(process.cwd(), googleServicesFile));

  return {
    ...config,
    name: config.name ?? 'Alô Cidadão',
    slug: config.slug ?? 'alocidadao',
    android: {
      ...config.android,
      ...(hasGoogleServices ? { googleServicesFile } : {}),
    },
    plugins: [...(config.plugins ?? []), 'expo-notifications'],
  };
};
