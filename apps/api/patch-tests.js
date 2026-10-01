const fs = require('fs');
const files = [
  'test/integration/care-domain.e2e-spec.ts',
  'test/integration/fulfillment-lifecycle.e2e-spec.ts',
  'test/integration/ingestion-lifecycle.e2e-spec.ts',
  'test/integration/ingestion-enrichment.e2e-spec.ts'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (file === 'test/integration/care-domain.e2e-spec.ts') {
    // Already has authToken
    content = content.replace(/\.post\('(?!\/accounts)(.*?)'\)/g, ".post('$1').set('Authorization', authToken)");
    content = content.replace(/\.patch\('(.*?)'\)/g, ".patch('$1').set('Authorization', authToken)");
    content = content.replace(/\.delete\('(.*?)'\)/g, ".delete('$1').set('Authorization', authToken)");
  } else {
    // Add auth setup
    if (!content.includes('let authToken')) {
      content = content.replace(/let app: INestApplication;/, "let app: INestApplication;\n  let authToken: string;");
      content = content.replace(/await app\.init\(\);/, "await app.init();\n    const res = await request(app.getHttpServer()).post('/accounts/register').send({name:'Test', email:'test'+Date.now()+'@example.com', password:'password123'});\n    authToken = 'Bearer ' + res.body.token;");
      
      content = content.replace(/\.post\('(.*?)'\)/g, ".post('$1').set('Authorization', authToken)");
      content = content.replace(/\.patch\('(.*?)'\)/g, ".patch('$1').set('Authorization', authToken)");
      content = content.replace(/\.delete\('(.*?)'\)/g, ".delete('$1').set('Authorization', authToken)");
    }
  }
  fs.writeFileSync(file, content, 'utf8');
}
console.log('Patched test files');
