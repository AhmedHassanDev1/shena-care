export const screenName = 'projects/7772806486169068023/screens/2baae6cfdbb84c50b91c44ebaf4de91e';
export const html = '<!doctype html><html><body>Fixture only — not the user project</body></html>';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const string = { type: 'string' };
const tool = (name, properties = {}, required = []) => ({ name, description: `Test fixture for ${name}`, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const tools = [
  tool('list_projects', { filter: string }),
  tool('get_project', { name: string }, ['name']),
  tool('list_screens', { projectId: string }, ['projectId']),
  { ...tool('get_screen', { name: string }, ['name']), outputSchema: { type: 'object', properties: { theme: { $ref: '#/$defs/Missing' } } } },
  tool('create_project', { title: string }),
  tool('generate_screen_from_text', { projectId: string, prompt: string, deviceType: string }, ['projectId', 'prompt']),
  tool('edit_screens', { projectId: string, selectedScreenIds: { type: 'array', items: string }, prompt: string }, ['projectId', 'selectedScreenIds', 'prompt']),
  tool('delete_project', { name: string }, ['name'])
];
export const screen = {
  name: screenName, title: 'Synthetic test screen',
  htmlCode: { downloadUrl: 'https://lh3.googleusercontent.com/fixture-html' },
  screenshot: { downloadUrl: 'https://lh3.googleusercontent.com/fixture-png' }
};

export class FakeUpstream {
  calls = [];
  available = tools;
  result = { content: [{ type: 'text', text: JSON.stringify(screen) }] };
  async listTools() { return this.available; }
  async callTool(name, args) { this.calls.push({ name, args }); return this.result; }
  async close() {}
}

// Exercises the real Streamable HTTP client without a key or live account.
export function mockFetch(observations = []) {
  return async (input, init = {}) => {
    const url = String(input);
    observations.push({ url, init });
    if (url === screen.htmlCode.downloadUrl) return new Response(html);
    if (url === screen.screenshot.downloadUrl) return new Response(png);
    if (url !== 'https://stitch.googleapis.com/mcp') throw new Error('Unexpected URL in test');
    if (init.method === 'GET' || init.method === 'DELETE') return new Response(null, { status: 405 });
    const message = JSON.parse(init.body);
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result;
    switch (message.method) {
      case 'initialize': result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-stitch', version: '1' } }; break;
      case 'tools/list': result = message.params?.cursor === 'page2' ? { tools: tools.slice(4) } : { tools: tools.slice(0, 4), nextCursor: 'page2' }; break;
      case 'tools/call': result = message.params.name === 'get_screen'
        ? { content: [{ type: 'text', text: JSON.stringify(screen) }] }
        : { content: [{ type: 'text', text: JSON.stringify({ received: message.params }) }] }; break;
      default: throw new Error('Unexpected MCP method in test');
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), { headers: { 'Content-Type': 'application/json' } });
  };
}
