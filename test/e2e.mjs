import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createStaticServer } from '../scripts/serve.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const evidenceDir = resolve(projectRoot, 'docs/evidence');
const passed = [];

function pass(message) {
  passed.push(message);
  console.log('  ✓ ' + message);
}

function evidence(name) {
  return resolve(evidenceDir, name);
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const board = document.getElementById('board-wrap').getBoundingClientRect();
    const action = document.getElementById('action').getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      board: { top: board.top, bottom: board.bottom, left: board.left, right: board.right },
      action: { top: action.top, bottom: action.bottom, left: action.left, right: action.right },
    };
  });
}

function assertInsideViewport(rect, viewport, label) {
  assert.ok(rect.left >= -1 && rect.right <= viewport.width + 1, label + ' 不应超出视口左右边界');
  assert.ok(rect.top >= -1 && rect.bottom <= viewport.height + 1, label + ' 不应超出视口上下边界');
}

async function overlayFits(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById('overlay');
    return (
      overlay.scrollHeight <= overlay.clientHeight + 1 &&
      overlay.scrollWidth <= overlay.clientWidth + 1
    );
  });
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  return errors;
}

async function touchSwipe(page, client, start, end) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: end.x, y: end.y }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function runDesktopChecks(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = watchErrors(page);

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal(await page.title(), '霓虹贪吃蛇 · Neon Snake');
  assert.equal((await page.locator('#overlay-title').textContent()).trim(), '霓虹贪吃蛇');
  assert.equal((await page.locator('#action').textContent()).trim(), '开始游戏');
  assert.equal((await page.locator('#score').textContent()).trim(), '0');
  assert.equal(await page.locator('#pause').isDisabled(), true);

  const startLayout = await layoutSnapshot(page);
  assert.ok(
    startLayout.scrollWidth <= startLayout.viewport.width + 1,
    '桌面端不应出现横向滚动'
  );
  assertInsideViewport(startLayout.board, startLayout.viewport, '桌面端棋盘');
  assertInsideViewport(startLayout.action, startLayout.viewport, '桌面端开始按钮');
  assert.equal(await overlayFits(page), true, '开始遮罩的内容不应被裁切');
  await page.screenshot({ path: evidence('after-desktop-start-1440x900.png'), animations: 'disabled' });
  pass('桌面端 1440×900 开始页布局与截图');

  await page.locator('#sound').click();
  assert.equal(await page.locator('#sound-off-icon').isVisible(), true, '静音后应显示关闭图标');
  await page.locator('#sound').click();
  assert.equal(await page.locator('#sound-on-icon').isVisible(), true, '取消静音后应显示开启图标');
  pass('音效开关可切换图标');

  await page.locator('#action').click();
  await page.waitForSelector('#overlay', { state: 'hidden' });
  assert.equal(await page.locator('#pause').isEnabled(), true, '开始后暂停按钮应可用');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#overlay').isHidden(), true, '游戏中不应显示遮罩');
  await page.screenshot({ path: evidence('after-desktop-playing-1440x900.png'), animations: 'disabled' });
  pass('键盘可开始游戏并操控方向（桌面端游戏中截图）');

  await page.locator('#pause').click();
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal((await page.locator('#overlay-title').textContent()).trim(), '已暂停');
  assert.equal(await page.locator('#play-icon').isVisible(), true, '暂停后应显示继续图标');
  await page.locator('#action').click();
  await page.waitForSelector('#overlay', { state: 'hidden' });
  assert.equal(await page.locator('#pause-icon').isVisible(), true);

  await page.keyboard.press('Space');
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal((await page.locator('#overlay-title').textContent()).trim(), '已暂停');
  await page.keyboard.press('Space');
  await page.waitForSelector('#overlay', { state: 'hidden' });
  pass('暂停 / 继续按钮与空格键均生效');

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () => document.getElementById('overlay')?.dataset.kind === 'over',
    undefined,
    { timeout: 8000 }
  );
  assert.equal((await page.locator('#overlay-title').textContent()).trim(), '游戏结束');
  assert.equal((await page.locator('#overlay-desc').textContent()).trim(), '撞到墙了，再来一局？');
  assert.match(
    (await page.locator('#overlay-score').textContent()).trim(),
    /^本局得分 \d+ · 最高分 \d+$/
  );
  assert.equal(await page.locator('#pause').isDisabled(), true, '结束后暂停按钮应禁用');
  const score = Number.parseInt((await page.locator('#score').textContent()).trim(), 10);
  const best = Number.parseInt((await page.locator('#best').textContent()).trim(), 10);
  assert.ok(Number.isFinite(score) && Number.isFinite(best));
  assert.ok(best >= score, '最高分不应低于本局得分');
  await page.screenshot({ path: evidence('after-desktop-gameover-1440x900.png'), animations: 'disabled' });
  pass('撞墙后正常结束并显示得分遮罩（桌面端结束截图）');

  await page.locator('#action').click();
  await page.waitForSelector('#overlay', { state: 'hidden' });
  assert.equal((await page.locator('#score').textContent()).trim(), '0');
  assert.equal((await page.locator('#level').textContent()).trim(), '1');
  pass('再来一局可重置分数并继续游戏');

  assert.deepEqual(errors, [], '桌面页面不应有控制台/脚本错误：' + errors.join('；'));
  pass('桌面页面无控制台错误');
  await context.close();
}

async function runMobileChecks(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  const client = await context.newCDPSession(page);

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal(await page.locator('#dpad').isVisible(), true, '触屏设备应显示方向键');

  const layout = await layoutSnapshot(page);
  assert.ok(layout.scrollWidth <= layout.viewport.width + 1, '移动端不应出现横向滚动');
  assertInsideViewport(layout.board, layout.viewport, '移动端棋盘');
  assertInsideViewport(layout.action, layout.viewport, '移动端开始按钮');
  assert.equal(await overlayFits(page), true, '移动端开始遮罩内容不应被裁切');
  await page.screenshot({ path: evidence('after-mobile-start-390x844.png'), animations: 'disabled' });
  pass('移动端 390×844 开始页布局、方向键与截图');

  await page.locator('#action').click();
  await page.waitForSelector('#overlay', { state: 'hidden' });
  await page.locator('.dpad__btn--up').click();
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#overlay').isHidden(), true);
  await page.screenshot({ path: evidence('after-mobile-playing-390x844.png'), animations: 'disabled' });
  pass('移动端方向键可控制游戏（移动端游戏中截图）');

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  const boardBox = await page.locator('#board').boundingBox();
  assert.ok(boardBox, 'board should have a bounding box');
  const centerX = boardBox.x + boardBox.width / 2;
  const centerY = boardBox.y + boardBox.height / 2;
  await touchSwipe(page, client, { x: centerX, y: centerY + 60 }, { x: centerX, y: centerY - 40 });
  await page.waitForSelector('#overlay', { state: 'hidden', timeout: 3000 });
  pass('触屏滑动棋盘可开始游戏');

  await page.evaluate(() => window.localStorage.setItem('neon-snake.best', '120'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal((await page.locator('#best').textContent()).trim(), '120');
  pass('最高分从 localStorage 恢复');

  assert.deepEqual(errors, [], '移动页面不应有控制台/脚本错误：' + errors.join('；'));
  pass('移动页面无控制台错误');
  await context.close();
}

async function runCompactLayoutCheck(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  const layout = await layoutSnapshot(page);
  assert.ok(layout.scrollWidth <= layout.viewport.width + 1, '1366×768 不应出现横向滚动');
  assertInsideViewport(layout.board, layout.viewport, '1366×768 棋盘');
  assertInsideViewport(layout.action, layout.viewport, '1366×768 开始按钮');
  await context.close();
  pass('1366×768 紧凑桌面布局可完整显示');
}

async function runFileProtocolCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = watchErrors(page);
  const indexUrl = pathToFileURL(resolve(projectRoot, 'index.html')).href;
  await page.goto(indexUrl, { waitUntil: 'load' });
  await page.waitForSelector('#overlay:not([hidden])');
  assert.equal((await page.locator('#overlay-title').textContent()).trim(), '霓虹贪吃蛇');
  await page.locator('#action').click();
  await page.waitForSelector('#overlay', { state: 'hidden' });
  await page.waitForTimeout(300);
  assert.equal((await page.locator('#score').textContent()).trim(), '0');
  assert.deepEqual(errors, [], 'file:// 页面不应有控制台/脚本错误：' + errors.join('；'));
  await context.close();
  pass('直接打开 index.html（file://）可正常游玩');
}

async function main() {
  console.log('运行端到端测试（本机 Chrome）…');
  await mkdir(evidenceDir, { recursive: true });
  const server = createStaticServer(projectRoot);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  let browser;

  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await runDesktopChecks(browser, baseUrl);
    await runMobileChecks(browser, baseUrl);
    await runCompactLayoutCheck(browser, baseUrl);
    await runFileProtocolCheck(browser);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log(`\nE2E 测试通过：${passed.length} 项。截图已输出到 docs/evidence/。`);
}

main().catch((error) => {
  console.error('\nE2E 测试失败：');
  console.error(error);
  process.exitCode = 1;
});
