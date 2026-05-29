#!/usr/bin/env node
/**
 * dev-sidecar-android CLI
 * Usage:
 *   dev-sidecar-android start [--port 7890] [--mitm-disable] [--upstream <url>]
 *   dev-sidecar-android stop
 *   dev-sidecar-android status
 *   dev-sidecar-android ca-cert
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PKG_ROOT = path.resolve(__dirname, '..');
const PROXY_JS = path.join(PKG_ROOT, 'src', 'proxy.js');
const PID_FILE = path.join(require('os').tmpdir(), 'dev-sidecar_android.pid');

let proxyProcess = null;

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { command: 'start', port: 7890, mitmDisable: false, upstream: null };
  for (let i = 0; i < args.length; i++) {
    if (['start','stop','status','ca-cert'].includes(args[i])) {
      opts.command = args[i];
    } else if (args[i] === '--port' && args[i+1]) {
      opts.port = parseInt(args[i+1]); i++;
    } else if (args[i] === '--mitm-disable') {
      opts.mitmDisable = true;
    } else if (args[i] === '--upstream' && args[i+1]) {
      opts.upstream = args[i+1]; i++;
    }
  }
  return opts;
}

function startProxy(opts) {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
    try { process.kill(pid, 0); console.log('Proxy already running (PID ' + pid + ')'); return; } catch(e) {}
    fs.unlinkSync(PID_FILE);
  }

  const nodeArgs = [PROXY_JS, '--port', String(opts.port)];
  if (opts.mitmDisable) nodeArgs.push('--mitm-disable');
  if (opts.upstream) { nodeArgs.push('--upstream'); nodeArgs.push(opts.upstream); }

  console.log('Starting dev-sidecar-android on port ' + opts.port + '...');
  const child = spawn('node', nodeArgs, {
    cwd: PKG_ROOT,
    stdio: 'pipe',
    detached: false,
  });

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log('Started (PID ' + child.pid + ')');
  console.log('Proxy: 127.0.0.1:' + opts.port);
  console.log('Web UI: http://127.0.0.1:' + (opts.port + 1));
  console.log('CA cert: ~/.dev-side-car-android/certs/ca-cert.pem');
  console.log('');
  console.log('Press Ctrl+C to stop');

  child.stdout.on('data', function(d) { process.stdout.write(d); });
  child.stderr.on('data', function(d) { process.stderr.write(d); });

  process.on('SIGINT', function() { child.kill(); process.exit(0); });
  process.on('SIGTERM', function() { child.kill(); process.exit(0); });
}

function stopProxy() {
  if (!fs.existsSync(PID_FILE)) { console.log('Proxy not running'); return; }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid, 'SIGTERM');
    console.log('Stopped (PID ' + pid + ')');
  } catch(e) {
    console.log('Process ' + pid + ' not running, cleaning up');
  }
  try { fs.unlinkSync(PID_FILE); } catch(e) {}
}

function showStatus() {
  if (!fs.existsSync(PID_FILE)) { console.log('Status: STOPPED'); return; }
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid, 0);
    console.log('Status: RUNNING (PID ' + pid + ')');
    console.log('Proxy: 127.0.0.1:7890');
    console.log('Web UI: http://127.0.0.1:7891');
  } catch(e) {
    console.log('Status: STOPPED (stale PID file)');
    try { fs.unlinkSync(PID_FILE); } catch(e) {}
  }
}

function showCaCert() {
  const certPath = require('path').join(require('os').homedir(), '.dev-sidecar-android', 'certs', 'ca-cert.pem');
  if (!fs.existsSync(certPath)) {
    console.log('CA cert not found. Start proxy once to generate it.');
    return;
  }
  console.log('CA cert path: ' + certPath);
  console.log('');
  console.log('To install on Android:');
  console.log('  1. Copy cert to device: scp ca-cert.pem phone:/sdcard/');
  console.log('  2. Settings > Security > Install from storage');
  console.log('  3. Select "ca-cert.pem" as CA certificate');
}

const opts = parseArgs(process.argv);
switch (opts.command) {
  case 'start': startProxy(opts); break;
  case 'stop': stopProxy(); break;
  case 'status': showStatus(); break;
  case 'ca-cert': showCaCert(); break;
  default: console.log('Usage: dev-sidecar-android [start|stop|status|ca-cert]');
}
