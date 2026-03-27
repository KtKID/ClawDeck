const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'deploy-plugin.mjs');

function makeTempTarget() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdeck-deploy-'));
  return {
    baseDir,
    targetDir: path.join(baseDir, 'extensions', 'clawdeck'),
  };
}

test('部署到自定义目标目录时会复制 i18n 目录', () => {
  const { baseDir, targetDir } = makeTempTarget();

  try {
    const result = spawnSync(process.execPath, [SCRIPT, '--target', targetDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(targetDir, 'i18n', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(targetDir, 'i18n', 'locales', 'zh.js')), true);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
