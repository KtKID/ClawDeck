#!/usr/bin/env node

// scripts/deploy-plugin.mjs — 将 ClawDeck 插件部署到 OpenClaw extensions 目录
//
// 用法：
//   node scripts/deploy-plugin.mjs                     → 全局安装 (~/.openclaw/extensions/clawdeck/)
//   node scripts/deploy-plugin.mjs --workspace /path   → 工作区安装 (<path>/.openclaw/extensions/clawdeck/)
//   node scripts/deploy-plugin.mjs --target /custom    → 自定义目标路径

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

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
  // 默认全局安装
  const home = process.env.HOME || process.env.USERPROFILE;
  targetDir = path.resolve(home, ".openclaw", "extensions", "clawdeck");
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

console.log(`\n  ClawDeck 插件部署`);
console.log(`  源目录:   ${PROJECT_ROOT}`);
console.log(`  目标目录: ${targetDir}\n`);

// 安全检查：防止源目录和目标目录相同（会先删除整个项目目录）
const srcResolved = path.resolve(PROJECT_ROOT);
const destResolved = path.resolve(targetDir);
if (srcResolved === destResolved || destResolved.startsWith(srcResolved + path.sep)) {
  console.error(`\n  ❌ 错误：源目录与目标目录相同或目标是源的子目录！`);
  console.error(`  源目录: ${srcResolved}`);
  console.error(`  目标目录: ${destResolved}`);
  console.error(`\n  这通常意味着项目直接放在了 OpenClaw 插件目录下。`);
  console.error(`  请将项目克隆到其他路径（如 ~/dev/clawdeck），再运行 deploy。`);
  console.error(`  或使用 --target 指定不同的目标路径。\n`);
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

console.log(`\n  部署完成!`);
console.log(`  插件路径: ${targetDir}`);
console.log(`  入口文件: ${path.join(targetDir, "index.ts")}`);
console.log(`\n  下一步:`);
console.log(`  1. 重启 OpenClaw Gateway`);
console.log(`  2. 访问 http://<gateway>/plugins/clawdeck/\n`);
