import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "英语之道",
        short_name: "英语之道",
        description: "真题与背单词打通的英语学习工具",
        lang: "zh-CN",
        theme_color: "#eef3fc",
        background_color: "#eef3fc",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // pdf.js 的解析器不进预缓存：2026-11-08 上线时 nginx 把 .mjs 当 octet-stream 发，早装上的设备预缓存里存的就是这份坏的，
        // 而文件名带固定哈希、版本号不变，预缓存永远不会换掉它。考场改用 ?mime=js 的地址取，由下面单独的运行时缓存存
        // pdf-lib（导出 PDF 才用，440KB）也不预缓存：慢网下第一次装的时候别和录音预下载抢带宽，用到时再取、存运行时缓存
        globIgnores: ["**/pdf.worker*", "**/pdf-lib-*.js"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // pdf.js 解析器（见上面 globIgnores）：第一次开卷时存下，之后离线也能开卷
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/pdf.worker"),
            handler: "CacheFirst",
            options: { cacheName: "pdf-worker", expiration: { maxEntries: 3 } },
          },
          {
            // pdf.js 的 CMap 和标准字体（public/pdfjs/，原卷里没嵌的中文、Times 等要用）：用到哪个存哪个，离线也能画
            urlPattern: ({ url }) => url.pathname.startsWith("/pdfjs/"),
            handler: "CacheFirst",
            options: { cacheName: "pdf-assets", expiration: { maxEntries: 60 } },
          },
          {
            // 导出 PDF 用的 pdf-lib：第一次导出时存下
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/pdf-lib-"),
            handler: "CacheFirst",
            options: { cacheName: "pdf-lib", expiration: { maxEntries: 3 } },
          },
          {
            // 目录（试卷目录、录音清单）会随导入变化：有网先取新的，没网用缓存
            urlPattern: ({ url }) => /^\/(papers|audio\/words)\/index\.json$/.test(url.pathname),
            handler: "NetworkFirst",
            options: { cacheName: "indexes", networkTimeoutSeconds: 3 },
          },
          {
            // 试卷数据、解析、句子译文层、卷面单词坐标（.words.json）会重新导入、润色、校正：先用缓存秒开，后台再取新的。
            // 单词坐标以前落在下面的 CacheFirst 规则里，2026-11-11 按图像校正过的坐标到不了老设备，所以并进这一条
            urlPattern: ({ url }) => /^\/papers\/((explain|trans)\/[^/]+|[^/]+|pdf\/[^/]+\.words)\.json$/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "paper-data", expiration: { maxEntries: 400 } },
          },
          {
            // 单词真人录音很多（上万个小文件），单独一个缓存，不挤掉试卷和听力
            urlPattern: ({ url }) => url.pathname.startsWith("/audio/words/") && url.pathname.endsWith(".mp3"),
            handler: "CacheFirst",
            options: {
              cacheName: "word-audio",
              expiration: { maxEntries: 15000 },
            },
          },
          // 原卷 PDF、整套听力录音是几 MB 到几十 MB 的大文件。慢网（国内到新加坡 0.5MB/s）下不能让 Service Worker 一上来就整个下载：
          // 那会把带宽占满，pdf.js 取第一页的分段请求排不上队，第一页要等整个文件下完（2026-11-08 线上量过 40 多秒）。所以分三条：
          //  1) 带 x-warm 头的完整请求 → 下载并存进缓存（原卷 PDF 现在由页面自己分段取、直接 cache.put，这条留作备用）；
          //  2) 带 Range 的分段请求（pdf.js、<audio>、页面分段下载）→ 缓存里有完整文件就从缓存切一段，没有就直接走网络、不存；
          //  3) 其他完整请求（pdf.js 开头的探测请求）→ 只走网络、不存。
          // 听力录音单独一个 "listening" 缓存：页面在后台把整份分段下完存进去（src/lib/audioCache.ts，只留最近 6 套，由页面按访问时间淘汰，
          // Service Worker 这边不设条数限制）；<audio> 的 Range 请求命中就从缓存切，没命中走网络。
          // urlPattern 会被原样写进 sw.js，正则只能写在函数里面
          {
            urlPattern: ({ url, request }) => /^\/papers\/pdf\/[^/]+\.pdf$/.test(url.pathname) && request.headers.has("x-warm"),
            handler: "CacheFirst",
            options: { cacheName: "content", expiration: { maxEntries: 400 } },
          },
          {
            urlPattern: ({ url, request }) => /^\/audio\/[^/]+\.mp3$/.test(url.pathname) && request.headers.has("range"),
            handler: "CacheFirst",
            options: { cacheName: "listening", rangeRequests: true, plugins: [{ cacheWillUpdate: async () => null }] },
          },
          {
            urlPattern: ({ url, request }) => /^\/papers\/pdf\/[^/]+\.pdf$/.test(url.pathname) && request.headers.has("range"),
            handler: "CacheFirst",
            options: { cacheName: "content", rangeRequests: true, plugins: [{ cacheWillUpdate: async () => null }] },
          },
          {
            urlPattern: ({ url }) => /^\/(papers\/pdf\/[^/]+\.pdf|audio\/[^/]+\.mp3)$/.test(url.pathname),
            handler: "NetworkOnly",
          },
          {
            // 词典分片、词书、试卷的单词坐标和缩略图按需缓存，离线也能用
            urlPattern: ({ url }) => /^\/(dict|papers|audio)\//.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "content",
              expiration: { maxEntries: 400 },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  server: {
    // 查词在线兜底（src/lib/youdao.ts）：开发时也转发到有道，和线上 nginx 的 /yd/ 一样
    proxy: {
      "/yd/": {
        target: "https://dict.youdao.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yd\//, "/jsonapi"),
        headers: { "User-Agent": "Mozilla/5.0", Referer: "" },
      },
    },
    // 真题原件（4 GB 多）、导入用的中间数据和打包结果都不是源码，不让开发服务器盯着它们，改动时也不会卡。
    // 试卷和音频导入时会频繁写文件，盯着它们会整页刷新；代价是新导入的试卷要重启开发服务器才看得到
    watch: { ignored: ["**/真题/**", "**/data/**", "**/dist/**", "**/docs/**", "**/scripts/**", "**/public/papers/**", "**/public/audio/**"] },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 第三方库单独打包，业务代码更新时用户不用重新下载它们
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          vendor: ["dexie", "dexie-react-hooks", "ts-fsrs", "tailwind-merge", "clsx"],
          pdf: ["pdfjs-dist"],
          "pdf-lib": ["pdf-lib"],
        },
      },
    },
  },
});
