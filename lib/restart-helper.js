'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const [nodeExe, serverPath, ...args] = process.argv.slice(2);
const logFile = process.env.BATCAVE_UPDATE_LOG || '';

function log(message) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + message + '\n');
  } catch {}
}

log('helper start node=' + (nodeExe || '-') + ' server=' + (serverPath || '-') + ' args=' + args.length);

if (!nodeExe || !serverPath) {
  log('restart helper missing node/server path');
  process.exit(2);
}

setTimeout(() => {
  try {
    const child = spawn(nodeExe, [serverPath, ...args], {
      cwd: path.dirname(serverPath),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: process.env
    });
    child.on('error', e => log('spawn error: ' + e.message));
    log('spawned server pid=' + child.pid);
    child.unref();
  } catch (e) {
    log('spawn failed: ' + e.message);
  }
  process.exit(0);
}, 2500);
