import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

// The configured MCP's Chrome channel is absent in this environment. This
// standard-library client runs the already cached Playwright MCP against the
// already installed Chromium. --offline forbids package downloads. All session
// recordings and browser temporary files stay inside this repository.
export async function connectMCP() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = join(root, '.verification', 'mcp');
  // Chromium's Unix socket needs a path shorter than 108 bytes.
  const temporary = join(root, '.t');
  mkdirSync(output, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  const browser = process.env.VICEFRAME_BROWSER || '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
  const processMCP = spawn('npx', [
    '--offline', '@playwright/mcp', '--headless', '--isolated', '--no-sandbox',
    '--ignore-roots', '--block-service-workers', '--allow-unrestricted-file-access',
    '--executable-path', browser, '--output-dir', output, '--save-session',
  ], { cwd: root, env: { ...process.env, TMPDIR: temporary }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  let buffer = '';
  const record = (value) => appendFileSync(join(output, 'client-calls.jsonl'), `${JSON.stringify(value)}\n`);
  processMCP.stderr.on('data', (chunk) => appendFileSync(join(output, 'server-stderr.log'), chunk));
  processMCP.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const response = JSON.parse(line);
      if (response.method === 'roots/list') {
        processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: response.id, result: { roots: [{ uri: pathToFileURL(root).href, name: 'Viceframe repository' }] } })}\n`);
      } else if (pending.has(response.id)) {
        const item = pending.get(response.id); pending.delete(response.id); clearTimeout(item.timer);
        if (response.error) item.reject(new Error(JSON.stringify(response.error)));
        else item.resolve(response.result);
      }
    }
  });
  processMCP.on('exit', (code) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Playwright MCP exited (${code}).`)); }
    pending.clear();
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'viceframe-offline-verifier', version: '1.0.0' } });
  processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    list: () => request('tools/list'),
    async call(name, args = {}) {
      record({ tool: name, arguments: args });
      const result = await request('tools/call', { name, arguments: args });
      record({ tool: name, result: result.content?.filter((item) => item.type !== 'image'), isError: result.isError || false });
      if (result.isError) throw new Error(result.content?.map((item) => item.text || '').join('\n') || `MCP tool failed: ${name}`);
      return result;
    },
    async close() {
      try { await request('tools/call', { name: 'browser_close', arguments: {} }); } finally { processMCP.stdin.end(); processMCP.kill('SIGTERM'); }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = await connectMCP();
  try {
    const list = await client.list();
    console.log(JSON.stringify(list.tools.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2));
  } finally { await client.close(); }
}
