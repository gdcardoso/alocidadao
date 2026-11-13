#!/usr/bin/env bash
# Apaga do ghcr as versões de um pacote cujas tags NÃO estão na lista a manter.
#   prune-ghcr.sh <dono> <pacote> <tag> [<tag>...]
# Só apaga versões que têm tag (as sem tag ficam). Sem nenhuma tag a manter, não apaga nada.
# Precisa de GH_TOKEN (permissão packages: write) e do gh.
set -euo pipefail

owner="${1:?dono}"
package="${2:?pacote}"
shift 2

keep=()
for tag in "$@"; do
  [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]] && keep+=("$tag")
done
if [[ ${#keep[@]} -eq 0 ]]; then
  echo "Nenhuma tag válida para manter em $package: nada será apagado."
  exit 0
fi
echo "Mantendo em $package: ${keep[*]}"

while IFS=$'\t' read -r id tags; do
  [[ -n "$id" && -n "$tags" ]] || continue
  manter=0
  for tag in "${keep[@]}"; do
    [[ ",$tags," == *",$tag,"* ]] && manter=1
  done
  if [[ $manter -eq 0 ]]; then
    echo "Apagando $package versão $id (tags: $tags)"
    gh api -X DELETE "/users/$owner/packages/container/$package/versions/$id"
  fi
done < <(gh api --paginate "/users/$owner/packages/container/$package/versions?per_page=100" \
  --jq '.[] | [.id, ((.metadata.container.tags // []) | join(","))] | @tsv')
