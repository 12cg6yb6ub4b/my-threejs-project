import { defineConfig } from 'vite';

// base: './' —— 让构建产物以相对路径引用资源。
// GitHub Pages 部署在子路径（https://<user>.github.io/my-threejs-project/）下，
// 默认的绝对路径（/assets/...）会解析到域名根目录导致 404，相对路径则始终正确。
export default defineConfig({
  base: './',
});
