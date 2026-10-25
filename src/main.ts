import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// #app holds the pre-rendered page text for crawlers and no-JavaScript visitors; the app replaces it. A guide page
// (src/content/) is that text alone and marks it data-static: builds leave this script out of it, and the dev server,
// which keeps it for the styles, gets nothing more from it.
const target = document.getElementById('app')!
if (target.dataset.static === undefined) {
  target.replaceChildren()
  mount(App, { target })
}
