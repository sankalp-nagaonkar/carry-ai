import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox']});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.click('.launch-visit');
await page.waitForSelector('.turn', { timeout: 6000 });
const data = await page.evaluate(() => ({
  processState: document.querySelector('#process-state')?.textContent,
  processHeard: document.querySelector('#process-heard')?.textContent,
  processContext: document.querySelector('#process-context')?.textContent,
  intelUpdated: document.querySelector('#intel-updated')?.textContent,
  activityTitle: document.querySelector('.action-title')?.textContent,
  soapS: document.querySelector('#soap-s')?.textContent,
}));
console.log(JSON.stringify({ data, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
