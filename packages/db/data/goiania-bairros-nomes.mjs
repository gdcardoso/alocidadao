// Lê bai.json (Goiânia, EPSG:31982), tira glebas, escreve os nomes por extenso em `nome`.
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const TYPES = {
  S: 'Setor',
  Jd: 'Jardim',
  Res: 'Residencial',
  Vl: 'Vila',
  Bro: 'Bairro',
  Prq: 'Parque',
  Cj: 'Conjunto',
  Cjr: 'Conjunto Residencial',
  Ch: 'Chácara',
  Lot: 'Loteamento',
  Con: 'Condomínio',
  Sir: 'Sítio de Recreio',
  Vlg: 'Village',
  Grj: 'Granja',
  Faz: 'Fazenda',
  Esp: 'Espaço',
  Zon: 'Zona',
  Dis: 'Distrito',
  Col: 'Colônia',
  Sit: 'Sítio',
};
const g = JSON.parse(readFileSync(input, 'utf8'));
const unknown = new Set();
const blank = [];
g.features = g.features
  .filter((f) => !String(f.properties.tp_bai).startsWith('Gl'))
  .map((f) => {
    const { tp_bai: tp, nm_bai: nm } = f.properties;
    if (!TYPES[tp]) unknown.add(tp);
    if (!nm || !nm.trim()) blank.push(f.properties.nm1);
    return { ...f, properties: { nome: `${TYPES[tp] ?? tp} ${nm.trim()}`.replace(/\s+/g, ' ') } };
  });
console.log(g.features.length, 'feições; tipos desconhecidos:', [...unknown], 'sem nome:', blank);
writeFileSync(output, JSON.stringify(g));
