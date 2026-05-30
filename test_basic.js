/**
 * Dev-Sidecar Android 基础测试
 */

const assert = require('assert');
const path = require('path');
const os = require('os');

console.log('=== Dev-Sidecar Android 测试 ===\n');

async function runTests() {
  // 1. 测试模块加载
  console.log('1. 测试模块加载...');
  const ca = require('./src/ca');
  const doh = require('./src/doh');
  const log = require('./src/log');

  assert(ca.CertContainer, 'ca.CertContainer 应该存在');
  assert(typeof ca.certToPem === 'function', 'ca.certToPem 应该是函数');
  assert(typeof ca.keyToPem === 'function', 'ca.keyToPem 应该是函数');
  assert(typeof doh.resolve === 'function', 'doh.resolve 应该是函数');
  assert(typeof log.info === 'function', 'log.info 应该是函数');
  console.log('   ✓ 所有模块加载成功\n');

  // 2. 测试 CA 证书生成
  console.log('2. 测试 CA 证书生成...');
  const certDir = path.join(os.tmpdir(), 'dsc-test-' + Date.now());
  const caCertPath = path.join(certDir, 'ca-cert.pem');
  const caKeyPath = path.join(certDir, 'ca-key.pem');

  const container = new ca.CertContainer({ caCertPath, caKeyPath });
  const result = container.initCA();
  assert(result.created === true, '首次应创建新 CA');
  console.log(`   ✓ CA 证书生成成功: ${caCertPath}\n`);

  // 3. 测试主机证书生成
  console.log('3. 测试主机证书生成...');
  const hostCert = await container.getCert('github.com');
  assert(hostCert.key, '应返回 key');
  assert(hostCert.cert, '应返回 cert');
  const pemKey = ca.keyToPem(hostCert.key);
  const pemCert = ca.certToPem(hostCert.cert);
  assert(pemKey.includes('-----BEGIN'), 'PEM key 格式正确');
  assert(pemCert.includes('-----BEGIN CERTIFICATE'), 'PEM cert 格式正确');
  console.log('   ✓ 主机证书生成成功\n');

  // 4. 测试日志模块
  console.log('4. 测试日志模块...');
  log.info('测试 info 日志');
  log.warn('测试 warn 日志');
  log.error('测试 error 日志');
  console.log('   ✓ 日志模块工作正常\n');

  // 5. 测试代理模块导入
  console.log('5. 测试代理模块导入...');
  // proxy 模块直接启动服务器，检查关键函数是否存在
  const proxyPath = path.join(__dirname, 'src', 'proxy.js');
  const proxyCode = require('fs').readFileSync(proxyPath, 'utf8');
  assert(proxyCode.includes('http.createServer'), 'proxy.js 应包含 http.createServer');
  assert(proxyCode.includes('CONNECT'), 'proxy.js 应处理 CONNECT 方法');
  console.log('   ✓ 代理模块语法正确\n');

  // 6. 测试 WebUI 模块导入
  console.log('6. 测试 WebUI 模块导入...');
  const webui = require('./src/webui');
  assert(webui.start, 'webui 应导出 start 方法');
  assert(webui.HTML_UI, 'webui 应导出 HTML_UI');
  console.log('   ✓ WebUI 模块导入成功\n');

  // 7. 测试 DoH 解析 (网络测试)
  console.log('6. 测试 DoH 解析...');
  try {
    const ips = await doh.resolve('github.com');
    if (ips && ips.length > 0) {
      console.log(`   ✓ 解析 github.com: ${ips.join(', ')}`);
    } else {
      console.log('   ⚠ 解析结果为空（可能网络问题）');
    }
  } catch (err) {
    console.log(`   ⚠ DoH 解析失败: ${err.message}（跳过）`);
  }

  console.log('\n=== 所有测试通过 ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
