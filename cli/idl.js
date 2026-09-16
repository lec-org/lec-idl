#!/usr/bin/env node
'use strict';

// Remote refs are data only: this program checks out proto/OpenAPI files and invokes
// only generators pinned in this package. It never runs hooks, package scripts, or
// executables from the checked-out repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_FILE = 'idl.config.json';
const LOCK_FILE = 'idl.lock.json';
const DEFAULT_REPO = 'lec-org/lec-idl';
const REF_RE = /^lec\.([a-z]+)@([A-Za-z0-9][A-Za-z0-9._/-]*|[0-9a-f]{40})$/;
const ALIAS_RE = /^[a-z][a-z0-9_-]*$/;
const PROTO_SPACES = new Set(['core', 'chat', 'identity', 'events']);
const OPENAPI_SPACES = new Set(['core', 'doc']);

function die(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { service: null, check: false, resolveOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--resolve-only') args.resolveOnly = true;
    else if (argv[i] === '--service') args.service = argv[++i] || die('--service 缺少值');
    else die(`未知参数：${argv[i]}`);
  }
  if (args.check && args.resolveOnly) die('--check 与 --resolve-only 不能同时使用');
  return args;
}

function loadConfig(cwd) {
  const file = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(file)) die(`找不到 ${CONFIG_FILE}`);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.outDir || !config.services || typeof config.services !== 'object') {
    die('config 必须包含 outDir 与 services');
  }
  const outDir = path.resolve(cwd, config.outDir);
  if (outDir === cwd || !outDir.startsWith(`${cwd}${path.sep}`)) die('outDir 必须是消费仓内的子目录');
  for (const [alias, spec] of Object.entries(config.services)) {
    if (!ALIAS_RE.test(alias)) die(`service alias 非法：${alias}`);
    if (!REF_RE.test(spec)) die(`service "${alias}" 必须形如 lec.<space>@<ref>`);
  }
  config.repo = config.repo || DEFAULT_REPO;
  return config;
}

function repoUrl(repo) {
  return repo.includes('://') || repo.startsWith('/') || repo.startsWith('.')
    ? repo
    : `https://github.com/${repo}.git`;
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function resolveRef(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const output = run('git', ['ls-remote', repoUrl(repo), `refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`]);
  const lines = output.split('\n').filter(Boolean);
  const line = lines.find((item) => item.endsWith(`refs/tags/${ref}^{}`)) || lines[0];
  if (!line) die(`在 ${repo} 未找到 ref：${ref}`);
  const sha = line.split('\t')[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) die(`解析出的 SHA 非法：${sha}`);
  return sha;
}

function applyOverride(config, raw) {
  if (!raw) return;
  const at = raw.indexOf('@');
  if (at < 1 || at === raw.length - 1) die('--service 需要 alias@ref 或 lec.space@ref');
  if (raw.startsWith('lec.')) {
    const match = REF_RE.exec(raw);
    if (!match) die('--service 需要 lec.space@ref');
    const space = match[1];
    const alias = Object.keys(config.services).find((key) => config.services[key].startsWith(`lec.${space}@`)) || space;
    config.services[alias] = raw;
    return;
  }
  const alias = raw.slice(0, at);
  const current = config.services[alias];
  if (!current) die(`config 中没有 service alias：${alias}`);
  config.services[alias] = `${current.slice(0, current.indexOf('@'))}@${raw.slice(at + 1)}`;
}

function resolveServices(config) {
  const services = {};
  for (const [alias, spec] of Object.entries(config.services)) {
    const [, space, ref] = REF_RE.exec(spec);
    const resolvedCommit = resolveRef(config.repo, ref);
    services[alias] = { space, requestedRef: ref, resolvedCommit };
    console.log(`idl: ${alias} -> lec.${space}@${ref} = ${resolvedCommit}`);
  }
  return services;
}

function comparableLock(lock) {
  return JSON.stringify({ repo: lock.repo, services: lock.services });
}

function cloneAt(repo, ref, sha, destination) {
  fs.mkdirSync(destination, { recursive: true });
  run('git', ['-c', 'core.hooksPath=/dev/null', '-C', destination, 'init', '--quiet']);
  run('git', ['-c', 'core.hooksPath=/dev/null', '-C', destination, 'remote', 'add', 'origin', repoUrl(repo)]);
  run('git', ['-c', 'core.hooksPath=/dev/null', '-C', destination, 'fetch', '--quiet', '--depth', '1', 'origin', /^[0-9a-f]{40}$/.test(ref) ? sha : ref]);
  run('git', ['-c', 'core.hooksPath=/dev/null', '-C', destination, 'checkout', '--quiet', '--detach', sha]);
}

function localBin(name) {
  const file = path.join(__dirname, 'node_modules', '.bin', name);
  if (!fs.existsSync(file)) die(`缺少固定生成器 ${name}；请先在 @lec/idl-cli 安装依赖`);
  return file;
}

function generateService(checkout, alias, space, outputRoot, workRoot) {
  const target = path.join(outputRoot, alias);
  fs.mkdirSync(target, { recursive: true });

  if (PROTO_SPACES.has(space)) {
    const protoPath = `lec/${space}/v1`;
    const source = path.join(checkout, 'proto', protoPath);
    if (!fs.existsSync(source)) die(`契约缺失：proto/${protoPath}`);
    const template = path.join(workRoot, `buf-${alias}.gen.yaml`);
    fs.writeFileSync(template, [
      'version: v2',
      'plugins:',
      `  - local: ${localBin('protoc-gen-es')}`,
      `    out: ${path.join(target, 'proto')}`,
      '    opt:',
      '      - target=ts',
      '',
    ].join('\n'));
    run(localBin('buf'), ['generate', '--path', `proto/${protoPath}`, '--template', template], { cwd: checkout });
  }

  if (OPENAPI_SPACES.has(space)) {
    const spec = path.join(checkout, 'openapi', 'lec', space, 'v1', 'openapi.yaml');
    if (!fs.existsSync(spec)) die(`契约缺失：openapi/lec/${space}/v1/openapi.yaml`);
    run(localBin('openapi-typescript'), [spec, '--output', path.join(target, 'openapi.ts')]);
  }

  if (!PROTO_SPACES.has(space) && !OPENAPI_SPACES.has(space)) die(`不支持的 IDL space：${space}`);
}

function generateAll(config, services, outputRoot, workRoot) {
  const checkouts = new Map();
  for (const [alias, service] of Object.entries(services)) {
    const key = `${service.requestedRef}\0${service.resolvedCommit}`;
    let checkout = checkouts.get(key);
    if (!checkout) {
      checkout = path.join(workRoot, `repo-${checkouts.size}`);
      cloneAt(config.repo, service.requestedRef, service.resolvedCommit, checkout);
      checkouts.set(key, checkout);
    }
    generateService(checkout, alias, service.space, outputRoot, workRoot);
  }
}

function snapshot(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
    }
  }
  visit(root);
  return result;
}

function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(cwd);
  applyOverride(config, args.service);
  const services = resolveServices(config);
  const lock = { repo: config.repo, services };
  const lockFile = path.join(cwd, LOCK_FILE);

  if (args.resolveOnly) {
    fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`idl: 已写入 ${LOCK_FILE}；--resolve-only 跳过生成`);
    return;
  }

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lec-idl-'));
  try {
    const generated = path.join(workRoot, 'generated');
    generateAll(config, services, generated, workRoot);
    const outDir = path.resolve(cwd, config.outDir);

    if (args.check) {
      if (!fs.existsSync(lockFile)) die(`--check：缺少 ${LOCK_FILE}`);
      const currentLock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (comparableLock(currentLock) !== comparableLock(lock)) die('--check：idl.lock.json 已过期');
      if (JSON.stringify(snapshot(outDir)) !== JSON.stringify(snapshot(generated))) die('--check：生成物已漂移，请运行 npm run idl');
      console.log('idl: --check 通过，lock 与生成物均可复现');
      return;
    }

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(generated, outDir, { recursive: true });
    fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`idl: 已生成 ${path.relative(cwd, outDir)} 并写入 ${LOCK_FILE}`);
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`idl: ${error.message}`);
  process.exit(1);
}
