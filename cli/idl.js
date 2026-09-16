#!/usr/bin/env node
/*
 * @lec/idl-cli — 薄 IDL 拉取/生成 CLI（参考实现）。
 *
 * 安全边界（对应 docs/architecture/platform-services-and-rpc.md §6.4）：
 * - 只把远端分支当数据源（proto/openapi/schema），绝不执行远端携带的任何脚本；
 * - 生成器版本固定在本 CLI 依赖或调用命令中；
 * - 不在 postinstall 运行；必须由 `npm run idl` 显式触发；
 * - 每个 service 的 ref 解析为精确 commit SHA 并写入 idl.lock.json，保证可复现。
 *
 * 用法：
 *   idl                       依据 idl.config.json 拉取+生成全部 service
 *   idl --service doc@feature/x  临时覆盖单个 service 的 ref
 *   idl --check               仅校验 lock 是否与远端解析一致（CI 用），不写文件
 *   idl --resolve-only        仅解析 ref→SHA 并写 lock，不下载/生成（离线冒烟）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const CONFIG_FILE = 'idl.config.json';
const LOCK_FILE = 'idl.lock.json';
const DEFAULT_REPO = 'lec-org/lec-idl';
const REF_RE = /^lec\.[a-z]+@[^\s]+$/;

function fail(msg) {
  console.error(`idl: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { overrides: {}, check: false, resolveOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--resolve-only') args.resolveOnly = true;
    else if (a === '--service') {
      const val = argv[++i];
      if (!val || !val.includes('@')) fail('--service 需要 alias@ref 或 lec.space@ref');
      // 允许 alias@ref（用配置里已有 space）或 lec.space@ref
      args.overrides.__pending = val;
    } else fail(`未知参数：${a}`);
  }
  return args;
}

function loadConfig(cwd) {
  const p = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(p)) fail(`找不到 ${CONFIG_FILE}`);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(`${CONFIG_FILE} 不是合法 JSON：${e.message}`); }
  if (!cfg.services || typeof cfg.services !== 'object') fail('config.services 缺失');
  if (!cfg.outDir) fail('config.outDir 缺失');
  for (const [alias, spec] of Object.entries(cfg.services)) {
    if (typeof spec !== 'string' || !REF_RE.test(spec)) {
      fail(`service "${alias}" 的值必须形如 "lec.<space>@<ref>"，实际：${spec}`);
    }
  }
  cfg.repo = cfg.repo || DEFAULT_REPO;
  return cfg;
}

// 用 git ls-remote 解析 ref→SHA（分支/tag）；若已是 40 位 SHA 则原样使用。
function resolveRef(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const url = `https://github.com/${repo}.git`;
  let out;
  try {
    out = execFileSync('git', ['ls-remote', url, ref, `refs/heads/${ref}`, `refs/tags/${ref}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    fail(`解析 ${repo}@${ref} 失败：${(e.stderr || e.message || '').toString().trim()}`);
  }
  const line = out.split('\n').find(Boolean);
  if (!line) fail(`在 ${repo} 未找到 ref：${ref}`);
  const sha = line.split('\t')[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) fail(`解析出的 SHA 非法：${sha}`);
  return sha;
}

function readLock(cwd) {
  const p = path.join(cwd, LOCK_FILE);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeLock(cwd, lock) {
  fs.writeFileSync(path.join(cwd, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
}

function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(cwd);

  // 处理 --service 覆盖
  if (args.overrides.__pending) {
    const raw = args.overrides.__pending;
    let alias, spec;
    if (raw.startsWith('lec.')) {
      const space = raw.slice(4).split('@')[0];
      alias = Object.keys(cfg.services).find(
        (k) => cfg.services[k].startsWith(`lec.${space}@`)
      ) || space;
      spec = raw;
    } else {
      alias = raw.split('@')[0];
      const ref = raw.split('@')[1];
      const base = cfg.services[alias];
      if (!base) fail(`config 中没有 service alias："${alias}"`);
      spec = `${base.split('@')[0]}@${ref}`;
    }
    cfg.services[alias] = spec;
  }

  const resolved = {};
  for (const [alias, spec] of Object.entries(cfg.services)) {
    const space = spec.slice(4).split('@')[0];
    const ref = spec.split('@')[1];
    const sha = resolveRef(cfg.repo, ref);
    resolved[alias] = { space, requestedRef: ref, resolvedCommit: sha };
    console.log(`idl: ${alias} -> lec.${space}@${ref} = ${sha}`);
  }

  const lock = {
    repo: cfg.repo,
    generatedAt: new Date().toISOString(),
    services: resolved,
  };

  if (args.check) {
    const existing = readLock(cwd);
    if (!existing) fail(`--check：缺少 ${LOCK_FILE}`);
    for (const [alias, r] of Object.entries(resolved)) {
      const e = existing.services && existing.services[alias];
      if (!e) fail(`--check：lock 缺少 service "${alias}"`);
      if (e.resolvedCommit !== r.resolvedCommit) {
        fail(`--check：service "${alias}" 已过期 (lock=${e.resolvedCommit} remote=${r.resolvedCommit})`);
      }
    }
    console.log('idl: --check 通过，lock 与远端解析一致');
    return;
  }

  writeLock(cwd, lock);
  console.log(`idl: 已写入 ${LOCK_FILE}`);

  if (args.resolveOnly) {
    console.log('idl: --resolve-only，跳过下载与生成');
    return;
  }

  // 生成阶段：由固定生成器执行。此处仅打印计划；具体生成命令由前端仓的
  // package.json scripts 固定（buf generate / openapi-typescript），CLI 不执行远端脚本。
  console.log('idl: 生成阶段需前端仓固定的生成器（buf generate / openapi-typescript）。');
  console.log('idl: 参考 cli/README.md 的集成说明。');
}

main();
