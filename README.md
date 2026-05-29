# Dev-Sidecar Android/Termux

[![npm version](https://badge.fury.io/js/dev-sidecar-android.svg)](https://www.npmjs.com/package/dev-sidecar-android)
[![GitHub Actions](https://github.com/yourname/dev-sidecar-android/actions/workflows/build-apk.yml/badge.svg)](https://github.com/yourname/dev-sidecar-android/actions)

轻量级 MITM 代理工具，专为 Android/Termux 设计，用于开发者绕过 SNI 检测、DNS 污染，加速 GitHub/npm/PyPI 等开发网站访问。

## ✨ 功能特性

- 🔓 **MITM 代理** — 动态生成证书，解密 HTTPS 流量，绕过 SNI 检测
- 🌐 **DNS-over-HTTPS** — 使用 Cloudflare/Google DoH，优选最快 IP
- 🔗 **上游代理支持** — 支持 HTTP/SOCKS5 上游，访问 IP 封锁网站
- 📱 **Android 兼容** — 可嵌入 Android App（nodejs-mobile-android）
- 📋 **规则引擎** — 通配符/正则匹配，只代理指定域名
- 🖥️ **Web 控制台** — 实时查看代理状态、流量统计、证书管理

## 📦 安装

### Termux (推荐)

```bash
npm install -g dev-sidecar-android
# 或本地安装
git clone https://github.com/yourname/dev-sidecar-android.git
cd dev-sidecar-android
npm install -g .
```

### macOS / Linux

```bash
npm install -g dev-sidecar-android
```

### Windows

```powershell
npm install -g dev-sidecar-android
# 需要 Python 3 + cryptography 库（MITM 模式）
pip install cryptography
```

## 🚀 快速开始

### 启动代理

```bash
# 默认：MITM 开启，端口 7890
dev-sidecar-android start

# 指定端口
dev-sidecar-android start --port 8888

# 禁用 MITM（仅 DNS 优选 + IP 直连）
dev-sidecar-android start --mitm-disable

# 使用上游代理（访问 IP 封锁网站）
dev-sidecar-android start --upstream socks5://127.0.0.1:1080
```

### 停止代理

```bash
dev-sidecar-android stop
```

### 查看状态

```bash
dev-sidecar-android status
```

### 安装 CA 证书（HTTPS 拦截必需）

```bash
# 查看 CA 证书路径
dev-sidecar-android ca-cert

# 首次启动代理会自动生成 CA 证书
dev-sidecar-android start
# CA 证书位置：~/.dev-sidecar-android/certs/ca-cert.pem
```

#### Android 安装 CA 证书

```bash
# 1. 复制证书到手机
scp ~/.dev-sidecar-android/certs/ca-cert.pem phone:/sdcard/Download/

# 2. 在手机上：设置 > 安全 > 从存储安装
# 3. 选择 "ca-cert.pem"，凭据用途选 "CA 证书"
```

#### Windows 安装 CA 证书

```powershell
# 双击 ca-cert.pem → 安装证书 → 选择 "受信任的根证书颁发机构"
```

## 📖 使用场景

### 场景 1：加速 GitHub 访问（DNS 污染型）

```bash
dev-sidecar-android start --mitm-disable
# 设置代理
export https_proxy=http://127.0.0.1:7890
curl https://api.github.com
```

### 场景 2：绕过 SNI 检测（GitHub API/raw 文件）

```bash
dev-sidecar-android start
# 安装 CA 证书后
export https_proxy=http://127.0.0.1:7890
curl -k https://api.github.com
```

### 场景 3：访问 IP 封锁网站（需要上游代理）

```bash
# 上游代理可以是 v2ray/xray/ss 等
dev-sidecar-android start --upstream socks5://127.0.0.1:1080
```

## ⚙️ Web 控制台

启动后访问：`http://127.0.0.1:7891`

功能：
- 实时流量监控
- 规则管理（添加/删除/启用/禁用）
- CA 证书下载
- MITM 开关
- 上游代理配置

## 🏗️ 架构

```
┌─────────────────┐
│   浏览器/应用    │
│  (设置代理      │
│   127.0.0.1:7890)│
└────────┬────────┘
         │
┌────────▼────────┐
│  Node.js 代理   │
│  (proxy.js)     │
│  - MITM 拦截    │
│  - DNS 优选     │
│  - 规则匹配     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌─▼────┐
│ 直连   │ │上游代理│
│ (IP优选)│ │(SOCKS5)│
└────────┘ └────────┘
```

## 📱 Android App 构建

### 使用 GitHub Actions（推荐）

1. Fork 本仓库
2. 进入 **Actions** 标签页
3. 选择 **Build Android APK**
4. 点击 **Run workflow**
5. 构建完成后下载 APK

### 本地构建

```bash
cd android
# 需要 Android SDK + JDK 17
./gradlew assembleDebug
# APK 输出：app/build/outputs/apk/debug/app-debug.apk
```

## 🔧 开发

```bash
git clone https://github.com/yourname/dev-sidecar-android.git
cd dev-sidecar-android
npm install
node src/proxy.js --port 7890
```

### 运行测试

```bash
npm test
# 或
node test_mitm.js
```

## 📝 配置

配置文件：`~/.dev-sidecar-android/config.json`

```json
{
  "proxy_port": 7890,
  "web_port": 7891,
  "mitm_enabled": true,
  "upstream_proxy": "",
  "dns_servers": [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/resolve"
  ],
  "rules": [
    { "pattern": "*.github.com", "enabled": true },
    { "pattern": "*.githubusercontent.com", "enabled": true },
    { "pattern": "*.pypi.org", "enabled": true }
  ]
}
```

## ⚠️ 限制

- **MITM 模式** 需要安装 CA 证书，且客户端必须信任该证书
- **IP 封锁型网站**（如 pixiv.net）必须配合上游代理使用
- **SNI 伪装** 方案已放弃（需 MITM + 复杂配置）
- **DNS 优选** 返回的 IP 与证书不匹配，需禁用 SSL 验证（`curl -k` 或设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`）

## 📄 许可证

MPL-2.0

## 🙏 致谢

- 原版 dev-sidecar 项目（https://github.com/docmirror/dev-sidecar）
- node-forge（证书生成）
- Cloudflare / Google（DoH 服务）

---

**⚡ 性能对比**（中国大陆网络环境）

| 网站 | 直连 | + Dev-Sidecar | 提升 |
|------|-------|---------------|------|
| GitHub API | 超時 | 200ms | ✅ |
| npm install | 200KB/s | 2MB/s | 10x |
| PyPI | 50KB/s | 500KB/s | 10x |
