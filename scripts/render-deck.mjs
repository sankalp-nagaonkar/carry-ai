import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const deck = pathToFileURL(resolve('deck/index.html')).href;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(deck, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

// PDF: one slide per page at exact 1280x720.
await page.pdf({
  path: 'deck/Carry-deck.pdf',
  width: '1280px',
  height: '720px',
  printBackground: true,
  pageRanges: '',
});
console.log('pdf written');

// Also render slide thumbnails for visual QA.
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
const slides = await page.$$('.slide');
let i = 1;
for (const s of slides) {
  await s.screenshot({ path: `deck/preview-${String(i).padStart(2, '0')}.png` });
  i++;
}
console.log('rendered', slides.length, 'slide previews');
await browser.close();
