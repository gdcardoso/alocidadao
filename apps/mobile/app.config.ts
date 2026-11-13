import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Estende o app.json. O google-services.json é segredo (fora do git): sem o arquivo
// o build continua funcionando, só que sem push no Android.
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const hasGoogleServices = existsSync(resolve(__dirname, googleServicesFile));

  return {
    ...config,
    name: config.name ?? 'Alô Cidadão',
    slug: config.slug ?? 'alocidadao',
    android: {
      ...config.android,
      // O workflow apk-build.yml define o versionCode (número da execução); fora dele, o padrão do Expo.
      ...(process.env.ANDROID_VERSION_CODE
        ? { versionCode: Number(process.env.ANDROID_VERSION_CODE) }
        : {}),
      ...(hasGoogleServices ? { googleServicesFile } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      'expo-notifications',
      'expo-font',
      // Abertura nativa: só o fundo branco. O Android 12+ só mostra um ícone num círculo, então
      // a imagem é um PNG transparente (sem `image` o plugin ainda aponta para splashscreen_logo).
      // A cidade e a logo aparecem logo em seguida na tela 0 (AberturaOverlay).
      [
        'expo-splash-screen',
        {
          image: './assets/splash-transparent.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#FFFFFF',
        },
      ],
      // Mapa do "Ajustar" (Task 9); entra agora para um único build nativo.
      '@maplibre/maplibre-react-native',
    ],
  };
};
