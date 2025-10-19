import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
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
  ],
})
