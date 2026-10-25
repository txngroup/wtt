// A guide page: plain text the build writes as <path>/index.html, without the app (see vite.config.ts).
export type Doc = {
  path: string
  title: string // <title> and social card title
  heading: string // the page's <h1>
  description: string // meta description
  html: string // the page text
  crumbs?: boolean // a route page, under the route index (/bridges/)
  jsonLd?: object // structured data for search engines
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
