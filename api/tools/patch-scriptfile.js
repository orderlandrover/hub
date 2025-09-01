// node api/tools/patch-scriptfile.js
const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '..');

function isFunctionDir(dir) {
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return false;
  return fs.existsSync(path.join(dir, 'function.json'));
}

function patchOne(funcDir) {
  const name = path.basename(funcDir);
  const fj = path.join(funcDir, 'function.json');
  try {
    const raw = fs.readFileSync(fj, 'utf8');
    const json = JSON.parse(raw);

    const expected = `../dist/${name}/index.js`;
    if (json.scriptFile === expected) {
      console.log(`✔ ${name}: scriptFile redan korrekt`);
      return;
    }

    json.scriptFile = expected;

    fs.writeFileSync(fj, JSON.stringify(json, null, 2));
    console.log(`★ ${name}: scriptFile satt till ${expected}`);
  } catch (e) {
    console.error(`!! Misslyckades för ${name}:`, e.message);
  }
}

const entries = fs.readdirSync(apiDir)
  .map(n => path.join(apiDir, n))
  .filter(isFunctionDir);

if (entries.length === 0) {
  console.error('Inga function.json hittades i api/');
  process.exit(1);
}

for (const d of entries) patchOne(d);

console.log('\nKlart. Kör nu:  cd api && npm run build');
