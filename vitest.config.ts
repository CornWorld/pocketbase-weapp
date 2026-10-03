import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 跨仓源码级复用:别名指向 polyfill 仓库的 src,测试不依赖先构建
const polyfill = (p: string) =>
  fileURLToPath(new URL(`../cornworld-miniprogram-polyfill/${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@cornworld/mp-core': polyfill('packages/mp-core/src/index.ts'),
      '@cornworld/mp-fetch': polyfill('packages/mp-fetch/src/index.ts'),
      '@cornworld/mp-storage': polyfill('packages/mp-storage/src/index.ts'),
      '@cornworld/mp-text-encoding': polyfill('packages/mp-text-encoding/src/index.ts'),
      '@cornworld/wx-mock': polyfill('internal/wx-mock/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
})
