const { chromium } = require('playwright-core');

const ok = (name, cond, extra = '') =>
  console.log((cond ? '✅ ' : '❌ ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => logs.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

  const txt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  // 清空上次的登录态，确保从登录页开始
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.login-card', { timeout: 10000 });
  ok('1. 登录页渲染', /WebQQ/.test(await txt()));

  // 注册
  await page.click('.mode-tabs span:nth-child(2)');
  const stamp = Date.now().toString().slice(-4);
  const nickname = '用户' + stamp;
  const inputs = page.locator('.login-body input');
  await inputs.nth(0).fill(nickname);
  await inputs.nth(1).fill('123456');
  ok('2. 表单已填', true, nickname);

  await page.click('.login-btn');

  // 诊断：观察跳转
  let landed = '';
  try {
    await page.waitForSelector('.side-panel', { timeout: 10000 });
    landed = 'side-panel';
  } catch (e) {
    landed = 'TIMEOUT: ' + (await txt()).slice(0, 200);
  }
  ok('3. 注册后跳转主面板', landed === 'side-panel', landed);

  if (landed !== 'side-panel') {
    console.log('\n--- 所有日志 ---');
    logs.forEach((l) => console.log(l));
    await page.screenshot({ path: 'C:/Users/aww/AppData/Local/Temp/webqq-fail.png' });
    console.log('失败截图: C:/Users/aww/AppData/Local/Temp/webqq-fail.png');
    await page.close();
    await browser.close();
    process.exit(1);
  }

  // 主面板断言
  const qqNo = await page.locator('.side-header .me-sub').first().innerText();
  ok('4. 分配 QQ 号', /QQ 1000\d{2}/.test(qqNo), qqNo);

  const footer = await page.locator('.side-footer').first().innerText();
  ok('5. 侧栏统计', /\d+ 好友 · \d+ 群/.test(footer), footer);

  ok('6. 聊天空状态', await page.locator('.empty-state').count() > 0);

  // 建群
  await page.click('.side-tabs button:nth-child(2)');
  await page.waitForSelector('text=还没有群聊', { timeout: 5000 });
  const groupBtns = await page.locator('button:has-text("创建新群")').count();
  ok('7a. 找到创建新群按钮', groupBtns > 0, `count=${groupBtns}`);
  await page.click('button:has-text("创建新群")');
  await page.waitForSelector('.ant-modal input', { timeout: 5000 });
  const gname = '群' + stamp;
  await page.fill('.ant-modal input', gname);
  await page.waitForTimeout(200);
  const okBtns = await page.locator('.ant-modal-footer button').allInnerTexts();
  ok('7b. 建群弹窗 OK 按钮', okBtns.join('/').includes('创建'), okBtns.join('/'));
  await page.click('.ant-modal-footer button.ant-btn-primary');
  await page.waitForTimeout(1500);
  const afterGroupTxt = await txt();
  ok('7c. 建群后列表包含群名', afterGroupTxt.includes(gname), gname + ' | ' + afterGroupTxt.slice(0, 160));

  // 群名断言（用更宽松的方式）
  const groupItem = await page.locator('.chat-item').first().innerText();
  ok('8. 群列表显示人数/群号', /人 · 群号/.test(groupItem), groupItem.replace(/\s+/g, ' '));

  await page.click('.chat-item');
  await page.waitForSelector('.chat-window', { timeout: 5000 });
  ok('9. 群窗口打开', true, await page.locator('.chat-titlebar .name').innerText());

  await page.waitForSelector('.msg.system', { timeout: 5000 });
  ok('10. 系统消息', true, await page.locator('.msg.system .sys').innerText());

  await page.locator('.chat-input textarea').fill('自动化测试群消息');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.msg.self .bubble', { timeout: 5000 });
  ok('11. 群消息发送', true, await page.locator('.msg.self .bubble').last().innerText());

  const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('PAGEERROR') || l.startsWith('REQFAIL'));
  ok('12. 无前端错误', errs.length === 0, errs.slice(0, 4).join(' ; '));

  await page.screenshot({ path: 'C:/Users/aww/AppData/Local/Temp/webqq-group.png' });
  console.log('截图: C:/Users/aww/AppData/Local/Temp/webqq-group.png');

  await page.close();
  await browser.close();
  console.log('\n=== UI 端到端完成 ===');
  process.exit(0);
})().catch((e) => {
  console.error('❌ ERR', e.message);
  process.exit(1);
});
