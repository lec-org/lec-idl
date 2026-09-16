'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const cli = path.join(__dirname, 'idl.js');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lec-idl-cli-test-'));
const remote = path.join(temp, 'remote.git');
const consumer = path.join(temp, 'consumer');

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: consumer, encoding: 'utf8' });
}

try {
  execFileSync('git', ['clone', '--quiet', '--bare', root, remote]);
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'idl.config.json'), JSON.stringify({
    repo: remote,
    outDir: './src/generated',
    services: { core: 'lec.core@main', doc: 'lec.doc@main' },
  }, null, 2));

  assert.match(run([]), /已生成/);
  const lock = JSON.parse(fs.readFileSync(path.join(consumer, 'idl.lock.json'), 'utf8'));
  assert.match(lock.services.core.resolvedCommit, /^[0-9a-f]{40}$/);
  assert(fs.existsSync(path.join(consumer, 'src/generated/core/proto/lec/core/v1/authorization_pb.ts')));
  assert(fs.existsSync(path.join(consumer, 'src/generated/core/openapi.ts')));
  assert(fs.existsSync(path.join(consumer, 'src/generated/doc/openapi.ts')));
  assert.match(run(['--check']), /均可复现/);

  const sha = lock.services.core.resolvedCommit;
  const configFile = path.join(consumer, 'idl.config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.services.core = `lec.core@${sha}`;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  assert.match(run([]), /已生成/);

  config.outDir = '..';
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const unsafe = spawnSync(process.execPath, [cli], { cwd: consumer, encoding: 'utf8' });
  assert.notStrictEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /outDir 必须是消费仓内的子目录/);
  config.outDir = './src/generated';
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

  fs.appendFileSync(path.join(consumer, 'src/generated/doc/openapi.ts'), '\n// drift\n');
  const drift = spawnSync(process.execPath, [cli, '--check'], { cwd: consumer, encoding: 'utf8' });
  assert.notStrictEqual(drift.status, 0);
  assert.match(drift.stderr, /生成物已漂移/);

  console.log('idl CLI end-to-end test: OK');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
