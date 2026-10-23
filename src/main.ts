import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// #app holds the pre-rendered page text for crawlers and no-JavaScript visitors; the app replaces it.
const target = document.getElementById('app')!
target.replaceChildren()
mount(App, { target })
