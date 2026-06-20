import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox']});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
const data = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector('h1')?.textContent,
  nav: [...document.querySelectorAll('.rail-link-label')].map((x) => x.textContent),
  active: document.querySelector('.view.active')?.id,
  begin: document.querySelector('.launch-visit')?.textContent,
}));
console.log(JSON.stringify({ data, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
