const fs = require('fs');
let code = fs.readFileSync('apps/api/test/integration/fulfillment-lifecycle.e2e-spec.ts', 'utf8');

// Update role to ADMIN
code = code.replace(
  /authToken = `Bearer \${regRes.body.token}`;/,
  "authToken = `Bearer ${regRes.body.token}`;\n    await prisma.customer.update({ where: { email }, data: { role: 'ADMIN' } });"
);

// Add .set('Authorization', authToken) to all /fulfillment routes
code = code.replace(
  /\.(get|post|patch|delete|put)\((['"`])\/fulfillment([^'"`]*)\2\)/g,
  ".$1($2/fulfillment$3$2).set('Authorization', authToken)"
);

fs.writeFileSync('apps/api/test/integration/fulfillment-lifecycle.e2e-spec.ts', code);
