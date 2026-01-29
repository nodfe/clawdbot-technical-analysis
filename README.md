# Clawdbot Technical Analysis Docs / Clawdbot 技术解析文档

This is the source code for the "Clawdbot Technical Deep Dive" documentation site, built with [VitePress](https://vitepress.dev/).

这是一个基于 VitePress 构建的 Clawdbot 深度技术指南站点源码。

## 🌟 Features / 特性

- **Multi-language Support / 双语支持**: Complete support for Simplified Chinese (zh-CN) and English (en).
- **Auto-Redirection / 自动路由**: Automatically redirects users based on their browser language preference.
- **SEO Optimized / SEO 友好**: Pre-configured Sitemap, Open Graph, and Twitter Card meta tags.
- **High Performance / 高性能**: Static site generation with localized assets for blazing fast loading.
- **Custom Theme / 美观设计**: Customized brand colors and homepage animations.

## 🚀 Quick Start / 快速开始

### Prerequisites / 前置要求

- Node.js version 18+

### Installation / 安装依赖

```bash
npm install
```

### Local Development / 本地开发

Start the local development server with hot reload:
启动本地开发服务器，支持热更新：

```bash
npm run docs:dev
```

Visit `http://localhost:5173` to preview.
访问 `http://localhost:5173` 进行预览。

### Build for Production / 构建生产版本

Build the static site to `.vitepress/dist`:
构建静态文件到 `.vitepress/dist` 目录：

```bash
npm run docs:build
```

### Preview Build / 预览构建结果

Test the production build locally:
在本地预览构建后的生产环境效果：

```bash
npm run docs:preview
```

## ⚙️ Configuration / 配置指南

The main configuration file is located at `docs/.vitepress/config.mts`.
主要配置文件位于 `docs/.vitepress/config.mts`。

### Domain Configuration (Critical for SEO) / 域名配置

Before deploying, **you must update** the `hostname` at the top of the config file. This ensures your Sitemap and social sharing images work correctly.
在发布上线前，**务必**修改配置文件顶部的 `hostname`，这将影响 Sitemap 和社交分享图片的生成。

```typescript
// docs/.vitepress/config.mts
const hostname = 'https://your-actual-domain.com'
```

## 📦 Deployment / 部署指南 (Nginx)

Recommended Nginx configuration for production:
推荐使用 Nginx 进行部署，以下是生产环境配置示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Config / SSL 证书配置
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;
    
    # Point to the dist folder / 指向构建生成的 dist 目录
    root /var/www/clawdbot-docs/docs/.vitepress/dist;
    index index.html;

    # Enable Gzip / 开启 Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Routing Logic (Required for cleanUrls) / 核心路由配置
    location / {
        try_files $uri $uri.html $uri/index.html /404.html;
    }

    # Cache Static Assets / 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 📝 License / 版权说明

This project is an unofficial guide created for educational purposes.
Clawdbot logo and trademarks belong to their respective owners.

本项目为非官方技术指南，仅供学习交流。Clawdbot 商标归原作者所有。
