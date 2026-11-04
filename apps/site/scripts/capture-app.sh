#!/usr/bin/env bash
# Capturas do app (cidadão e agente) para a página de apresentação, pelo simulador iOS.
#
# O app não roda na web, então a captura é feita no simulador: o script pede cada tela, espera
# Enter e grava com `xcrun simctl io booted screenshot`, convertendo para WebP em public/img/.
#
# Antes: `pnpm demo:scenario` (solicitação concluída com foto), app aberto no simulador e logado
# com a conta certa (cidadão +55 11 90000-0002 ou agente +55 11 90000-0001, código fixo).
#
# Sem simulador ligado, sai explicando o passo manual; a página continua com os substitutos
# (celulares do cidadão desenhados em HTML e a tela do agente vinda do Pencil).
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="public/img"
CWEBP="${CWEBP:-cwebp}"
# Largura final das capturas (a do iPhone em 2x).
WIDTH="${WIDTH:-780}"

if ! command -v xcrun >/dev/null 2>&1 || ! xcrun simctl list devices booted 2>/dev/null | grep -q Booted; then
  cat <<'MSG'
Nenhum simulador iOS ligado.

Passo manual:
  1. Rode `pnpm --filter @alocidadao/site demo:scenario` com a API local.
  2. Abra o simulador (Xcode > Open Developer Tool > Simulator) e o app (`pnpm --filter @alocidadao/mobile ios`).
  3. Rode este script de novo; ele pede cada tela e grava as capturas.

Enquanto isso, a página usa os substitutos (celulares do cidadão em HTML e a tela do agente do Pencil).
MSG
  exit 1
fi

if ! command -v "$CWEBP" >/dev/null 2>&1; then
  echo "cwebp não encontrado (brew install webp)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

capture() {
  local name="$1" hint="$2"
  read -r -p "$hint e tecle Enter para gravar ${name}.webp... " _
  xcrun simctl io booted screenshot --type=png "$TMP_DIR/$name.png" >/dev/null
  "$CWEBP" -quiet -q 82 -resize "$WIDTH" 0 "$TMP_DIR/$name.png" -o "$OUT_DIR/$name.webp"
  echo "Gravado: $OUT_DIR/$name.webp"
}

capture cidadao-lista "Como cidadão, abra a lista \"Minhas solicitações\""
capture cidadao-concluida "Como cidadão, abra a solicitação concluída com a foto do serviço"
capture agente-concluir "Como agente, abra a tela de concluir o atendimento com a foto"

cat <<'MSG'

Pronto. Em apps/site/src/render.ts, troque CITIZEN_LIST e CITIZEN_DONE (hoje null) pelas
imagens novas e confira width/height de AGENT_FINISH com o tamanho das capturas.
MSG
