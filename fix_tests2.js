const fs = require('fs');
let code = fs.readFileSync('apps/api/test/integration/fulfillment-lifecycle.e2e-spec.ts', 'utf8');

code = code.replace(/shippingAddress:\s*'([^']+)'/g, "shippingAddress: '$1',\n        governorate: 'Cairo',\n        area: 'Maadi'");

fs.writeFileSync('apps/api/test/integration/fulfillment-lifecycle.e2e-spec.ts', code);
