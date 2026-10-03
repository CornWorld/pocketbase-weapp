import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 跨仓源码级复用:别名指向 polyfill 仓库的 src,测试不依赖先构建
const polyfill = (p: string) =>
  fileURLToPath(new URL(`../cornworld-miniprogram-polyfill/${p}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'mp-web-polyfill/core': polyfill('packages/mp-web-polyfill/src/core/index.ts'),
      'mp-web-polyfill/fetch': polyfill('packages/mp-web-polyfill/src/fetch/index.ts'),
      'mp-web-polyfill/storage': polyfill('packages/mp-web-polyfill/src/storage/index.ts'),
      'mp-web-polyfill/text-encoding': polyfill(
        'packages/mp-web-polyfill/src/text-encoding/index.ts',
      ),
      '@cornworld/wx-mock': polyfill('internal/wx-mock/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
})
