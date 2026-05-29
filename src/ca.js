/**
 * CA and Fake Certificate management for MITM proxy
 * Pure JS, works on Termux (no native addons)
 */

const fs   = require('node:fs')
const path = require('node:path')
const forge = require('node-forge')
const { LRUCache } = require('lru-cache')
const pki = forge.pki
const log  = require('./log')

const CA_NAME       = 'dev-sidecar'
const MAX_CERT_CACHE = 256

// ── CA creation (one-time, self-signed) ──────────────────────────────────────
function createCA () {
  const keys = pki.rsa.generateKeyPair({ bits: 2048 })
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = Date.now().toString(16)
  cert.validity.notBefore = new Date(Date.now() - 60 * 1000)
  cert.validity.notAfter  = new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000)
  const attrs = [
    { name: 'commonName',       value: CA_NAME },
    { name: 'countryName',      value: 'CN' },
    { shortName: 'ST',          value: 'GuangDong' },
    { name: 'localityName',     value: 'ShenZhen' },
    { name: 'organizationName',  value: 'dev-sidecar' },
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

// ── Per-host fake certificate (signed by our CA) ─────────────────────────────
function createFakeCert (caKey, caCert, hostname) {
  const keys = pki.rsa.generateKeyPair({ bits: 2048 })
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
  const san   = parts.length >= 2 ? `*.${parts.slice(-2).join('.')}` : hostname
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: false },
    { name: 'subjectAltName',  altNames: [{ type: 2, value: hostname }, { type: 2, value: san }] },
    { name: 'subjectKeyIdentifier' },
    { name: 'extKeyUsage',     serverAuth: true, clientAuth: true },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { key: keys.privateKey, cert }
}

// ── PEM helpers ───────────────────────────────────────────────────────────────
function certToPem (cert) { return pki.certificateToPem(cert) }
function keyToPem  (key)  { return pki.privateKeyToPem(key) }

function loadPem (file) { return fs.readFileSync(file, 'utf8') }
function savePem (file, pem) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, pem) }

// ── Container (LRU cache + CA init) ────────────────────────────────────────
class CertContainer {
  constructor ({ caCertPath, caKeyPath, maxLength = MAX_CERT_CACHE } = {}) {
    this.caCertPath = caCertPath
    this.caKeyPath  = caKeyPath
    this.cache = new LRUCache({ maxSize: maxLength, sizeCalculation: () => 1 })
    this.caCert = null
    this.caKey  = null
  }

  /** Ensure CA cert/key exist on disk; load into memory. */
  initCA () {
    try {
      fs.accessSync(this.caCertPath, fs.constants.F_OK)
      fs.accessSync(this.caKeyPath,  fs.constants.F_OK)
      this.caCert = pki.certificateFromPem(loadPem(this.caCertPath))
      this.caKey  = pki.privateKeyFromPem(loadPem(this.caKeyPath))
      log.info(`CA cert loaded: ${this.caCertPath}`)
      return { created: false }
    } catch {
      log.info('CA cert not found, generating new CA...')
      const ca = createCA()
      this.caCert = ca.cert
      this.caKey  = ca.key
      savePem(this.caCertPath, certToPem(ca.cert))
      savePem(this.caKeyPath,  keyToPem(ca.key))
      log.info(`CA cert generated: ${this.caCertPath}`)
      return { created: true }
    }
  }

  /** Return a Promise that resolves to {key, cert} PEM strings for `hostname`. */
  async getCert (hostname) {
    const cached = this.cache.get(hostname)
    if (cached) return cached
    const p = Promise.resolve().then(() => createFakeCert(this.caKey, this.caCert, hostname))
    this.cache.set(hostname, p)
    log.debug(`Fake cert created for: ${hostname}`)
    return p
  }
}

module.exports = { CertContainer, certToPem, keyToPem }
