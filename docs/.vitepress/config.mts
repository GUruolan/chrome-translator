import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'lanbito',
  description: 'lanbito 的个人文档站点',
  base: '/lanbito/', // GitHub Pages 部署时需要与仓库名一致

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: 'GitHub', link: 'https://github.com/GUruolan' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '介绍', link: '/guide/introduction' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/GUruolan' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 lanbito',
    },

    search: {
      provider: 'local',
    },
  },
})
