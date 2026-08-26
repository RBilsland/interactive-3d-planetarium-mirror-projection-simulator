import { defineConfig } from 'vite'

const repoName = 'interactive-3d-planetarium-mirror-projection-simulator'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? `/${repoName}/` : '/',
})
