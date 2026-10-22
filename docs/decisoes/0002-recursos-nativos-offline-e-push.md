# 0002 — Recursos nativos, fila offline e push

**Status:** parcial · 22/10/2026. Provado no emulador Android; aparelhos reais e entrega de push ainda pendentes (seção "Pendente").

## Decisão

Mantemos a arquitetura do planejamento:

- app em Expo com development build (módulos nativos, sem Expo Go);
- agente registra ações numa fila offline (SQLite) e sincroniza ao voltar a rede, com ações idempotentes na API;
- fotos vão direto para o storage S3 por URL assinada;
- push enviado pela própria API, direto para FCM (Android) e APNs (iOS), usando o token nativo do `expo-notifications`.

Esta decisão vale **condicionada** às checagens pendentes: câmera, modo avião e push em aparelhos reais, e a entrega real de push. Se alguma falhar, esta decisão é revisada.

## O que foi testado

Tudo no emulador Android (AVD Pixel_8_Pro, Android API 36, imagem com Google Play), com API, Postgres e MinIO locais. Nenhum aparelho real foi usado ainda.

### Rede e latência

| Situação do emulador | Tipo detectado | Latência até a API |
| -------------------- | -------------- | ------------------ |
| Wi-Fi                | `wifi`         | 12 a 20 ms         |
| Dados móveis         | `cellular`/4g  | 14 ms              |
| Sem rede             | `none`         | sem resposta       |

Ao religar, volta para `wifi`. Logo depois de desligar só o Wi-Fi, uma leitura mostrou `none` por instantes antes de `cellular` (transição do emulador). Esses números são do emulador falando com o Mac; a latência real em 4G só sai do aparelho.

### Câmera, localização e compressão

- Permissão de câmera só é pedida ao tocar; negada, a tela explica e oferece "Abrir configurações", sem travar.
- A câmera do emulador só entrega um quadro preto (1200x1080, 20 KB, caiu para 12 KB). Não exercita a redução, então **o resultado com câmera real continua em aberto**.
- Foto sintética de ruído, 4000x3000 e 3,2 MB, saiu 1600x1200 e 242 KB, dentro do alvo de 300 KB (lado máximo 1600 px, limite duro de 1 MB na API).
- Localização: `geo fix` de São Paulo devolveu o ponto exato com precisão de 5 m. Precisão em aparelho real (GPS, interior, prédios) não foi medida. A negação da permissão de localização só foi coberta por código.

### Fila offline e modo avião

Roteiro: 3 atividades, início e conclusão (com 1 ou 2 fotos e relato) em modo avião; a atividade 3 foi cancelada pela prefeitura enquanto o app estava offline; modo avião desligado.

- A fila esvaziou sozinha em menos de 25 s.
- Atividades 1 e 2: `start` e `complete` aceitos. No banco, 2 `work_order.start` e 2 `work_order.complete` em `client_actions`, e exatamente 2 eventos de status por atividade, todos com `sentOffline = true`. Tempo de envio das fotos (PUT no MinIO local): 16 e 19 ms, sem significado para a rede real.
- Atividade 3: `start` e `complete` viraram `conflict`; o app mostrou o aviso "Esta atividade foi reatribuída ou cancelada pela prefeitura. O que você registrou ficou guardado no aparelho." Nada foi gravado no servidor para ela.
- Fechamento forçado no meio do envio (3 `start` e 3 `complete` enfileirados; processo morto depois do primeiro item): ao reabrir, a fila terminou sozinha, com 3 `start`, 3 `complete`, 6 eventos e sem duplicatas nem reenvio de foto já enviada. Não deu para controlar o instante exato da morte do processo; o que vale é o resultado.
- Metro precisa de rede, então o dev client não abre já em modo avião. Em produção isso não se aplica.

### Push: registro sem Firebase

- O prompt de permissão de notificação aparece; negada, a tela explica e oferece "Abrir configurações".
- O canal `status` é criado com importância alta.
- Sem `google-services.json`, o build funciona e a tela diz "Push ainda não configurado neste build". Outras falhas de token aparecem como erro próprio, sem se passar por "não configurado".
- Sem variáveis FCM, `POST /dev/push` responde 503 `push_not_configured`.
- Os envios para FCM e APNs (corpo, cabeçalhos, tabela de erros, JWT do APNs com cache) têm testes automatizados com transporte falso. **Nada foi enviado ao FCM ou APNs de verdade.**

## O que falhou ou exigiu ajuste

- **Imagem do MinIO:** `minio/minio` e `minio/mc` não podem mais ser baixadas do Docker Hub. O ambiente usa as imagens da Chainguard (`cgr.dev/chainguard/minio` e `minio-client`), com o mesmo comportamento S3. Falta fixar por digest e confirmar que o CI alcança `cgr.dev`.
- **Rebuild do dev client:** depois de adicionar módulo nativo (`expo-sqlite`, câmera, notificações) é preciso rodar `npx expo run:android` de novo; sem isso o app falha com "Cannot find native module".
- **Fila estritamente em ordem (FIFO):** a revisão achou que um `complete` podia passar na frente do seu `start` quando este estava em espera de retry, e ser perdido como conflito. Agora a fila para no primeiro item que ainda não venceu a espera.
- **Erros inesperados:** passam a ter espera crescente e, depois de 5 tentativas, o item vira `failed`, para um item quebrado não travar a fila.
- **Respostas validadas:** um 200 só conta se bater com o schema esperado; redirecionamento ou HTML (portal cativo de Wi-Fi) é tratado como falha de rede, para não marcar como enviado nem apagar as fotos.
- **Idempotência mais estrita:** reenviar o mesmo `clientActionId` só devolve a resposta gravada se a atividade, o tipo da ação e a pessoa forem os mesmos; senão a API responde 409 `client_action_conflict`.
- **Passada de sincronização que falha:** agora rearma o retry em vez de parar, e a atualização da lista não disputa com a sincronização.
- **Localização no emulador:** a primeira leitura falhou até ligar a precisão de localização dos Play Services (e `location_mode 3`). Aparelhos reais podem mostrar o mesmo pedido; a tela precisa tratar a falha com mensagem útil.

## Fica para o MVP

- O hook de sincronização roda só na tela do laboratório. No app real ele sobe na raiz (`_layout`), para sincronizar ao abrir o app em qualquer tela.
- A foto de uma conclusão em conflito já foi enviada ao storage antes do 409 e fica órfã. Precisa de expiração/limpeza do bucket.
- A API não lê o `.env`; as variáveis precisam estar no ambiente do processo.
- As rotas `/dev/*` ficam ligadas sempre que `NODE_ENV` não é `production`, inclusive quando está vazio. Em produção, definir `NODE_ENV=production` e substituir a identidade de desenvolvimento por autenticação.
- Itens menores registrados na revisão (timeout de 30 s também no PUT da foto, pastas de fotos de itens em conflito não removidas, 401/503 que falham o item de vez, entre outros) entram no plano do app do agente.

## Pendente

Nada abaixo foi executado. Preencha a tabela do fim ao concluir.

### 1. Android real

1. Ative a depuração USB no aparelho e confira com `adb devices`.
2. Descubra o IP do Mac na rede (`ipconfig getifaddr en0`); celular e Mac na mesma rede Wi-Fi.
3. Suba a infraestrutura e a API com `S3_PUBLIC_ENDPOINT=http://<IP-DO-MAC>:9000` (a URL assinada precisa ser alcançável pelo aparelho).
4. Em `apps/mobile`, rode `EXPO_PUBLIC_API_URL=http://<IP-DO-MAC>:3333 npx expo run:android --device`.
5. Em Wi-Fi, abra Laboratório > Rede: anote tipo de rede e latência.
6. Laboratório > Câmera e localização: negue e depois aceite as permissões, anotando se foram pedidas só ao tocar. Tire uma foto real e anote dimensões e tamanho (alvo: até 300 KB). Anote a precisão da localização, ao ar livre e em ambiente fechado.
7. Laboratório > Atividades offline, com dados do `db:seed:dev`: ligue o modo avião, inicie e conclua 3 atividades (fotos reais, relato), cancele uma pelo `curl` do roteiro, desligue o modo avião. Confira: fila vazia, sem duplicatas (`client_actions` e `status_events` no banco), aviso de conflito na cancelada.
8. Repita o passo 7 e force o fechamento do app (arrastar dos recentes) durante o envio; reabra e confira que termina sem duplicar.
9. Anote o tempo de envio por foto em Wi-Fi.
10. Desligue o Wi-Fi do aparelho e repita 5 a 9 em dados móveis (o Mac precisa ser alcançável pelo celular: use um túnel ou deixe o celular numa rede com acesso ao Mac e simule 4G com limitação de banda). Anote o tempo de envio por foto em 4G.

### 2. iPhone

Mesma sequência da seção 1, exceto push. Rode `EXPO_PUBLIC_API_URL=http://<IP-DO-MAC>:3333 npx expo run:ios --device` (exige Xcode e o aparelho em modo desenvolvedor). Observe em especial: textos de permissão, câmera, `redirect: 'manual'` no `fetch` do iOS (respostas 200 não podem ser tratadas como falha de rede) e o PUT da foto com arquivo como corpo.

### 3. Firebase e entrega de push no Android

1. Crie o projeto no Firebase e adicione o app Android `br.com.alocidadao.app`.
2. Baixe `google-services.json` e salve em `apps/mobile/`.
3. Gere uma conta de serviço com permissão de envio do FCM e salve a chave em `apps/api/secrets/firebase-service-account.json`. As duas pastas estão no `.gitignore`.
4. No ambiente da API, defina `FCM_PROJECT_ID` e `FCM_SERVICE_ACCOUNT_FILE=./secrets/firebase-service-account.json`; reinicie a API.
5. Rode `npx expo run:android` em `apps/mobile` de novo (o arquivo muda o build nativo). No emulador, use uma imagem com Google Play.
6. Laboratório > Notificações > "Registrar aparelho", aceite a permissão; o token deve aparecer.
7. App aberto: "Enviar teste". Esperado: banner "Solicitação 2026-000123: Em atendimento".
8. App em segundo plano: "Enviar em 10 s", volte para a tela inicial e espere a chegada.
9. App fechado: "Enviar em 10 s", arraste o app dos recentes e espere a chegada.
10. Token inventado: `POST /dev/push` com `"token": "x"` deve devolver `invalid_token`.
11. Anote se o push chegou nos três cenários e o atraso aproximado.

### 4. Push no iOS (depois da conta Apple Developer)

1. Crie a chave APNs (`.p8`) e salve em `apps/api/secrets/apns.p8`.
2. No ambiente da API, defina `APNS_TEAM_ID`, `APNS_KEY_ID` e `APNS_KEY_FILE=./secrets/apns.p8` (`APNS_PRODUCTION=false` para build de desenvolvimento); reinicie a API.
3. Habilite a capability de Push Notifications no app e rode `npx expo run:ios --device`.
4. Registre o aparelho na tela Notificações e repita os três cenários da seção 3 (aberto, segundo plano, fechado) e o teste do token inválido.

### Tabela de resultados (preencher)

| Medida                              | Android real | iPhone | Emulador (referência)   |
| ----------------------------------- | ------------ | ------ | ----------------------- |
| Tamanho da foto comprimida (câmera) |              |        | 242 KB (foto sintética) |
| Dimensões da foto comprimida        |              |        | 1600x1200               |
| Envio por foto em Wi-Fi             |              |        | 16 a 19 ms (local)      |
| Envio por foto em 4G                |              |        | não medido              |
| Latência da API em Wi-Fi            |              |        | 12 a 20 ms              |
| Latência da API em 4G               |              |        | 14 ms                   |
| Precisão da localização             |              |        | 5 m (simulada)          |
| Push com app aberto                 |              | n/a    | não testado             |
| Push em segundo plano               |              | n/a    | não testado             |
| Push com app fechado                |              | n/a    | não testado             |

## Conclusão

Com a evidência de hoje, a arquitetura do planejamento se mantém: o development build suporta câmera, localização, rede, SQLite e notificações; a fila offline sobrevive a modo avião, conflito e fechamento forçado sem duplicar; o upload por URL assinada funciona com `File` como corpo; e o envio de push direto tem o fluxo de registro e a API prontos e testados. Isso vale só para o emulador. Falta provar em aparelho real a foto da câmera, o modo avião e o envio por 4G, e provar a entrega de push (FCM e APNs), que ainda não foi tentada. Se a entrega real falhar, a alternativa a avaliar é o serviço de push do Expo, o que muda o planejamento.
