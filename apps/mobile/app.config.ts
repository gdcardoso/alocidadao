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
    plugins: [
      ...(config.plugins ?? []),
      'expo-notifications',
      'expo-font',
      // Abertura nativa: logo da marca sobre fundo branco (a tela 0 do Pencil usa a mesma logo).
      [
        'expo-splash-screen',
        {
          image: './assets/logo.png',
          imageWidth: 240,
          resizeMode: 'contain',
          backgroundColor: '#FFFFFF',
        },
      ],
      // Mapa do "Ajustar" (Task 9); entra agora para um único build nativo.
      '@maplibre/maplibre-react-native',
    ],
  };
};
