const fs = require('fs');
let file = 'test/integration/fulfillment-lifecycle.e2e-spec.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/\.post\('(?!\/accounts)(.*?)'\)/g, ".post('$1').set('Authorization', authToken)");
content = content.replace(/\.patch\('(.*?)'\)/g, ".patch('$1').set('Authorization', authToken)");
content = content.replace(/\.delete\('(.*?)'\)/g, ".delete('$1').set('Authorization', authToken)");
fs.writeFileSync(file, content, 'utf8');
console.log('Patched fulfillment file');
