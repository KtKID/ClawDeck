const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(ROOT, 'dev-server.cjs');

let child;
let baseUrl;
let childExitError = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function waitForServerReady() {
  const deadline = Date.now() + 10_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await get('/api/mock-log/path');
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw lastError || new Error('dev server did not become ready in time');
}

describe('dev-server 插件前缀路由', () => {
  before(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    child = spawn(process.execPath, [SERVER_FILE], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.once('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        childExitError = new Error(`dev server exited early: ${detail}`);
        return;
      }
      if (signal && signal !== 'SIGTERM') {
        childExitError = new Error(`dev server exited early with signal: ${signal}`);
      }
    });

    await waitForServerReady();
    if (childExitError) {
      throw childExitError;
    }
  });

  after(async () => {
    if (!child || child.exitCode !== null) return;

    child.kill('SIGTERM');
    await new Promise((resolve) => {
      child.once('exit', resolve);
    });
  });

  it('无尾随斜杠访问插件首页时会重定向到规范路径', async () => {
    const response = await get('/plugins/clawdeck');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/plugins/clawdeck/');
  });

  it('允许通过插件前缀访问 i18n 白名单文件', async () => {
    const response = await get('/plugins/clawdeck/i18n/index.js');

    assert.equal(response.status, 200);
    assert.match(response.body, /translate|i18n|locale/i);
  });

  it('拒绝通过插件前缀访问非白名单根文件', async () => {
    const response = await get('/plugins/clawdeck/install.sh');

    assert.equal(response.status, 404);
    assert.equal(response.body, 'Not Found');
  });
});
