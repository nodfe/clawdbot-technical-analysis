import { defineConfig } from 'vitepress'

// ⚠️⚠️⚠️【重要】发布前请务必修改这里的域名 ⚠️⚠️⚠️
// 将下方链接替换为您实际部署的域名（不需要末尾斜杠）
const hostname = 'https://clawdbot-guide.com'

export default defineConfig({
  title: "Clawdbot 技术解析",
  description: "Clawdbot 深度技术指南与架构分析",
  
  // 1. Sitemap 自动生成配置
  sitemap: {
    hostname: hostname
  },

  // 2. 开启 Clean URLs (去掉 .html 后缀，SEO 更友好)
  cleanUrls: true,

  // 3. 最后更新时间显示
  lastUpdated: true,

  // 4. SEO Meta 标签配置
  head: [
    ['link', { rel: 'icon', href: '/pixel-lobster.svg' }],
    ['meta', { name: 'theme-color', content: '#bd34fe' }],
    ['meta', { name: 'author', content: 'Gnod' }],
    
    // Open Graph (Facebook/Discord 分享卡片)
    ['meta', { property: 'og:type', content: 'website' }],
    // 这里的图片链接会自动使用上面定义的 hostname
    ['meta', { property: 'og:image', content: `${hostname}/pixel-lobster.svg` }],
    
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${hostname}/pixel-lobster.svg` }]
  ],
  
  themeConfig: {
    logo: '/pixel-lobster.svg',
    siteTitle: 'Clawdbot 技术解析',
    
    socialLinks: [
      { icon: 'github', link: 'https://github.com/nodfe/clawdbot-technical-analysis' }
    ],

    footer: {
      message: 'Created by Gnod. This site is for educational purposes.',
      copyright: 'Clawdbot logo and trademarks belong to their respective owners.' 
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
              }
            }
          }
        }
      }
    },

    editLink: {
      pattern: 'https://github.com/nodfe/clawdbot-technical-analysis/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    }
  },

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: "Clawdbot 技术解析",
      description: "Clawdbot 深度技术指南与架构分析",
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '阅读教程', link: '/guide/intro' },
          { text: 'GitHub', link: 'https://github.com/nodfe/clawdbot-technical-analysis' }
        ],
        sidebar: [
          {
            text: '技术深度解析教程',
            items: [
              { text: '1. 概述与架构设计', link: '/guide/intro' },
              { text: '2. Gateway核心机制', link: '/guide/gateway' },
              { text: '3. 多通道系统实现', link: '/guide/channels' },
              { text: '4. 代理(Agent)系统', link: '/guide/agents' },
              { text: '5. 工具系统与扩展', link: '/guide/tools' },
              { text: '6. 技能与插件架构', link: '/guide/skills' },
              { text: '7. 内存与状态管理', link: '/guide/memory' },
              { text: '8. 模型集成与AI接口', link: '/guide/models' },
              { text: '9. 安全模型与权限', link: '/guide/security' },
              { text: '10. 部署与最佳实践', link: '/guide/deployment' }
            ]
          }
        ]
      }
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      title: "Clawdbot Deep Dive",
      description: "In-depth Technical Guide for Clawdbot",
      themeConfig: {
        siteTitle: 'Clawdbot Deep Dive',
        editLink: { text: 'Edit this page on GitHub' },
        lastUpdated: { text: 'Last updated' },
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Read Guide', link: '/en/guide/intro' },
          { text: 'GitHub', link: 'https://github.com/nodfe/clawdbot-technical-analysis' }
        ],
        sidebar: [
          {
            text: 'Technical Deep Dive',
            items: [
              { text: '1. Overview & Architecture', link: '/en/guide/intro' },
              { text: '2. Gateway Mechanism', link: '/en/guide/gateway' },
              { text: '3. Multi-Channel System', link: '/en/guide/channels' },
              { text: '4. Agent System', link: '/en/guide/agents' },
              { text: '5. Tools & Extensions', link: '/en/guide/tools' },
              { text: '6. Skills & Plugins', link: '/en/guide/skills' },
              { text: '7. Memory Management', link: '/en/guide/memory' },
              { text: '8. Model Integration', link: '/en/guide/models' },
              { text: '9. Security Model', link: '/en/guide/security' },
              { text: '10. Deployment', link: '/en/guide/deployment' }
            ]
          }
        ]
      }
    }
  }
})
