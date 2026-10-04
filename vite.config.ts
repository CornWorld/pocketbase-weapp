import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// 库模式双入口, 和 exports 对齐 ——
//   dist/index.js|.cjs + dist/index.d.ts   ← src/index.ts
//   dist/realtime.js|.cjs + dist/realtime.d.ts ← src/realtime.ts
// 运行时依赖全部外置(pocketbase 是 peer), 小程序宿主侧由打包器去重,
// link:/registry 形态不影响产物, 多入口共享的代码由 rollup 切公共 chunk。
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        realtime: 'src/realtime.ts',
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [/^pocketbase$/, /^mp-web-polyfill(\/|$)/, /^eventsource-parser(\/|$)/],
    },
  },
  plugins: [dts({ include: ['src'] })],
})
