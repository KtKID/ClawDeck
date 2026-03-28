#!/usr/bin/env node

// scripts/deploy-plugin.mjs — 生成 ClawDeck 标准插件产物目录
//
// 用法：
//   node scripts/deploy-plugin.mjs                     → 标准产物 (dist/plugin-package/clawdeck/)
//   node scripts/deploy-plugin.mjs --workspace /path   → 工作区安装 (<path>/.openclaw/extensions/clawdeck/)
//   node scripts/deploy-plugin.mjs --target /custom    → 自定义目标路径

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGE_DIR = path.join(PROJECT_ROOT, "dist", "plugin-package", "clawdeck");

// --- 解析参数 ---
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

let targetDir;

if (args.includes("--target")) {
  targetDir = path.resolve(getArg("--target"));
} else if (args.includes("--workspace")) {
  const ws = getArg("--workspace");
  if (!ws) {
    console.error("错误: --workspace 需要指定工作区路径");
    process.exit(1);
  }
  targetDir = path.resolve(ws, ".openclaw", "extensions", "clawdeck");
} else {
  targetDir = DEFAULT_PACKAGE_DIR;
}

// --- 定义要复制的内容 ---

// 插件自身文件（plugin/ → target/）
const PLUGIN_FILES = [
  "index.ts",
  "openclaw.plugin.json",
  "package.json",
];

// 插件 src 目录
const PLUGIN_DIRS = [
  "src",
  "assets",
];

// 从项目根目录复制的前端资源目录
const FRONTEND_DIRS = [
  "engine",
  "world",
  "ui",
  "bridge",
  "css",
  "i18n",
];

// --- 工具函数 ---

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- 执行部署 ---

console.log(`\n  ClawDeck 插件产物生成`);
console.log(`  源目录:   ${PROJECT_ROOT}`);
console.log(`  目标目录: ${targetDir}\n`);

// 安全检查：防止误删源码目录；默认标准产物目录是唯一允许的项目内输出位置
const srcResolved = path.resolve(PROJECT_ROOT);
const destResolved = path.resolve(targetDir);
const defaultPackageResolved = path.resolve(DEFAULT_PACKAGE_DIR);
const isDefaultPackageDir = destResolved === defaultPackageResolved;
if (srcResolved === destResolved || (destResolved.startsWith(srcResolved + path.sep) && !isDefaultPackageDir)) {
  console.error(`\n  ❌ 错误：目标目录不能直接写到源码目录内部。`);
  console.error(`  源目录: ${srcResolved}`);
  console.error(`  目标目录: ${destResolved}`);
  console.error(`\n  允许的项目内默认输出目录只有: ${defaultPackageResolved}`);
  console.error(`  如需写入其他位置，请使用 --target 指定源码目录外的路径。\n`);
  process.exit(1);
}

// 清理旧部署
cleanDir(targetDir);
fs.mkdirSync(targetDir, { recursive: true });

// 1. 复制插件文件
for (const file of PLUGIN_FILES) {
  const src = path.join(PROJECT_ROOT, "plugin", file);
  const dest = path.join(targetDir, file);
  fs.copyFileSync(src, dest);
  console.log(`  复制 plugin/${file}`);
}

// 2. 复制插件子目录（src/, assets/）
for (const dir of PLUGIN_DIRS) {
  const src = path.join(PROJECT_ROOT, "plugin", dir);
  const dest = path.join(targetDir, dir);
  copyDir(src, dest);
  console.log(`  复制 plugin/${dir}/`);
}

// 3. 复制前端资源目录
for (const dir of FRONTEND_DIRS) {
  const src = path.join(PROJECT_ROOT, dir);
  const dest = path.join(targetDir, dir);
  if (!fs.existsSync(src)) {
    console.log(`  跳过 ${dir}/ (不存在)`);
    continue;
  }
  copyDir(src, dest);
  console.log(`  复制 ${dir}/`);
}

console.log(`\n  标准插件产物已生成!`);
console.log(`  插件根目录: ${targetDir}`);
console.log(`  入口文件: ${path.join(targetDir, "index.ts")}`);
console.log(`\n  建议下一步:`);
console.log(`  1. openclaw plugins install ${targetDir}`);
console.log(`  2. openclaw plugins enable clawdeck`);
console.log(`  3. openclaw gateway restart\n`);
