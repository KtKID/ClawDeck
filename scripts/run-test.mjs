#!/usr/bin/env node

/**
 * run-test.mjs — 统一测试运行器
 *
 * 用法:
 *   node scripts/run-test.mjs --all              跑全部测试 + fixture 校验
 *   node scripts/run-test.mjs test/sender.test.mjs  跑指定文件
 *   node scripts/run-test.mjs test/a.mjs test/b.cjs 跑多个文件
 *
 * 每次执行后在 test/report/ 生成 Markdown 报告。
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const REPORT_DIR = join(ROOT, 'test', 'report');
const TEST_DIR = join(ROOT, 'test');

// ─── 参数解析 ───────────────────────────────────────────────

const args = process.argv.slice(2);
const isAll = args.includes('--all');
const testFiles = isAll ? discoverTestFiles() : args.filter(a => !a.startsWith('-'));

if (testFiles.length === 0) {
  console.error('用法: node scripts/run-test.mjs --all | <test-file ...>');
  process.exit(1);
}

function discoverTestFiles() {
  return readdirSync(TEST_DIR)
    .filter(f => /\.test\.(mjs|cjs|js)$/.test(f))
    .sort()
    .map(f => join('test', f));
}

// ─── TAP 解析 ───────────────────────────────────────────────

function parseTap(raw) {
  const lines = raw.split('\n');
  const cases = [];
  let currentSuite = '';

  for (const line of lines) {
    // 顶层 subtest 作为 suite 名
    const suiteMatch = line.match(/^    # Subtest: (.+)/);
    if (suiteMatch) {
      currentSuite = suiteMatch[1];
      continue;
    }

    // 叶子用例 — 8 空格缩进的 ok / not ok
    const caseMatch = line.match(/^        (ok|not ok) \d+ - (.+)/);
    if (caseMatch) {
      cases.push({
        passed: caseMatch[1] === 'ok',
        name: caseMatch[2].trim(),
        suite: currentSuite,
        error: null,
      });
      continue;
    }
  }

  // 尝试提取失败用例的错误信息（紧跟在 not ok 后的缩进行）
  let inFailBlock = false;
  let failIdx = -1;
  const errorLines = [];

  for (const line of lines) {
    if (/^        not ok/.test(line)) {
      // 保存之前收集的错误
      if (failIdx >= 0 && errorLines.length) {
        cases[failIdx].error = errorLines.join('\n');
      }
      inFailBlock = true;
      failIdx = cases.findIndex((c, i) => !c.passed && i > failIdx);
      errorLines.length = 0;
      continue;
    }
    if (inFailBlock) {
      // YAML block 里的诊断信息
      if (/^          /.test(line) && !line.trim().startsWith('---') &&
          !line.trim().startsWith('...') && !line.trim().startsWith('duration_ms') &&
          !line.trim().startsWith("type:")) {
        errorLines.push(line.trim());
      }
      if (/^        (ok|not ok|1\.\.)/.test(line) || /^    (ok|not ok|1\.\.)/.test(line)) {
        inFailBlock = false;
      }
    }
  }
  if (failIdx >= 0 && errorLines.length) {
    cases[failIdx].error = errorLines.join('\n');
  }

  // 从尾部统计行提取汇总
  const summary = {};
  for (const line of lines) {
    const m = line.match(/^# (tests|pass|fail|duration_ms) (.+)/);
    if (m) summary[m[1]] = m[2].trim();
  }

  return { cases, summary };
}

// ─── 运行测试 ───────────────────────────────────────────────

/** @returns {{ file: string, tap: string, exitCode: number, durationMs: number }} */
function runTestFile(file) {
  const start = Date.now();
  let tap = '';
  let exitCode = 0;
  try {
    tap = execSync(
      `node --test --test-reporter=tap --test-force-exit ${file}`,
      { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 }
    );
  } catch (e) {
    tap = (e.stdout || '') + '\n' + (e.stderr || '');
    exitCode = e.status ?? 1;
  }
  return { file, tap, exitCode, durationMs: Date.now() - start };
}

function runFixtureCheck() {
  try {
    const out = execSync('node scripts/validate-fixtures.mjs', {
      cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
    });
    return { output: out, passed: true };
  } catch (e) {
    return { output: (e.stdout || '') + '\n' + (e.stderr || ''), passed: false };
  }
}

// ─── 解析 fixture 输出 ──────────────────────────────────────

function parseFixtureOutput(raw) {
  const lines = raw.split('\n');
  const files = [];
  let coverageInfo = '';

  for (const line of lines) {
    const okMatch = line.match(/✓ (.+?) \((\d+) 条事件\)/);
    if (okMatch) {
      files.push({ name: okMatch[1], events: parseInt(okMatch[2]), ok: true });
      continue;
    }
    const failMatch = line.match(/✗ (.+?): (.+)/);
    if (failMatch) {
      files.push({ name: failMatch[1], events: 0, ok: false, error: failMatch[2] });
      continue;
    }
    const covMatch = line.match(/覆盖事件类型: (.+)/);
    if (covMatch) coverageInfo = covMatch[1];
  }

  return { files, coverageInfo };
}

// ─── 生成 Markdown ──────────────────────────────────────────

function generateReport(results, fixtureResult) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const nodeVersion = process.version;

  let md = `# ClawDeck 测试报告\n\n`;
  md += `**日期**: ${dateStr} ${timeStr}  \n`;
  md += `**Node.js**: ${nodeVersion}\n\n`;

  // 总览表格
  md += `## 总览\n\n`;
  md += `| 测试文件 | 通过 | 失败 | 耗时 |\n`;
  md += `|----------|------|------|------|\n`;

  let totalPass = 0;
  let totalFail = 0;
  let totalMs = 0;

  for (const r of results) {
    const parsed = r.parsed;
    const pass = parsed.cases.filter(c => c.passed).length;
    const fail = parsed.cases.filter(c => !c.passed).length;
    const ms = r.durationMs;
    totalPass += pass;
    totalFail += fail;
    totalMs += ms;
    md += `| ${basename(r.file)} | ${pass} | ${fail} | ${formatMs(ms)} |\n`;
  }

  md += `| **合计** | **${totalPass}** | **${totalFail}** | **${formatMs(totalMs)}** |\n\n`;

  // Fixture 校验
  if (fixtureResult) {
    const fix = parseFixtureOutput(fixtureResult.output);
    md += `## Fixture 校验\n\n`;
    if (fix.files.length > 0) {
      md += `| 文件 | 事件数 | 状态 |\n`;
      md += `|------|--------|------|\n`;
      for (const f of fix.files) {
        const status = f.ok ? '✓' : `✗ ${f.error || ''}`;
        md += `| ${f.name} | ${f.events} | ${status} |\n`;
      }
      md += `\n`;
    }
    if (fix.coverageInfo) {
      md += `覆盖事件类型: ${fix.coverageInfo}\n\n`;
    }
    md += `校验状态: ${fixtureResult.passed ? '全部通过 ✓' : '存在失败 ✗'}\n\n`;
  }

  // 详细结果
  md += `## 详细结果\n\n`;
  for (const r of results) {
    md += `### ${basename(r.file)}\n\n`;
    if (r.parsed.cases.length === 0) {
      md += `_无法解析测试用例（可能执行失败）_\n\n`;
      if (r.tap.trim()) {
        md += `<details><summary>原始输出</summary>\n\n\`\`\`\n${r.tap.trim()}\n\`\`\`\n\n</details>\n\n`;
      }
      continue;
    }

    let lastSuite = '';
    for (const c of r.parsed.cases) {
      if (c.suite && c.suite !== lastSuite) {
        md += `\n**${c.suite}**\n\n`;
        lastSuite = c.suite;
      }
      const icon = c.passed ? '✓' : '✗';
      md += `- ${icon} ${c.name}\n`;
      if (!c.passed && c.error) {
        md += `  \`\`\`\n  ${c.error}\n  \`\`\`\n`;
      }
    }
    md += `\n`;
  }

  // 结论
  md += `## 结论\n\n`;
  const fixtureStatus = fixtureResult
    ? (fixtureResult.passed ? ', fixture 校验通过' : ', fixture 校验失败')
    : '';
  if (totalFail === 0) {
    md += `**${totalPass} 通过, 0 失败${fixtureStatus}** ✓\n`;
  } else {
    md += `**${totalPass} 通过, ${totalFail} 失败${fixtureStatus}** ✗\n`;
  }

  return md;
}

function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

// ─── 主流程 ─────────────────────────────────────────────────

mkdirSync(REPORT_DIR, { recursive: true });

console.log(`\n运行测试文件: ${testFiles.join(', ')}\n`);

const results = [];
let hasFailure = false;

for (const file of testFiles) {
  const result = runTestFile(file);
  result.parsed = parseTap(result.tap);
  results.push(result);

  const pass = result.parsed.cases.filter(c => c.passed).length;
  const fail = result.parsed.cases.filter(c => !c.passed).length;
  const icon = fail > 0 ? '✗' : '✓';
  console.log(`  ${icon} ${basename(file)}: ${pass} 通过, ${fail} 失败 (${formatMs(result.durationMs)})`);
  if (fail > 0 || result.exitCode !== 0) hasFailure = true;
}

// fixture 校验
let fixtureResult = null;
if (isAll) {
  console.log(`\n运行 fixture 校验...`);
  fixtureResult = runFixtureCheck();
  console.log(`  ${fixtureResult.passed ? '✓' : '✗'} fixture 校验${fixtureResult.passed ? '通过' : '失败'}`);
  if (!fixtureResult.passed) hasFailure = true;
}

// 生成报告
const now = new Date();
const dateTimeStr = `${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
let reportName;
if (isAll) {
  reportName = `${dateTimeStr}_all.md`;
} else if (testFiles.length === 1) {
  reportName = `${dateTimeStr}_${basename(testFiles[0]).replace(/\.(test\.)?(mjs|cjs|js)$/, '')}.md`;
} else {
  const scriptName = process.env.npm_lifecycle_event;
  const suffix = scriptName ? scriptName.replace('test:', '') : 'multi';
  reportName = `${dateTimeStr}_${suffix}.md`;
}

const reportPath = join(REPORT_DIR, reportName);
const markdown = generateReport(results, fixtureResult);
writeFileSync(reportPath, markdown, 'utf-8');

console.log(`\n报告已生成: test/report/${reportName}`);

if (hasFailure) {
  console.log('\n存在失败的测试 ✗');
  process.exit(1);
} else {
  console.log('\n全部通过 ✓');
}
