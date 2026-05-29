// Quick MITM test: start proxy, send HTTPS request through it
const { spawn } = require('node:child_process')
const https = require('node:https')
const http  = require('node:http')
const fs    = require('node:fs')
const path  = require('node:path')

const PROXY_PORT = 18899
const CA_CERT = path.join(process.env.USERPROFILE, '.dev-sidecar-android', 'certs', 'ca-cert.pem')

let proxyProc = null
let passed = 0, failed = 0

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

function httpGetViaProxy (targetUrl) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      hostname: '127.0.0.1',
      port: PROXY_PORT,
      path: targetUrl,
      headers: { Host: new URL(targetUrl).hostname },
      timeout: 8000,
    }, (res) => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

function httpsGetViaProxy (targetUrl) {
  const net = require('node:net')
  const tls = require('node:tls')
  // Use tunneling: send CONNECT, then do TLS to the proxy
  return new Promise((resolve, reject) => {
    const proxy = net.connect(PROXY_PORT, '127.0.0.1', () => {
      const connectReq = [
        `CONNECT ${new URL(targetUrl).hostname}:443 HTTP/1.1`,
        `Host: ${new URL(targetUrl).hostname}:443`,
        '', ''
      ].join('\r\n')
      proxy.write(connectReq)
    })
    let headerDone = false
    let buffer = ''
    // collect CONNECT response
    let connectBuf = ''
    proxy.on('data', (d) => {
      connectBuf += d.toString()
      if (!headerDone && connectBuf.includes('\r\n\r\n')) {
        headerDone = true
        const statusLine = connectBuf.split('\r\n')[0]
        if (!statusLine.includes('200')) {
          proxy.destroy()
          reject(new Error(`CONNECT failed: ${statusLine}`))
          return
        }
        // Now do TLS over this socket
        const tlsSocket = tls.connect({
          host: new URL(targetUrl).hostname,
          servername: new URL(targetUrl).hostname,
          socket: proxy,
          rejectUnauthorized: false,
        }, () => {
          const req = [
            `GET ${new URL(targetUrl).pathname || '/'} HTTP/1.1`,
            `Host: ${new URL(targetUrl).hostname}`,
            'Connection: close',
            '', ''
          ].join('\r\n')
          tlsSocket.write(req)
          let resp = ''
          tlsSocket.on('data', (dd) => { resp += dd.toString() })
          tlsSocket.on('end', () => {
            const status = parseInt((resp.split('\r\n')[0].match(/HTTP\/\d\.\d (\d+)/) || [])[1])
            resolve({ status, body: resp })
          })
        })
        tlsSocket.on('error', reject)
      }
    })
    proxy.on('error', reject)
  })
}

async function main () {
  console.log('Starting proxy...')
  proxyProc = spawn('node', ['src/proxy.js', '--port', String(PROXY_PORT)], {
    cwd: __dirname,
    env: { ...process.env, LOG_LEVEL: 'error' },
  })
  proxyProc.stderr.on('data', d => console.log('[proxy]', d.toString().trim()))

  await sleep(2000)

  // Test 1: HTTP via proxy
  console.log('\n[Test 1] HTTP proxy (httpbin.org/get)')
  try {
    const r = await httpGetViaProxy('http://httpbin.org/get')
    if (r.status === 200 && r.body.includes('httpbin')) {
      console.log('  PASS')
      passed++
    } else { console.log('  FAIL:', r.status, r.body.slice(0, 100)); failed++ }
  } catch (e) { console.log('  FAIL:', e.message); failed++ }

  // Test 2: HTTPS via MITM proxy
  console.log('\n[Test 2] HTTPS MITM (httpbin.org/get)')
  try {
    // We need the `net` and `tls` modules
    const net = require('node:net')
    const tls = require('node:tls')
    const r = await httpsGetViaProxy('https://httpbin.org/get')
    if (r.status === 200 && r.body.includes('httpbin')) {
      console.log('  PASS')
      passed++
    } else { console.log('  FAIL:', r.status, r.body.slice(0, 200)); failed++ }
  } catch (e) { console.log('  FAIL:', e.message); failed++ }

  // Test 3: Check CA cert was created
  console.log('\n[Test 3] CA cert exists')
  if (fs.existsSync(CA_CERT)) {
    console.log('  PASS')
    passed++
  } else { console.log('  FAIL: CA cert not found at', CA_CERT); failed++ }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)

  proxyProc.kill()
  process.exit(failed > 0 ? 1 : 0)
}

main()
