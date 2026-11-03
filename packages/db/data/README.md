# Dados da demo

`goiania-bairros.geojson`: os 687 bairros de Goiânia, para carregar na Prefeitura de Goiânia do seed
pelo backoffice (aba Contrato → Bairros → Carregar arquivo de bairros). A malha de bairros do IBGE
(Censo 2022) não cobre Goiânia; o arquivo vem da própria prefeitura.

- Fonte: conjunto "Bairros" do portal de dados abertos de Goiânia (dadosabertos.goiania.go.gov.br,
  `http://www4.goiania.go.gov.br/daber/dadosabertos/sedetec/geoespaciais/bai.json`), licença
  Creative Commons Atribuição.
- Tratamento: sem as glebas (`tp_bai` Glb, Glc, Glf e Gll), nome do tipo por extenso em `nome`
  ("S Bueno" vira "Setor Bueno"), polígonos de mesmo nome juntados, de SIRGAS 2000 / UTM 22S para
  WGS 84 e simplificado (50% dos vértices).

Para gerar de novo:

```bash
node packages/db/data/goiania-bairros-nomes.mjs bai.json bai-nomes.json
npx mapshaper bai-nomes.json -proj from=EPSG:31982 crs=wgs84 -dissolve nome \
  -simplify 50% keep-shapes -clean -o format=geojson precision=0.000001 goiania-bairros.geojson
```
