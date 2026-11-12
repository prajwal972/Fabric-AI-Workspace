import { test, expect } from '@playwright/test';

test('existing local workspace: auth, persisted streamed mock chat, CSV analyst, tools and settings', async ({ page, context }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('.toggle').click();
  await page.locator('input[name=name]').fill('Browser QA');
  await page.locator('input[name=email]').fill('browser-qa@example.test');
  await page.locator('input[name=password]').fill('disposable browser QA password');
  await page.locator('.authform button[type=submit], .authform button.primary').click();
  await expect(page.locator('[data-page=Chat]')).toBeVisible();
  await page.locator('[data-page=Chat]').click();
  await page.locator('.prompt').fill('Foundation browser checkpoint');
  await page.locator('.send').click();
  await expect(page.locator('.messages')).toContainText('Mock response: Foundation browser checkpoint');
  // Streaming text is provisional until the server persists and emits done.
  await expect(page.locator('.send')).not.toHaveText('Stop');
  await page.reload(); await page.locator('[data-page=Chat]').click();
  await expect(page.locator('.messages')).toContainText('Mock response: Foundation browser checkpoint');

  await page.locator('.prompt').fill('stop check '.repeat(100));
  await page.locator('.send').click();
  await expect(page.locator('.send')).toHaveText('Stop');
  await expect(page.locator('.mbody').last()).toContainText('Mock response:');
  await expect(page.locator('.prompt')).toHaveValue('');
  await page.locator('.send').click();
  await expect(page.locator('.send')).toHaveText('Send');
  await expect.poll(async () => {
    const rows = await (await context.request.get('/api/conversations')).json();
    const conversation = await (await context.request.get('/api/conversations/' + rows.items[0].id)).json();
    return conversation.messages.some(message => message.status === 'cancelled');
  }).toBe(true);

  await page.locator('[data-page=Agents]').click();
  await page.locator('.analyst-upload').setInputFiles({ name: 'revenue.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue\nWest,70\nEast,50\n') });
  await expect(page.locator('.analyst-output')).toContainText('Uploaded data');
  await expect(page.locator('.analyst-output')).toContainText('revenue.csv');
  await page.locator('.agent-query').fill('What is total revenue?');
  await page.locator('.agent-analyze').click();
  await expect(page.locator('.analyst-chat-panel')).toContainText('120');
  await expect(page.locator('.agent-analyze')).toBeEnabled();
  await page.locator('[data-page=Files]').click();
  await expect(page.locator('.file-grid')).toContainText('revenue.csv');
  await page.locator('[data-page=Settings]').click();
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await page.locator('[data-settings-tab=security]').click();
  await expect(page.locator('.security-grid')).toContainText('Protected sessions');
  await expect(page.locator('#view')).not.toHaveClass(/view-loading|view-entering/);
  await page.screenshot({ path: 'test-results/foundation-settings.png', fullPage: true, animations: 'disabled' });

  const me = await (await context.request.get('/api/me')).json();
  const headers = { 'x-csrf-token': me.csrf };
  const tool = await context.request.post('/api/tools/execute', { headers, data: { toolId: 'calculator', input: { expression: '(12 + 3) * 4' } } });
  expect(tool.status()).toBe(200); expect((await tool.json()).result.value).toBe(60);
  const invalid = await context.request.get('/api/conversations?limit=1000');
  expect(invalid.status()).toBe(400); const error = await invalid.json();
  expect(error.error.code).toBe('VALIDATION_ERROR'); expect(error.error.requestId).toBeTruthy();
  await page.locator('[data-page=Files]').click();
  await expect(page.locator('.file-grid')).toContainText('revenue.csv');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-f]').first().click();
  await expect(page.locator('.file-grid')).toContainText('revenue.csv');
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/api/files/')), page.locator('[data-f]').first().click()]);
  await expect(page.locator('.file-grid')).not.toContainText('revenue.csv');
  await expect(page.locator('#toast')).toContainText('Deleted');

  const logout = await context.request.post('/api/auth/logout', { headers, data: {} }); expect(logout.status()).toBe(200);
  await page.reload(); await expect(page.locator('.authform')).toBeVisible();
  await page.locator('input[name=email]').fill('browser-qa@example.test');
  await page.locator('input[name=password]').fill('disposable browser QA password');
  await page.locator('.authform button.primary').click(); await expect(page.locator('[data-page=Chat]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('analyst charts use signed values, real scatter coordinates and multiline dataset rows',async({page})=>{
 await page.goto('/');await page.locator('.toggle').click();await page.locator('input[name=name]').fill('Chart QA');await page.locator('input[name=email]').fill('chart-qa@example.test');await page.locator('input[name=password]').fill('disposable chart QA password');await page.locator('.authform button.primary').click();await page.locator('[data-page=Agents]').click();
 await page.locator('.analyst-upload').setInputFiles({name:'signed.csv',mimeType:'text/csv',buffer:Buffer.from('Region,X,Y,Revenue,Note\nA,1,-20,-20,"first\nsecond"\nB,10,0,0,plain\nC,100,40,40,plain\n')});
 await expect(page.locator('.analyst-output')).toContainText('3 rows');await page.locator('.agent-query').fill('create a dashboard');await page.locator('.agent-analyze').click();await expect(page.locator('.power-dashboard')).toBeVisible();
 const scatter=page.locator('[data-chart=x_vs_y]');await expect(scatter.locator('circle')).toHaveCount(3);const points=await scatter.locator('circle').evaluateAll(nodes=>nodes.map(n=>({x:Number(n.getAttribute('cx')),y:Number(n.getAttribute('cy')),rawX:Number(n.getAttribute('data-x'))})));expect(points.map(p=>p.rawX)).toEqual([1,10,100]);expect(points[1].x-points[0].x).toBeLessThan(points[2].x-points[1].x);expect(points[0].y).toBeGreaterThan(points[2].y);
 const bar=page.locator('[data-chart=revenue_by_region]');await expect(bar).toBeVisible();const signed=await bar.locator('rect[data-value="-20"]').getAttribute('y');const zero=await bar.locator('[data-zero-y]').getAttribute('data-zero-y');expect(Number(signed)).toBeGreaterThanOrEqual(Number(zero));await expect(bar).toContainText('-20');
 await page.screenshot({path:'test-results/signed-analyst-charts.png',fullPage:true,animations:'disabled'});
});

test('ambiguous JSON and JSONL uploads stay failed; valid JSON remains usable', async ({page,context}) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.locator('.toggle').click();
  await page.locator('input[name=name]').fill('JSON QA');await page.locator('input[name=email]').fill('json-qa@example.test');await page.locator('input[name=password]').fill('disposable JSON QA password');await page.locator('.authform button.primary').click();
  await page.locator('[data-page=Agents]').click();
  for(const [name,text] of [['ambiguous.json','[{"Value":1,"Value":999}]'],['ambiguous.jsonl','{"Value":1}\n{"Value":2,"Value":3}']]) {
    await page.locator('.analyst-upload').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(text)});
    await expect.poll(async()=>{
      const files=await (await context.request.get('/api/files')).json();
      return files.items.find(f=>f.name===name)?.status;
    }).toBe('failed');
  }
  await page.locator('.analyst-upload').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from('[{"Region":"West","Revenue":1.25e2},{"Region":"East","Revenue":-2.5e-1}]')});
  await expect.poll(async()=>{
    const files=await (await context.request.get('/api/files')).json();
    return files.items.find(f=>f.name==='valid.json')?.status;
  }).toBe('ready');
  // Failed sources must never be analyzed. Deselect them explicitly, as a user would.
  for (const name of ['ambiguous.json','ambiguous.jsonl']) {
    const label=page.locator('.agent-file').filter({has:page.getByText(name,{exact:true})});
    await label.locator('input').uncheck();await expect(label).not.toHaveClass(/selected/);
  }
  await page.locator('.agent-query').fill('What is total revenue?');await page.locator('.agent-analyze').click();
  await expect(page.locator('.analyst-chat-panel')).toContainText('124.75');
  expect(errors).toEqual([]);
});
