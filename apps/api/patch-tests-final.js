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
    await prisma.customer.update({ where: { id: authCustomerId }, data: { roles: ['CUSTOMER', 'ADMIN', 'HUB_OPERATOR', 'SUPPLIER'] } });
    `;
    
    // Some files init prisma before, some after. We'll do it securely inside an override if needed.
    // Actually, just doing it after prisma is initialized is better.
    // Find where prisma is initialized
    content = content.replace('prisma = app.get<PrismaService>(PrismaService);', `prisma = app.get<PrismaService>(PrismaService);\n${initHook}`);
  } else {
    // For files that ALREADY have authToken (like care-domain and fulfillment-lifecycle)
    // We just need to give them the roles!
    content = content.replace('authToken = `Bearer ${regRes.body.token}`;', `authToken = \`Bearer \${regRes.body.token}\`;\n    await prisma.customer.update({ where: { id: regRes.body.id }, data: { roles: ['CUSTOMER', 'ADMIN', 'HUB_OPERATOR', 'SUPPLIER'] } });`);
  }

  // Now inject .set('Authorization', authToken) into every request EXCEPT /accounts and /public
  // Because some lines already have it manually, we remove existing ones first to avoid duplicates.
  content = content.replace(/\.set\('Authorization', authToken\)/g, '');
  
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Only match if it doesn't already have .set('Authorization') on this or next line
    if (lines[i].match(/\.(post|get|patch|delete|put)\(['"`]\/(?!accounts|public)(.*)['"`]\)/)) {
      lines[i] = lines[i] + `\n      .set('Authorization', authToken)`;
    }
  }
  
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}
console.log('Patched correctly');
