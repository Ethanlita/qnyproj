import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 部署时需要设置 base 为仓库名
  base: process.env.NODE_ENV === 'production' ? '/qnyproj/' : '/',
  plugins: [
    react(),
    // 插件：复制 openapi.yaml 到 public 目录
    {
      name: 'copy-openapi',
      buildStart() {
        try {
          const src = resolve(__dirname, '../openapi.yaml')
          const dest = resolve(__dirname, 'public/openapi.yaml')
          copyFileSync(src, dest)
          console.log('✅ Copied openapi.yaml to public/')
        } catch (err) {
          console.warn('⚠️ Could not copy openapi.yaml:', err)
        }
      },
    },
    // GitHub Pages SPA fallback: duplicate index.html to 404.html after build
    {
      name: 'gh-pages-spa-fallback',
      closeBundle() {
        const indexPath = resolve(__dirname, 'dist/index.html')
        const notFoundPath = resolve(__dirname, 'dist/404.html')

        if (!existsSync(indexPath)) {
          console.warn('⚠️ Could not find dist/index.html to copy for 404 fallback')
          return
        }

        try {
          copyFileSync(indexPath, notFoundPath)
          console.log('✅ Copied dist/index.html to dist/404.html for GitHub Pages routing fallback')
        } catch (err) {
          console.warn('⚠️ Failed to create dist/404.html fallback:', err)
        }
      },
    },
  ],
})
