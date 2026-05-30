# Dev-Sidecar Android

Lightweight developer proxy tool for Android — MITM + DNS-over-HTTPS + upstream proxy support.

## Components

### 1. Node.js CLI (`dsc`)
The core proxy engine. Runs in Termux or any Node.js environment.

```bash
# Install
npm install -g dev-sidecar-android

# Run
dsc --port 7890 --web-port 8080 --mitm

# With upstream proxy (for IP-blocked sites)
dsc --port 7890 --upstream socks5://127.0.0.1:1080
```

### 2. Android App (WebView Shell)
A lightweight Android app that connects to the proxy's web UI. The proxy itself runs separately in Termux.

**Features:**
- WebView shell for proxy web control panel
- Auto-connects to `http://127.0.0.1:8080`
- Shows error page with retry if proxy is not running

**Build:**
```bash
cd android
gradle wrapper --gradle-version 8.2
./gradlew assembleDebug
```

## How It Works

1. **DNS Optimization**: Resolves domains via DNS-over-HTTPS, bypassing DNS pollution
2. **MITM Mode**: Dynamically generates CA-signed certificates for HTTPS interception (bypasses SNI filtering)
3. **Upstream Proxy**: Routes blocked sites through SOCKS5/HTTP upstream proxy

## CA Certificate

On first run with MITM enabled, a CA certificate is generated at `~/.dev-sidecar-android/certs/ca-cert.pem`.

**Install the CA cert as trusted** on your device to avoid SSL warnings.

## Architecture

```
Client → dev-sidecar proxy (port 7890)
         ├─ DNS-polluted sites → DoH resolve → direct IP connect (MITM if needed)
         └─ IP-blocked sites → upstream proxy (SOCKS5/HTTP)
```
