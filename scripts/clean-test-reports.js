const fs = require('node:fs');
const path = require('node:path');

for (const name of ['allure-results', 'allure-report']) {
  fs.rmSync(path.join(__dirname, '..', name), { recursive: true, force: true });
}
