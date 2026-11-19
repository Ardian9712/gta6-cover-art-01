import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';

// The configured MCP's Chrome channel is absent in this environment. This
// standard-library client runs the already cached Playwright MCP against the
// already installed Chromium. --offline forbids package downloads. All session
// recordings and browser temporary files stay inside this repository.
function installedChromium() {
  if (process.env.VICEFRAME_BROWSER) {
    if (!existsSync(process.env.VICEFRAME_BROWSER)) throw new Error('VICEFRAME_BROWSER does not name an installed executable.');
    return process.env.VICEFRAME_BROWSER;
  }
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const version of readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      for (const platform of ['chrome-linux64', 'chrome-linux']) {
        const executable = join(cache, version, platform, 'chrome');
        if (existsSync(executable)) return executable;
      }
    }
  }
  throw new Error('No cached Chromium found. Set VICEFRAME_BROWSER to the installed browser path.');
}

export async function connectMCP(label = 'browser') {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('MCP evidence labels must be simple directory names.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = join(root, '.verification', 'pass-2', 'mcp', label);
  // Chromium's Unix socket needs a path shorter than 108 bytes.
  const temporary = join(root, '.t');
  mkdirSync(output, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  const browser = installedChromium();
  const processMCP = spawn('npx', [
    '--offline', '@playwright/mcp', '--headless', '--isolated', '--no-sandbox',
    '--ignore-roots', '--block-service-workers', '--allow-unrestricted-file-access',
    '--executable-path', browser, '--output-dir', output, '--save-session',
  ], { cwd: root, env: { ...process.env, TMPDIR: temporary, npm_config_logs_dir: join(output, 'npm-logs') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0;
  let buffer = '';
  let closed = false;
  const record = (value) => appendFileSync(join(output, 'client-calls.jsonl'), `${JSON.stringify(value)}\n`);
  processMCP.stderr.on('data', (chunk) => appendFileSync(join(output, 'server-stderr.log'), chunk));
  processMCP.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let response;
      try { response = JSON.parse(line); }
      catch {
        const error = new Error(`Playwright MCP wrote invalid JSON: ${line.slice(0, 160)}`);
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
        pending.clear();
        processMCP.kill('SIGTERM');
        return;
      }
      if (response.method === 'roots/list') {
        processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: response.id, result: { roots: [{ uri: pathToFileURL(root).href, name: 'Viceframe repository' }] } })}\n`);
      } else if (pending.has(response.id)) {
        const item = pending.get(response.id); pending.delete(response.id); clearTimeout(item.timer);
        if (response.error) item.reject(new Error(JSON.stringify(response.error)));
        else item.resolve(response.result);
      }
    }
  });
  function rejectPending(error) {
    closed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  processMCP.on('error', rejectPending);
  processMCP.on('exit', (code) => {
    closed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Playwright MCP exited (${code}).`)); }
    pending.clear();
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('The Playwright MCP connection is closed.')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'viceframe-pass-2-verifier', version: '1.2.0' } });
  record({ phase: 'initialize', browser, server: initialized.serverInfo, evidence: label, noSandbox: true, offlinePackages: true });
  processMCP.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const available = await request('tools/list');
  const required = ['browser_run_code_unsafe', 'browser_take_screenshot', 'browser_file_upload'];
  for (const name of required) {
    if (!available.tools.some(tool => tool.name === name)) {
      processMCP.kill('SIGTERM');
      throw new Error(`This Playwright MCP server is missing ${name}.`);
    }
  }
  record({ phase: 'tool-contract', required, available: available.tools.length });
  return {
    root,
    output,
    list: () => request('tools/list'),
    async call(name, args = {}) {
      record({ tool: name, arguments: args });
      const result = await request('tools/call', { name, arguments: args });
      record({ tool: name, result: result.content?.filter((item) => item.type !== 'image'), isError: result.isError || false });
      if (result.isError) throw new Error(result.content?.map((item) => item.text || '').join('\n') || `MCP tool failed: ${name}`);
      return result;
    },
    async close() {
      if (closed) return;
      try { await request('tools/call', { name: 'browser_close', arguments: {} }); } finally { processMCP.stdin.end(); processMCP.kill('SIGTERM'); }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = await connectMCP('tool-list');
  try {
    const list = await client.list();
    console.log(JSON.stringify(list.tools.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2));
  } finally { await client.close(); }
}
