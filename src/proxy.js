/**
 * dev-sidecar-android – MITM Proxy Core (corrected)
 * Architecture: proxy does TCP tunnel; fake HTTPS server handles TLS termination
 */

const http  = require('node:http')
const https = require('node:https')
const net   = require('node:net')
const fs    = require('node:fs')
const path  = require('node:path')
const url   = require('node:url')
const forge = require('node-forge')
const { LRUCache } = require('lru-cache')

// ─── Config ───────────────────────────────────────────────────────────────────
const CERT_DIR   = path.join(process.env.HOME || process.env.USERPROFILE || '', '.dev-sidecar-android', 'certs')
const CA_CERT_FILE = path.join(CERT_DIR, 'ca-cert.pem')
const CA_KEY_FILE  = path.join(CERT_DIR, 'ca-key.pem')

// ─── Logger ──────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const CUR_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1
const pad = n => n < 10 ? '0' + n : '' + n
const ts = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const fmt = a => a.map(x => x instanceof Error ? (x.stack || x.message) : (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(' ')

const log = {
  debug: (...a) => { if (CUR_LEVEL <= 0) console.log(`[DEBUG] ${ts()}`, fmt(a)) },
  info:  (...a) => { if (CUR_LEVEL <= 1) console.log(`[INFO]  ${ts()}`, fmt(a)) },
  warn:  (...a) => { if (CUR_LEVEL <= 2) console.warn(`[WARN]  ${ts()}`, fmt(a)) },
  error: (...a) => { if (CUR_LEVEL <= 3) console.error(`[ERROR] ${ts()}`, fmt(a)) },
}

// ─── CA & Certificate Management ───────────────────────────────────────────
const pki = forge.pki

function generateRSAKeyPair () { return pki.rsa.generateKeyPair({ bits: 2048 }) }

function createCA () {
  const keys = generateRSAKeyPair()
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = Date.now().toString(16)
  cert.validity.notBefore = new Date(Date.now() - 60 * 1000)
  cert.validity.notAfter  = new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000)
  const attrs = [
    { name: 'commonName',      value: 'dev-sidecar' },
    { name: 'countryName',     value: 'CN' },
    { shortName: 'ST',        value: 'GuangDong' },
    { name: 'localityName',    value: 'ShenZhen' },
    { name: 'organizationName', value: 'dev-sidecar' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: true },
    { name: 'keyUsage',        critical: true, keyCertSign: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: keys.privateKey, cert }
}

function createFakeCert (caKey, caCert, hostname) {
  const keys = generateRSAKeyPair()
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = Date.now().toString(16)
  cert.validity.notBefore = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  cert.validity.notAfter  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  const attrs = [
    { name: 'commonName',      value: hostname },
    { name: 'countryName',     value: 'CN' },
    { shortName: 'ST',         value: 'GuangDong' },
    { name: 'localityName',    value: 'ShenZhen' },
    { name: 'organizationName', value: 'dev-sidecar' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(caCert.subject.attributes)
  const parts = hostname.split('.')
  const san = parts.length >= 2 ? `*.${parts.slice(-2).join('.')}` : hostname
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: false },
    { name: 'subjectAltName',  altNames: [{ type: 2, value: hostname }, { type: 2, value: san }] },
    { name: 'subjectKeyIdentifier' },
    { name: 'extKeyUsage',     serverAuth: true, clientAuth: true },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { key: keys.privateKey, cert }
}

function certToPem (cert) { return pki.certificateToPem(cert) }
function keyToPem  (key)  { return pki.privateKeyToPem(key) }

function initCA (caCertPath, caKeyPath) {
  try {
    fs.accessSync(caCertPath, fs.constants.F_OK)
    fs.accessSync(caKeyPath,  fs.constants.F_OK)
    const caCert = pki.certificateFromPem(fs.readFileSync(caCertPath, 'utf8'))
    const caKey  = pki.privateKeyFromPem(fs.readFileSync(caKeyPath,  'utf8'))
    log.info(`CA cert loaded: ${caCertPath}`)
    return { caCert, caKey, created: false }
  } catch (e) {
    log.info('CA cert not found, generating new one...')
    fs.mkdirSync(path.dirname(caCertPath), { recursive: true })
    const ca = createCA()
    fs.writeFileSync(caCertPath, certToPem(ca.cert))
    fs.writeFileSync(caKeyPath,  keyToPem(ca.key))
    log.info(`CA cert generated: ${caCertPath}`)
    return { caCert: ca.cert, caKey: ca.key, created: true }
  }
}

// ─── Fake Server Center (LRU cache of fake HTTPS servers) ─────────────────
class FakeServerCenter {
  constructor ({ caCert, caKey, maxLength = 256 } = {}) {
    this.caCert = caCert
    this.caKey  = caKey
    this.cache = new LRUCache({ maxSize: maxLength, sizeCalculation: () => 1 })
  }

  /** Get or create a fake HTTPS server for `hostname`. Returns { port, promise }. */
  async getServer (hostname) {
    const cached = this.cache.get(hostname)
    if (cached) return cached

    const { key, cert } = createFakeCert(this.caKey, this.caCert, hostname)
    const keyPem  = keyToPem(key)
    const certPem = certToPem(cert)

    const server = https.createServer({ key: keyPem, cert: certPem })

    // Handle decrypted HTTPS requests from the client
    server.on('request', (req, res) => {
      this._handleFakeRequest(req, res, hostname)
    })

    // For CONNECT tunnels established to this fake server (shouldn't happen normally)
    server.on('connect', (req, cltSocket, head) => {
      cltSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    })

    const p = new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        log.info(`Fake server for ${hostname} listening on 127.0.0.1:${port}`)
        const result = { port, server }
        this.cache.set(hostname, result)
        resolve(result)
      })
      server.on('error', reject)
    })

    this.cache.set(hostname, p) // store promise, will be replaced by result
    return p
  }

  async _handleFakeRequest (req, res, targetHost) {
    // The client sent a request to our fake server (thinking it's targetHost)
    // We forward it to the real server
    const options = {
      hostname: targetHost,
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: targetHost },
    }
    // Remove hop-by-hop headers
    delete options.headers['proxy-connection']
    delete options.headers['proxy-authenticate']
    delete options.headers['proxy-authorization']
    options.headers['connection'] = 'close'

    try {
      const proxy = https.request(options, (pRes) => {
        res.writeHead(pRes.statusCode, pRes.headers)
        pRes.pipe(res)
      })
      proxy.on('error', (e) => {
        log.error(`Fake server upstream error for ${targetHost}:`, e)
        if (!res.headersSent) res.writeHead(502)
        res.end('Bad Gateway')
      })
      req.pipe(proxy)
    } catch (e) {
      log.error('Fake request handler error:', e)
      if (!res.headersSent) res.writeHead(500)
      res.end('Internal Error')
    }
  }
}

// ─── DNS-over-HTTPS ────────────────────────────────────────────────────────
const DOH_SERVERS = [
  { url: 'https://dns.alidns.com/dns-query', name: 'AliDNS' },
  { url: 'https://doh.pub/dns-query',           name: 'DNSPod' },
  { url: 'https://doh.360.cn/dns-query',        name: '360DNS' },
  { url: 'https://cloudflare-dns.com/dns-query', name: 'Cloudflare' },
  { url: 'https://dns.google/dns-query',         name: 'Google' },
]

function buildDnsQuery (domain) {
  const id = Math.random() * 65535 | 0
  const buf = Buffer.alloc(512)
  let off = 0
  buf.writeUInt16BE(id, off); off += 2
  buf.writeUInt16BE(0x0100, off); off += 2
  buf.writeUInt16BE(1, off); off += 2
  buf.writeUInt16BE(0, off); off += 2
  buf.writeUInt16BE(0, off); off += 2
  buf.writeUInt16BE(0, off); off += 2
  for (const part of domain.split('.')) {
    buf[off++] = part.length
    Buffer.from(part).copy(buf, off)
    off += part.length
  }
  buf[off++] = 0
  buf.writeUInt16BE(1, off); off += 2
  buf.writeUInt16BE(1, off); off += 2
  return { id, buffer: buf.slice(0, off) }
}

function parseDnsResponse (buffer) {
  if (buffer.length < 12) return []
  const ancount = buffer.readUInt16BE(6)
  if (ancount === 0) return []
  let off = 12
  while (off < buffer.length && buffer[off] !== 0) {
    if ((buffer[off] & 0xC0) === 0xC0) { off += 2; break }
    off += buffer[off] + 1
  }
  if (off < buffer.length && buffer[off] === 0) off++
  off += 4
  const ips = []
  for (let i = 0; i < ancount && off < buffer.length; i++) {
    if ((buffer[off] & 0xC0) === 0xC0) { off += 2 } else {
      while (off < buffer.length && buffer[off] !== 0) {
        if ((buffer[off] & 0xC0) === 0xC0) { off += 2; break }
        off += buffer[off] + 1
      }
      if (off < buffer.length && buffer[off] === 0) off++
    }
    if (off + 10 > buffer.length) break
    const rtype = buffer.readUInt16BE(off); off += 2
    off += 2
    off += 4
    const rdlength = buffer.readUInt16BE(off); off += 2
    if (rtype === 1 && off + 4 <= buffer.length) {
      ips.push(buffer[off] + '.' + buffer[off+1] + '.' + buffer[off+2] + '.' + buffer[off+3])
    }
    off += rdlength
  }
  return ips
}

async function dohQuery (server, domain, timeout = 3000) {
  const { buffer } = buildDnsQuery(domain)
  const urlObj = new url.URL(server.url)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/dns-message',
        'Accept': 'application/dns-message',
        'Content-Length': buffer.length,
      },
      timeout,
    }, (res) => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        try {
          const ips = parseDnsResponse(Buffer.concat(chunks))
          if (ips.length > 0) resolve(ips)
          else reject(new Error(`No A records for ${domain} from ${server.name}`))
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${server.name}`)) })
    req.write(buffer)
    req.end()
  })
}

async function resolveDoH (domain) {
  for (const server of DOH_SERVERS) {
    try {
      const ips = await dohQuery(server, domain)
      log.info(`DoH ${server.name} resolved ${domain}: ${ips.join(', ')}`)
      return ips
    } catch (e) {
      log.debug(`DoH ${server.name} failed for ${domain}: ${e.message}`)
    }
  }
  log.warn(`All DoH servers failed for ${domain}, using system DNS`)
  return new Promise((resolve, reject) => {
    require('node:dns').lookup(domain, { family: 4 }, (err, address) => {
      if (err) reject(err)
      else resolve([address])
    })
  })
}

// ─── Global state ───────────────────────────────────────────────────────────
let gCaCert = null
let gCaKey  = null
let gMitmEnabled = true
let gUpstreamProxy = null
const gRules = []

function shouldMitm (hostname) {
  if (!gMitmEnabled) return false
  if (gRules.length === 0) return true
  return gRules.some(r => {
    if (r.startsWith('*.')) return hostname.endsWith(r.slice(2))
    return hostname === r
  })
}

// ─── CONNECT handler ────────────────────────────────────────────────────────
async function handleConnect (req, cltSocket, head) {
  const { hostname, port } = new url.URL(`https://${req.url}`)
  const portNum = parseInt(port) || 443
  log.info(`CONNECT ${hostname}:${portNum}`)

  if (shouldMitm(hostname)) {
    // ── MITM: create fake server, tunnel client ↔ fake server ──
    try {
      if (!global.fakeServerCenter) {
        global.fakeServerCenter = new FakeServerCenter({ caCert: gCaCert, caKey: gCaKey })
      }
      const { port: fakePort } = await global.fakeServerCenter.getServer(hostname)

      // Send 200 to client
      cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                      'Proxy-agent: dev-sidecar-android\r\n\r\n')
      if (head && head.length > 0) cltSocket.write(head)

      // Connect to fake server and pipe
      const fakeSocket = net.connect(fakePort, '127.0.0.1', () => {
        log.debug(`TCP tunnel established: client ↔ fake:${fakePort} for ${hostname}`)
      })
      fakeSocket.on('error', (e) => {
        log.error(`Fake socket error for ${hostname}:`, e)
        cltSocket.destroy()
      })
      cltSocket.on('error', () => fakeSocket.destroy())
      cltSocket.pipe(fakeSocket)
      fakeSocket.pipe(cltSocket)
    } catch (e) {
      log.error(`MITM error for ${hostname}:`, e)
      try { cltSocket.write('HTTP/1.1 500 MITM Error\r\n\r\n') } catch {}
      cltSocket.end()
    }
  } else {
    // ── Tunnel mode ──
    let remoteSocket
    try {
      if (gUpstreamProxy) {
        remoteSocket = await connectUpstream(gUpstreamProxy.type, hostname, portNum)
      } else {
        remoteSocket = net.connect(portNum, hostname, () => {})
        await new Promise((resolve, reject) => {
          remoteSocket.once('connect', resolve)
          remoteSocket.once('error', reject)
          setTimeout(() => { remoteSocket.destroy(); reject(new Error('connect timeout')) }, 10000)
        })
      }
      cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                      'Proxy-agent: dev-sidecar-android\r\n\r\n')
      if (head && head.length > 0) remoteSocket.write(head)
      cltSocket.pipe(remoteSocket)
      remoteSocket.pipe(cltSocket)
      cltSocket.on('error', () => remoteSocket.destroy())
      remoteSocket.on('error', () => cltSocket.destroy())
    } catch (e) {
      log.error(`Tunnel error for ${hostname}:${portNum}:`, e)
      try { cltSocket.write('HTTP/1.1 502 Tunnel Failed\r\n\r\n') } catch {}
      cltSocket.end()
    }
  }
}

async function connectUpstream (type, host, port) {
  return new Promise((resolve, reject) => {
    if (type === 'http') {
      const req = http.request({
        method: 'CONNECT', hostname: gUpstreamProxy.host, port: gUpstreamProxy.port,
        path: `${host}:${port}`,
      })
      req.on('connect', (res, socket) => {
        if (res.statusCode === 200) resolve(socket)
        else { socket.destroy(); reject(new Error(`Upstream HTTP ${res.statusCode}`)) }
      })
      req.on('error', reject)
      req.end()
    } else if (type === 'socks5') {
      const socket = net.connect(gUpstreamProxy.port, gUpstreamProxy.host)
      socket.on('connect', () => {
        socket.write(Buffer.from([0x05, 0x01, 0x00]))
        socket.once('data', (d) => {
          if (d[1] !== 0x00) { socket.destroy(); reject(new Error('SOCKS5 auth failed')); return }
          const addr = Buffer.from(host)
          const buf = Buffer.alloc(7 + addr.length)
          buf[0] = 0x05; buf[1] = 0x01; buf[2] = 0x00
          buf[3] = 0x03; buf[4] = addr.length
          addr.copy(buf, 5)
          buf.writeUInt16BE(port, 5 + addr.length)
          socket.write(buf)
          socket.once('data', (d2) => {
            if (d2[1] === 0x00) resolve(socket)
            else { socket.destroy(); reject(new Error(`SOCKS5 connect failed: ${d2[1]}`)) }
          })
        })
      })
      socket.on('error', reject)
    }
  })
}

// ─── HTTP request handler ───────────────────────────────────────────────────
function handleHttpRequest (req, res) {
  const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`
  const { hostname, port, pathname, search } = new url.URL(targetUrl)
  const portNum = parseInt(port) || 80
  log.info(`HTTP ${req.method} ${hostname}${pathname}`)

  const options = {
    hostname, port: portNum,
    path: pathname + (search || ''),
    method: req.method,
    headers: { ...req.headers },
  }
  delete options.headers['proxy-connection']
  options.headers['connection'] = 'close'

  const proxy = http.request(options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers)
    pRes.pipe(res)
  })
  proxy.on('error', (e) => {
    log.error(`HTTP proxy error for ${hostname}:`, e)
    if (!res.headersSent) res.writeHead(502)
    res.end('Bad Gateway')
  })
  req.pipe(proxy)
}

// ─── CLI ────────────────────────────────────────────────────────────────────
const { program } = require('commander')

function main () {
  program
    .option('--port <n>',  'Proxy listen port', '7890')
    .option('--host <addr>', 'Bind address', '0.0.0.0')
    .option('--mitm-disable', 'Disable MITM')
    .option('--upstream <url>', 'Upstream proxy (http://host:port or socks5://host:port)')
    .option('--rules <domains>', 'Comma-separated domains for MITM')
    .option('--cert-dir <path>', 'CA cert directory', CERT_DIR)
    .parse()

  const opts = program.opts()
  gMitmEnabled = !opts.mitmDisable
  if (opts.rules) gRules.push(...opts.rules.split(',').map(s => s.trim()).filter(Boolean))
  if (opts.upstream) {
    const u = new url.URL(opts.upstream)
    gUpstreamProxy = { type: u.protocol.replace(':', ''), host: u.hostname, port: parseInt(u.port) }
  }

  const certDir  = opts.certDir
  const caCertPath = path.join(certDir, 'ca-cert.pem')
  const caKeyPath  = path.join(certDir, 'ca-key.pem')

  const { caCert, caKey, created } = initCA(caCertPath, caKeyPath)
  gCaCert = caCert
  gCaKey  = caKey

  if (created) {
    console.log('')
    console.log('=================================================================')
    console.log('  NEW CA CERTIFICATE GENERATED!')
    console.log(`  Install this CA cert on your device: ${caCertPath}`)
    console.log('  Otherwise HTTPS sites will show certificate warnings.')
    console.log('=================================================================')
    console.log('')
  }

  const proxyPort = parseInt(opts.port)
  const host = opts.host

  const server = http.createServer()
  server.on('request', handleHttpRequest)
  server.on('connect', handleConnect)
  server.on('error', (e) => log.error('Proxy server error:', e))

  server.listen(proxyPort, host, () => {
    log.info('dev-sidecar-android started!')
    log.info(`  Proxy  : ${host}:${proxyPort}`)
    log.info(`  MITM   : ${gMitmEnabled ? 'ENABLED' : 'disabled'}`)
    log.info(`  CA cert: ${caCertPath}`)
    if (gUpstreamProxy) log.info(`  Upstream: ${gUpstreamProxy.type}://${gUpstreamProxy.host}:${gUpstreamProxy.port}`)
    log.info('')
    log.info('Configure your browser/device proxy to:')
    log.info(`  HTTP  : ${host === '0.0.0.0' ? '127.0.0.1' : host}:${proxyPort}`)
    log.info('')
  })

  process.on('SIGINT', () => {
    log.info('\nShutting down...')
    server.close()
    process.exit(0)
  })
}

main()
