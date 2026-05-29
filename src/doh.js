/**
 * DNS-over-HTTPS resolver
 * Sends standard DNS wire format queries via HTTPS POST/GET
 * Works on any network (bypasses UDP DNS pollution)
 */

const https = require('node:https')
const dgram = require('node:dgram')
const log = require('./log')

// Domestic DoH servers (add more as needed)
const DOH_SERVERS = [
  { url: 'https://dns.alidns.com/dns-query', name: 'AliDNS' },
  { url: 'https://doh.pub/dns-query',           name: 'DNSPod' },
  { url: 'https://doh.360.cn/dns-query',        name: '360DNS' },
  { url: 'https://cloudflare-dns.com/dns-query', name: 'Cloudflare' },
  { url: 'https://dns.google/dns-query',         name: 'Google' },
]

function buildDnsQuery (domain) {
  // Build a minimal DNS query (QTYPE=A, QCLASS=IN)
  const id = Math.random() * 65535 | 0
  const flags = 0x0100 // standard query
  const qdcount = 1
  const ancount = 0, nscount = 0, arcount = 0

  const buf = Buffer.alloc(512)
  let off = 0
  buf.writeUInt16BE(id, off); off += 2
  buf.writeUInt16BE(flags, off); off += 2
  buf.writeUInt16BE(qdcount, off); off += 2
  buf.writeUInt16BE(ancount, off); off += 2
  buf.writeUInt16BE(nscount, off); off += 2
  buf.writeUInt16BE(arcount, off); off += 2

  // QNAME: labels
  for (const part of domain.split('.')) {
    buf[off++] = part.length
    Buffer.from(part).copy(buf, off)
    off += part.length
  }
  buf[off++] = 0 // null terminator
  // QTYPE=A (1), QCLASS=IN (1)
  buf.writeUInt16BE(1, off); off += 2
  buf.writeUInt16BE(1, off); off += 2

  return { id, buffer: buf.slice(0, off) }
}

function parseDnsResponse (buffer) {
  // Skip header (12 bytes) + question section, parse answer section
  if (buffer.length < 12) return []
  const ancount = buffer.readUInt16BE(6)
  if (ancount === 0) return []

  // Skip question section
  let off = 12
  // Skip QNAME
  while (off < buffer.length && buffer[off] !== 0) {
    const len = buffer[off]
    if (len > 63) { off++; break } // compression pointer
    off += len + 1
  }
  if (off < buffer.length && buffer[off] === 0) off++ // skip null
  off += 4 // skip QTYPE + QCLASS

  const ips = []
  for (let i = 0; i < ancount && off < buffer.length; i++) {
    // Handle compression pointers (0xC0 = 192)
    if ((buffer[off] & 0xC0) === 0xC0) {
      off += 2
    } else {
      while (off < buffer.length && buffer[off] !== 0) {
        const len = buffer[off]
        if (len > 63) { off += 2; break }
        off += len + 1
      }
      if (off < buffer.length && buffer[off] === 0) off++
    }
    if (off + 10 > buffer.length) break
    const rtype = buffer.readUInt16BE(off); off += 2
    off += 2 // class
    off += 4 // TTL
    const rdlength = buffer.readUInt16BE(off); off += 2
    if (rtype === 1) { // A record
      if (off + 4 <= buffer.length) {
        ips.push(`${buffer[off]}.${buffer[off+1]}.${buffer[off+2]}.${buffer[off+3]}`)
      }
    }
    off += rdlength
  }
  return ips
}

function dohQuery (server, domain, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const { buffer } = buildDnsQuery(domain)
    const url = new URL(server.url)
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
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
          const resp = Buffer.concat(chunks)
          const ips = parseDnsResponse(resp)
          if (ips.length > 0) resolve(ips)
          else reject(new Error(`No A records for ${domain} from ${server.name}`))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${server.name}`)) })
    req.write(buffer)
    req.end()
  })
}

async function resolve (domain, servers = DOH_SERVERS) {
  // Try DoH servers in order, return first successful result
  for (const server of servers) {
    try {
      const ips = await dohQuery(server, domain)
      log.info(`DoH ${server.name} resolved ${domain}: ${ips.join(', ')}`)
      return ips
    } catch (e) {
      log.debug(`DoH ${server.name} failed for ${domain}: ${e.message}`)
    }
  }
  // Fallback: system DNS via dgram (UDP)
  log.warn(`All DoH servers failed for ${domain}, falling back to system DNS`)
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const { buffer, id } = buildDnsQuery(domain)
    const timer = setTimeout(() => { socket.close(); reject(new Error('System DNS timeout')) }, 3000)
    socket.on('message', (msg) => {
      clearTimeout(timer)
      const ips = parseDnsResponse(msg)
      socket.close()
      if (ips.length > 0) resolve(ips)
      else reject(new Error('No A records from system DNS'))
    })
    socket.on('error', (e) => { clearTimeout(timer); socket.close(); reject(e) })
    socket.send(buffer, 53, '8.8.8.8') // will be replaced by actual system DNS
    // Actually use getaddrinfo fallback:
    const { promisify } = require('node:util')
    const { lookup } = require('node:dns')
    clearTimeout(timer)
    socket.close()
    lookup(domain).then(r => resolve([r.address])).catch(reject)
  })
}

module.exports = { resolve, DOH_SERVERS }
