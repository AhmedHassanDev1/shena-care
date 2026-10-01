const fs = require('fs');

const files = [
  'test/integration/care-domain.e2e-spec.ts',
  'test/integration/fulfillment-lifecycle.e2e-spec.ts',
  'test/integration/ingestion-lifecycle.e2e-spec.ts',
  'test/integration/ingestion-enrichment.e2e-spec.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (!content.includes('let authToken: string;')) {
    content = content.replace('let app: INestApplication;', 'let app: INestApplication;\n  let authToken: string;\n  let authCustomerId: string;');
    
    const initHook = `
    await app.init();
    const regRes = await request(app.getHttpServer())
      .post('/accounts/register')
      .send({ name: 'Tester', email: 'test' + Date.now() + '@test.com', password: 'Password!123' });
    authToken = 'Bearer ' + regRes.body.token;
    authCustomerId = regRes.body.id;
    `;
    
    content = content.replace('await app.init();', initHook);
  }

  // Now inject .set('Authorization', authToken) into every request EXCEPT /accounts
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/\.(post|get|patch|delete|put)\(['"`]\/(?!accounts|public)(.*)['"`]\)/)) {
      lines[i] = lines[i] + `\n      .set('Authorization', authToken)`;
    }
  }
  
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}
console.log('Done!');
