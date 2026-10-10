// Allows isolated test clients without regenerating a running application's client.
const Module = require('module');
const path = require('path');
const client = process.env.PIPELINE_PRISMA_CLIENT;
if (client) {
  if (process.env.NODE_ENV !== 'test' || !path.isAbsolute(client)) throw new Error('Isolated Prisma client is test-only');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    return request === '@prisma/client' ? client : resolve.call(this, request, ...args);
  };
}
