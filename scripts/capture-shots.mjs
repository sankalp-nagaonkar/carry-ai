import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5173';
const OUT = 'deck/shots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();

async function reset() {
  await page.goto(`${BASE}/api/reset?entityId=patient_demo_001`, { waitUntil: 'networkidle0' });
}
async function open() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(700);
}
async function nav(p) {
  await page.click(`.rail-link[data-page="${p}"]`);
  await sleep(500);
}
async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// Fresh empty state
await reset();
await open();
await shot('today-empty');

// Run Visit 1 fully, capturing a mid-visit live frame
await page.click('.scenario-opt[data-scenario="visit1"]').catch(() => {});
await page.click('.launch-visit');
await sleep(4500);                 // let a few turns + an incremental land
await shot('live-visit1-mid');
// wait for completion (Begin next visit re-enabled)
await page.waitForFunction(() => {
  const b = document.querySelector('.launch-visit');
  return b && !b.disabled;
}, { timeout: 90000 });
await sleep(800);
await shot('live-visit1-review');

// Today now has history; capture pre-read with carried-forward
await nav('today');
await sleep(600);
await shot('today-after-v1');

// Run Visit 2 (the allergy-catch hero)
await page.click('.scenario-opt[data-scenario="visit2"]').catch(() => {});
await page.click('.launch-visit');
// wait until a cancelled med appears (struck out) for the hero frame
await page.waitForFunction(() => {
  return !!document.querySelector('#live-meds .li-strike') ||
         !!document.querySelector('#card-safety.flag');
}, { timeout: 90000 }).catch(() => {});
await sleep(1200);
await shot('live-visit2-allergy');
await page.waitForFunction(() => {
  const b = document.querySelector('.launch-visit');
  return b && !b.disabled;
}, { timeout: 90000 });
await sleep(800);
await shot('live-visit2-review');

// Patient, Timeline, Graph now span both visits
await nav('profile');
await sleep(600); await shot('patient-record');
await nav('timeline');
await sleep(600); await shot('timeline');
await nav('graph');
await sleep(900); await shot('graph');

await browser.close();
console.log('done');
