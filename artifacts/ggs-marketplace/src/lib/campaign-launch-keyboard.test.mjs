import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const packageDirectory = process.cwd();
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
let viteProcess;
let browserProcess;
let browserDirectory;
let cdp;

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

class DevToolsClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new DevToolsClient(socket);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async key(key, code, keyCode, modifiers = 0) {
    const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode, modifiers,
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode, modifiers,
    });
  }

  close() {
    this.socket.close();
  }
}

async function pressEnter() {
  await cdp.key('Enter', 'Enter', 13);
}

async function pressSpace() {
  await cdp.key(' ', 'Space', 32);
}

async function focusByTab(expression, description, maxTabs = 30) {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await cdp.evaluate(expression)) return;
    await cdp.key('Tab', 'Tab', 9);
  }
  throw new Error(`Could not reach ${description} with Tab`);
}

async function activeElementId() {
  return cdp.evaluate('document.activeElement?.id || ""');
}

async function phoneLayoutState() {
  return JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
    const rect = element => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility,
      };
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY,
      visualViewport: window.visualViewport ? { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop } : null,
      resizeEvents: window.__phoneResizeEvents || [],
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      focusId: document.activeElement?.id || '',
      focus: rect(document.activeElement),
      controls: rect(document.querySelector('.launch-controls')),
      previous: rect(document.querySelector('[data-testid="button-launch-previous"], .launch-back-link')),
      next: rect(document.querySelector('[data-testid="button-launch-next"], [data-testid="button-launch-submit"]')),
    };
  })())`));
}

async function tabletLayoutState() {
  return JSON.parse(await cdp.evaluate(`JSON.stringify((() => {
    const rect = element => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility,
      };
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollY: window.scrollY,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      focusId: document.activeElement?.id || document.activeElement?.dataset?.testid || '',
      focus: rect(document.activeElement),
      controls: rect(document.querySelector('.launch-controls')),
      focusInControls: Boolean(document.querySelector('.launch-controls')?.contains(document.activeElement)),
      previous: rect(document.querySelector('[data-testid="button-launch-previous"], .launch-back-link')),
      next: rect(document.querySelector('[data-testid="button-launch-next"], [data-testid="button-launch-submit"]')),
    };
  })())`));
}

function assertTabletLayout(state, expectedFocus, context) {
  assert.ok(state.documentWidth <= state.width, `${context}: page overflows horizontally (${state.documentWidth}px > ${state.width}px)`);
  assert.equal(state.focusId, expectedFocus, `${context}: expected focus on ${expectedFocus}`);
  assert.ok(state.focus?.width > 0 && state.focus?.height > 0, `${context}: focused control is not rendered`);
  const roundedViewport = { ...state, width: state.width + 1, height: state.height + 1 };
  assertPhoneElementVisible(state.focus, roundedViewport, `${context}: focused control`);
  assertPhoneElementVisible(state.controls, roundedViewport, `${context}: sticky navigation`);
  for (const [name, rect] of [['previous', state.previous], ['next', state.next]]) {
    assert.ok(rect && rect.width > 0 && rect.height > 0, `${context}: ${name} navigation has no visible size`);
    assert.notEqual(rect.display, 'none', `${context}: ${name} navigation is hidden`);
    assert.notEqual(rect.visibility, 'hidden', `${context}: ${name} navigation is hidden`);
    assert.ok(rect.left >= 0 && rect.right <= state.width, `${context}: ${name} navigation is clipped horizontally`);
    assert.ok(rect.top >= -1 && rect.bottom <= state.height + 1, `${context}: ${name} navigation is outside the viewport`);
  }
  if (!state.focusInControls) {
    assert.ok(
      state.focus.bottom <= state.controls.top || state.focus.top >= state.controls.bottom,
      `${context}: sticky navigation covers the focused control`,
    );
  }
}

async function assertTabletLayoutReady(expectedFocus, context) {
  // Focus visibility is adjusted on the next animation frame. Sticky edges can
  // also land on fractional CSS pixels while the header becomes compact.
  await waitFor(
    async () => {
      assertTabletLayout(await tabletLayoutState(), expectedFocus, context);
      return true;
    },
    `${context} layout to settle`,
    5_000,
  );
}

function assertPhoneLayout(state, expectedFocus, context) {
  assert.ok(state.documentWidth <= state.width, `${context}: page overflows horizontally (${state.documentWidth}px > ${state.width}px)`);
  assert.equal(state.focusId, expectedFocus, `${context}: wrong element has focus`);
  assert.ok(state.focus?.width > 0 && state.focus?.height > 0, `${context}: focused element is not rendered`);
  assertPhoneElementVisible(state.focus, state, `${context}: focused element`);
  for (const [name, rect] of [['previous', state.previous], ['next', state.next]]) {
    assert.ok(rect && rect.display !== 'none' && rect.visibility !== 'hidden', `${context}: ${name} navigation control is hidden`);
    assert.ok(rect.width > 0 && rect.height > 0, `${context}: ${name} navigation control has no visible size`);
    assert.ok(
      rect.left >= 0 && rect.right <= state.width,
      `${context}: ${name} navigation control is clipped horizontally (${JSON.stringify(rect)} in ${state.width}px viewport)`,
    );
  }
}

async function assertPhoneLayoutAfterFocus(expectedFocus, context) {
  await waitFor(
    () => cdp.evaluate(`(() => {
      const rect = document.activeElement?.getBoundingClientRect();
      return Boolean(rect && rect.width > 0 && rect.height > 0
        && rect.top >= 0 && rect.bottom <= window.innerHeight);
    })()`),
    `${context} to settle in the viewport`,
    5_000,
  );
  const state = await phoneLayoutState();
  assertPhoneLayout(state, expectedFocus, context);
  return state;
}

function assertPhoneElementVisible(rect, state, context) {
  assert.ok(rect, `${context}: element is not rendered`);
  assert.ok(rect.width > 0 && rect.height > 0, `${context}: element has no visible size`);
  assert.notEqual(rect.display, 'none', `${context}: element is hidden`);
  assert.notEqual(rect.visibility, 'hidden', `${context}: element is hidden`);
  assert.ok(
    rect.top >= 0 && rect.bottom <= state.height,
    `${context}: element is outside the ${state.height}px viewport (${JSON.stringify({ rect, scrollY: state.scrollY, visualViewport: state.visualViewport, resizeEvents: state.resizeEvents })})`,
  );
  assert.ok(rect.left >= 0 && rect.right <= state.width, `${context}: element is clipped horizontally`);
}

function assertReviewEditIsReachable(state, context) {
  assert.ok(state.documentWidth <= state.width, `${context}: page overflows horizontally`);
  assertPhoneElementVisible(state.focus, state, context);
  assert.ok(
    state.focus.bottom <= state.controls.top || state.focus.top >= state.controls.bottom,
    `${context}: the sticky navigation covers the focused edit control`,
  );
}

async function stopProcess(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([once(process, 'exit'), delay(5_000)]);
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL');
    await Promise.race([once(process, 'exit'), delay(1_000)]);
  }
}

before(async () => {
  const port = await getFreePort();
  const env = { ...process.env, PORT: String(port), BASE_PATH: '/' };
  delete env.REPL_ID;
  viteProcess = spawn(
    process.execPath,
    [path.join(packageDirectory, 'node_modules/vite/bin/vite.js'), '--config', 'vite.config.ts', '--host', '127.0.0.1'],
    { cwd: packageDirectory, env, stdio: 'ignore' },
  );
  const url = `http://127.0.0.1:${port}/launch`;
  await waitFor(async () => {
    if (viteProcess.exitCode !== null) throw new Error(`Vite exited with code ${viteProcess.exitCode}`);
    const response = await fetch(url);
    return response.ok;
  }, 'the local marketplace server');

  browserDirectory = await mkdtemp(path.join(os.tmpdir(), 'ggs-campaign-keyboard-'));
  browserProcess = spawn(chromiumPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${browserDirectory}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const activePortPath = path.join(browserDirectory, 'DevToolsActivePort');
  const activePortContent = await waitFor(async () => {
    if (browserProcess.exitCode !== null) throw new Error(`Chromium exited with code ${browserProcess.exitCode}`);
    try { return await readFile(activePortPath, 'utf8'); } catch { return null; }
  }, 'the Chromium DevTools endpoint');
  const debugPort = activePortContent.split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chromium should expose a page target');
  cdp = await DevToolsClient.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector("[data-testid=\\"page-launch\\"]"))'), 'the launch wizard');
  await waitFor(() => activeElementId(), 'initial launch field focus');
});

after(async () => {
  cdp?.close();
  await stopProcess(browserProcess);
  await stopProcess(viteProcess);
  if (browserDirectory) await rm(browserDirectory, { recursive: true, force: true, maxRetries: 3 });
});

test('the launch wizard can be completed by keyboard with validation, Escape confirmation, and focus changes', async () => {
  assert.equal(await activeElementId(), 'launch-name');

  await pressEnter();
  await waitFor(
    () => cdp.evaluate('Boolean(document.querySelector("[data-testid=\\"text-launch-validation-hint\\"]"))'),
    'the invalid-name validation message',
  );
  assert.match(await cdp.evaluate('document.querySelector("[data-testid=\\"text-launch-validation-hint\\"]").textContent'), /campaign name/i);
  assert.equal(await cdp.evaluate('document.querySelector("[data-testid=\\"button-progress-step-1\\"]")?.getAttribute("aria-current")'), 'step');

  await cdp.send('Input.insertText', { text: 'Keyboard test campaign' });
  await pressEnter();
  await waitFor(() => activeElementId(), 'the brief field');
  await waitFor(() => activeElementId().then(id => id === 'launch-brief'), 'focus on the brief field');

  await cdp.evaluate(`(() => {
    window.__escapeConfirmMessages = [];
    window.confirm = message => {
      window.__escapeConfirmMessages.push(message);
      return false;
    };
  })()`);
  await cdp.key('Escape', 'Escape', 27);
  assert.equal(await cdp.evaluate('window.__escapeConfirmMessages.length'), 1);
  assert.match(await cdp.evaluate('window.__escapeConfirmMessages[0]'), /leave|exit/i);
  assert.equal(await cdp.evaluate('location.pathname'), '/launch');

  await cdp.send('Input.insertText', { text: 'Share the protocol launch and its audience.' });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-usd'), 'focus on the USD field');
  await pressEnter();
  assert.equal(await cdp.evaluate('document.querySelector("[data-testid=\\"button-progress-step-3\\"]")?.getAttribute("aria-current")'), 'step');

  for (let index = 0; index < 5; index += 1) {
    await cdp.key('Tab', 'Tab', 9);
  }
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-toggle-direct-celo"'),
    'keyboard focus on the direct CELO option',
  );
  await cdp.evaluate(`(() => {
    window.__directToggleClicks = 0;
    document.querySelector('[data-testid="button-toggle-direct-celo"]')
      .addEventListener('click', () => window.__directToggleClicks++);
  })()`);
  await pressSpace();
  try {
    await waitFor(() => cdp.evaluate('Boolean(document.querySelector("#launch-celo"))'), 'the direct CELO field', 5_000);
  } catch (error) {
    const state = await cdp.evaluate(`JSON.stringify({
      active: document.activeElement?.outerHTML,
      clicks: window.__directToggleClicks,
      input: Boolean(document.querySelector('#launch-celo')),
      step: document.querySelector('[aria-live="polite"]')?.textContent,
      error: document.querySelector('[role="alert"]')?.textContent,
    })`);
    throw new Error(`${error.message}; browser state ${state}`);
  }
  await cdp.key('Tab', 'Tab', 9, 8);
  await waitFor(() => activeElementId().then(id => id === 'launch-celo'), 'focus on the direct CELO field');
  await cdp.send('Input.insertText', { text: '0.0999' });
  await pressEnter();
  assert.equal(await cdp.evaluate('document.querySelector("[data-testid=\\"button-progress-step-3\\"]")?.getAttribute("aria-current")'), 'step');
  await cdp.key('a', 'KeyA', 65, 2);
  await cdp.send('Input.insertText', { text: '0.1' });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), 'focus on campaign duration');

  await pressEnter();
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector("[data-testid=\\"panel-launch-review\\"]"))'), 'the review step');
  await waitFor(() => activeElementId().then(id => id === 'launch-heading'), 'focus on the review heading');
  assert.equal(await cdp.evaluate('document.querySelector("[data-testid=\\"button-progress-step-5\\"]")?.getAttribute("aria-current")'), 'step');
  assert.equal(await cdp.evaluate('location.pathname'), '/launch');
  for (let index = 0; index < 20; index += 1) {
    if (await cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-submit"')) break;
    await cdp.key('Tab', 'Tab', 9);
  }
  assert.equal(await cdp.evaluate('document.activeElement?.dataset.testid'), 'button-launch-submit');
  assert.equal(await cdp.evaluate('document.activeElement.disabled'), false);
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector("[data-testid=\\"link-sign-in\\"]"))'), 'the signed-out account state');
  await pressEnter();
  await waitFor(() => cdp.evaluate('location.pathname === "/sign-in"'), 'keyboard submission to the sign-in page');
  assert.equal(await cdp.evaluate('new URLSearchParams(location.search).get("returnTo")'), '/launch');
  assert.equal(await cdp.evaluate('JSON.parse(sessionStorage.getItem("ggs:launch-draft:v1")).step'), 4);

  // Reload the saved review to exercise its edit and exit controls independently.
  const launchUrl = await cdp.evaluate('location.origin + "/launch"');
  await cdp.send('Page.navigate', { url: launchUrl });
  await waitFor(() => activeElementId().then(id => id === 'launch-heading'), 'focus on the restored review');
  await cdp.key('Tab', 'Tab', 9);
  assert.equal(await cdp.evaluate('document.activeElement?.dataset.testid'), 'button-edit-review-name');
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-name'), 'focus after editing the campaign name from review');
  await cdp.evaluate('window.__escapeConfirmMessages = []; window.confirm = message => { window.__escapeConfirmMessages.push(message); return true; }');
  await cdp.key('Escape', 'Escape', 27);
  await waitFor(() => cdp.evaluate('location.pathname === "/projects"'), 'confirmed exit to the campaign board');
  assert.equal(await cdp.evaluate('window.__escapeConfirmMessages.length'), 1);
});

test('all campaign setup steps fit narrow phone screens and keep focus visible', async () => {
  for (const width of [320, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height: 800, deviceScaleFactor: 1, mobile: true,
    });
    await cdp.evaluate('sessionStorage.removeItem("ggs:launch-draft:v1")');
    const launchUrl = await cdp.evaluate('location.origin + "/launch"');
    await cdp.send('Page.navigate', { url: launchUrl });
    await waitFor(() => activeElementId().then(id => id === 'launch-name'), `the ${width}px launch screen`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-name', `step 1 at ${width}px`);

    await cdp.send('Input.insertText', { text: `Phone launch ${width}` });
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-brief'), `brief focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-brief', `step 2 at ${width}px`);

    await cdp.send('Input.insertText', { text: 'Explain the campaign to creators.' });
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-usd'), `pool focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-usd', `step 3 at ${width}px`);

    for (let index = 0; index < 5; index += 1) {
      await cdp.key('Tab', 'Tab', 9);
    }
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-toggle-direct-celo"'),
      `direct CELO keyboard option at ${width}px`,
    );
    await pressSpace();
    await waitFor(() => cdp.evaluate('Boolean(document.querySelector("#launch-celo"))'), `direct CELO input at ${width}px`);
    await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-celo'), `CELO input focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-celo', `step 3 direct mode at ${width}px`);

    await cdp.send('Input.insertText', { text: '0.1' });
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), `duration focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-cycle', `step 4 at ${width}px`);

    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-heading'), `review focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-heading', `step 5 at ${width}px`);

    for (let index = 0; index < 20; index += 1) {
      if (await cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-submit"')) break;
      await cdp.key('Tab', 'Tab', 9);
    }
    const submitState = await phoneLayoutState();
    assertPhoneLayout(submitState, '', `launch button visibility at ${width}px`);
    assert.equal(await cdp.evaluate('document.activeElement?.dataset.testid'), 'button-launch-submit');
    assertPhoneElementVisible(submitState.focus, submitState, `launch button at ${width}px`);

    await cdp.send('Page.navigate', { url: launchUrl });
    await waitFor(() => activeElementId().then(id => id === 'launch-heading'), `restored review at ${width}px`);
    await cdp.key('Tab', 'Tab', 9);
    assert.equal(await cdp.evaluate('document.activeElement?.dataset.testid'), 'button-edit-review-name');
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-name'), `name edit focus at ${width}px`);
    assertPhoneLayout(await phoneLayoutState(), 'launch-name', `review edit at ${width}px`);
    assert.equal(await cdp.evaluate('location.pathname'), '/launch');
  }

  await cdp.send('Emulation.clearDeviceMetricsOverride');
});

test('tablet split-view keeps all setup steps and review actions reachable without submitting', async () => {
  const viewports = [
    { width: 540, height: 720 },
    { width: 640, height: 800 },
    { width: 720, height: 540 },
  ];
  const reviewEdits = [
    { id: 'button-edit-review-name', fields: ['launch-name', 'launch-brief', 'launch-celo', 'launch-cycle', 'launch-heading'] },
    { id: 'button-edit-review-brief', fields: ['launch-brief', 'launch-celo', 'launch-cycle', 'launch-heading'] },
    { id: 'button-edit-review-pool', fields: ['launch-celo', 'launch-cycle', 'launch-heading'] },
    { id: 'button-edit-platform-fee', fields: ['launch-celo', 'launch-cycle', 'launch-heading'] },
    { id: 'button-edit-creator-pool', fields: ['launch-celo', 'launch-cycle', 'launch-heading'] },
    { id: 'button-edit-review-cycle', fields: ['launch-cycle', 'launch-heading'] },
    { id: 'button-edit-payout-date', fields: ['launch-cycle', 'launch-heading'] },
  ];

  try {
    for (const { width, height } of viewports) {
      const context = `${width}×${height} tablet split view`;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      await cdp.evaluate('sessionStorage.removeItem("ggs:launch-draft:v1")');
      const launchUrl = await cdp.evaluate('location.origin + "/launch"');
      await cdp.send('Page.navigate', { url: launchUrl });
      await waitFor(() => activeElementId().then(id => id === 'launch-name'), `${context} step 1`);
      await cdp.evaluate(`(() => {
        window.__tabletSubmitClicks = 0;
        document.addEventListener('click', event => {
          if (event.target.closest('[data-testid="button-launch-submit"]')) window.__tabletSubmitClicks += 1;
        });
      })()`);
      await assertTabletLayoutReady('launch-name', `${context} step 1 name field`);
      await cdp.send('Input.insertText', { text: `Tablet ${width}` });
      await focusByTab('document.activeElement?.dataset.testid === "button-launch-next"', `${context} step 1 next button`);
      await assertTabletLayoutReady('button-launch-next', `${context} step 1 next button`);
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-brief'), `${context} step 2`);
      await assertTabletLayoutReady('launch-brief', `${context} step 2 brief field`);

      await cdp.send('Input.insertText', { text: 'Split-view campaign brief.' });
      await cdp.key('Tab', 'Tab', 9);
      await waitFor(
        () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-previous"'),
        `${context} previous button`,
      );
      await assertTabletLayoutReady('button-launch-previous', `${context} previous navigation`);
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-name'), `${context} return to step 1`);
      await assertTabletLayoutReady('launch-name', `${context} previous navigation result`);
      await focusByTab('document.activeElement?.dataset.testid === "button-launch-next"', `${context} step 1 next button again`);
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-brief'), `${context} return to step 2`);
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-usd'), `${context} step 3`);
      await assertTabletLayoutReady('launch-usd', `${context} step 3 reward field`);

      await cdp.evaluate('document.querySelector(\'[data-testid="button-toggle-direct-celo"]\').focus()');
      await assertTabletLayoutReady('button-toggle-direct-celo', `${context} direct CELO toggle`);
      await pressSpace();
      await cdp.key('Tab', 'Tab', 9, 8);
      await waitFor(() => activeElementId().then(id => id === 'launch-celo'), `${context} direct CELO field`);
      await assertTabletLayoutReady('launch-celo', `${context} step 3 direct amount`);
      await cdp.send('Input.insertText', { text: '0.1' });
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), `${context} step 4`);
      await assertTabletLayoutReady('launch-cycle', `${context} step 4 timing`);
      await pressEnter();
      await waitFor(() => activeElementId().then(id => id === 'launch-heading'), `${context} review`);
      await assertTabletLayoutReady('launch-heading', `${context} step 5 review`);
      assert.ok(await cdp.evaluate('Boolean(document.querySelector("[data-testid=\\"panel-launch-review\\"]"))'));

      for (const edit of reviewEdits) {
        await focusByTab(
          `document.activeElement?.dataset.testid === "${edit.id}"`,
          `${context} ${edit.id}`,
        );
        await assertTabletLayoutReady(edit.id, `${context} ${edit.id}`);
        await pressEnter();
        await waitFor(() => activeElementId().then(id => id === edit.fields[0]), `${context} ${edit.id} action`);
        await assertTabletLayoutReady(edit.fields[0], `${context} ${edit.id} destination`);
        for (const nextField of edit.fields.slice(1)) {
          await pressEnter();
          await waitFor(() => activeElementId().then(id => id === nextField), `${context} return to review via ${nextField}`);
          await assertTabletLayoutReady(nextField, `${context} review navigation via ${nextField}`);
        }
      }

      assert.equal(await cdp.evaluate('window.__tabletSubmitClicks'), 0, `${context}: campaign must not be submitted`);
      assert.equal(await cdp.evaluate('location.pathname'), '/launch', `${context}: remain in campaign setup`);
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
});

test('keyboard-sized mobile viewport keeps the active field and navigation reachable', async () => {
  const width = 320;
  const openHeight = 460;
  const launchUrl = await cdp.evaluate('location.origin + "/launch"');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: 800, deviceScaleFactor: 1, mobile: true,
  });
  await cdp.evaluate('sessionStorage.removeItem("ggs:launch-draft:v1")');
  await cdp.send('Page.navigate', { url: launchUrl });
  await waitFor(() => activeElementId().then(id => id === 'launch-name'), 'name field before keyboard resize');
  await cdp.send('Input.insertText', { text: 'Keyboard resize check' });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-brief'), 'brief field before keyboard resize');
  await cdp.send('Input.insertText', { text: 'Keep the campaign controls reachable while typing.' });
  await cdp.evaluate(`(() => {
    window.__phoneResizeEvents = [];
    window.addEventListener('resize', () => window.__phoneResizeEvents.push('window'));
    window.visualViewport?.addEventListener('resize', () => window.__phoneResizeEvents.push('visual'));
  })()`);

  // A reduced mobile viewport emulates the screen space consumed by the on-screen keyboard.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: openHeight, deviceScaleFactor: 1, mobile: true,
  });
  await waitFor(() => cdp.evaluate(`window.innerHeight <= ${openHeight}`), 'the keyboard-sized viewport');
  // DevTools changes dimensions without emitting the resize events produced by a phone keyboard.
  await cdp.evaluate(`(() => {
    window.dispatchEvent(new Event('resize'));
    window.visualViewport?.dispatchEvent(new Event('resize'));
  })()`);
  await waitFor(
    () => cdp.evaluate('window.__phoneResizeEvents.includes("window") && window.__phoneResizeEvents.includes("visual")'),
    'mobile viewport resize events',
  );
  await waitFor(
    () => cdp.evaluate('document.activeElement.getBoundingClientRect().bottom <= window.innerHeight'),
    'the focused field to move above the keyboard',
  );
  const keyboardOpenState = await phoneLayoutState();
  assert.equal(await activeElementId(), 'launch-brief');
  assertPhoneLayout(keyboardOpenState, 'launch-brief', 'keyboard open while editing the brief');
  assert.ok(keyboardOpenState.focus.bottom <= keyboardOpenState.controls.top, 'the sticky navigation must not cover the focused brief');
  assert.equal(
    await cdp.evaluate('document.querySelector("#launch-brief").value'),
    'Keep the campaign controls reachable while typing.',
  );

  await cdp.key('Tab', 'Tab', 9);
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-previous"'),
    'the previous button with the keyboard open',
  );
  const previousState = await phoneLayoutState();
  assertPhoneElementVisible(previousState.focus, previousState, 'previous button with the keyboard open');

  await cdp.key('Tab', 'Tab', 9);
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-next"'),
    'the next button with the keyboard open',
  );
  const nextState = await phoneLayoutState();
  assertPhoneElementVisible(nextState.focus, nextState, 'next button with the keyboard open');

  await cdp.key('Tab', 'Tab', 9, 8);
  await cdp.key('Tab', 'Tab', 9, 8);
  await waitFor(() => activeElementId().then(id => id === 'launch-brief'), 'brief field after returning from navigation');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: 800, deviceScaleFactor: 1, mobile: true,
  });
  await waitFor(() => cdp.evaluate('window.innerHeight >= 800'), 'the keyboard-closed viewport');
  await cdp.evaluate(`(() => {
    window.dispatchEvent(new Event('resize'));
    window.visualViewport?.dispatchEvent(new Event('resize'));
  })()`);
  assertPhoneLayout(await phoneLayoutState(), 'launch-brief', 'keyboard closed while editing the brief');
  assert.equal(await cdp.evaluate('location.pathname'), '/launch');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});

test('all campaign setup steps remain usable with enlarged text on a narrow phone', async () => {
  const width = 320;
  const longName = 'N'.repeat(80);
  const longBrief = 'B'.repeat(400);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: 800, deviceScaleFactor: 1, mobile: true,
  });
  const { identifier: textScaleScript } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'document.documentElement.style.fontSize = "200%"',
  });
  const launchUrl = await cdp.evaluate('location.origin + "/launch"');
  await cdp.evaluate('sessionStorage.removeItem("ggs:launch-draft:v1")');
  await cdp.send('Page.navigate', { url: launchUrl });
  await waitFor(() => activeElementId().then(id => id === 'launch-name'), 'name field before text enlargement');
  assertPhoneLayout(await phoneLayoutState(), 'launch-name', 'step 1 at 200% text');

  await cdp.send('Input.insertText', { text: longName });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-brief'), 'brief field at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-brief', 'step 2 at 200% text');

  await cdp.send('Input.insertText', { text: longBrief });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-usd'), 'pool field at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-usd', 'step 3 at 200% text');
  for (let index = 0; index < 5; index += 1) await cdp.key('Tab', 'Tab', 9);
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-toggle-direct-celo"'),
    'direct CELO option at 200% text',
  );
  await pressSpace();
  await waitFor(() => cdp.evaluate('Boolean(document.querySelector("#launch-celo"))'), 'direct CELO field at 200% text');
  await cdp.key('Tab', 'Tab', 9, 8);
  await waitFor(() => activeElementId().then(id => id === 'launch-celo'), 'direct CELO focus at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-celo', 'step 3 direct mode at 200% text');

  await cdp.send('Input.insertText', { text: '0.1' });
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), 'duration at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-cycle', 'step 4 at 200% text');
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-heading'), 'review at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-heading', 'step 5 at 200% text');

  const reviewValues = JSON.parse(await cdp.evaluate(`JSON.stringify({
    name: document.querySelector('[data-testid="button-edit-review-name"]').closest('.launch-review-row').querySelector('strong')?.textContent,
    brief: document.querySelector('[data-testid="button-edit-review-brief"]').closest('.launch-review-row').querySelector('strong')?.textContent,
  })`));
  assert.equal(reviewValues.name.length, 80);
  assert.equal(reviewValues.brief.length, 400);

  const reviewEditButtons = [
    'button-edit-review-name',
    'button-edit-review-brief',
    'button-edit-review-pool',
    'button-edit-platform-fee',
    'button-edit-creator-pool',
    'button-edit-review-cycle',
    'button-edit-payout-date',
  ];
  for (const testId of reviewEditButtons) {
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate(`document.activeElement?.dataset.testid === ${JSON.stringify(testId)}`),
      `${testId} keyboard focus at 200% text`,
    );
    await waitFor(
      () => cdp.evaluate(`(() => {
        const focused = document.activeElement.getBoundingClientRect();
        const controls = document.querySelector('.launch-controls').getBoundingClientRect();
        return focused.top >= 0 && focused.bottom <= window.innerHeight
          && (focused.bottom <= controls.top || focused.top >= controls.bottom);
      })()`),
      `${testId} to scroll clear of the sticky navigation`,
      5_000,
    );
    assertReviewEditIsReachable(await phoneLayoutState(), `${testId} at 200% text`);
  }
  await cdp.key('Tab', 'Tab', 9);
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-previous"'),
    'previous button after review edits at 200% text',
  );
  const previousButtonState = await phoneLayoutState();
  assertPhoneElementVisible(previousButtonState.focus, previousButtonState, 'previous button at 200% text');
  await cdp.key('Tab', 'Tab', 9);
  await waitFor(
    () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-submit"'),
    'launch button after review edits at 200% text',
  );
  const submitState = await phoneLayoutState();
  assertPhoneElementVisible(submitState.focus, submitState, 'launch button at 200% text');
  assertPhoneLayout(submitState, '', 'review navigation at 200% text');

  await cdp.send('Page.navigate', { url: launchUrl });
  await waitFor(() => activeElementId().then(id => id === 'launch-heading'), 'restored review at 200% text');
  await cdp.key('Tab', 'Tab', 9);
  assert.equal(await cdp.evaluate('document.activeElement?.dataset.testid'), 'button-edit-review-name');
  await pressEnter();
  await waitFor(() => activeElementId().then(id => id === 'launch-name'), 'name edit at 200% text');
  assertPhoneLayout(await phoneLayoutState(), 'launch-name', 'editing from review at 200% text');
  assert.equal(await cdp.evaluate('location.pathname'), '/launch');
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: textScaleScript });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});

test('all campaign setup steps keep navigation visible in phone landscape', async () => {
  for (const { width, height } of [{ width: 667, height: 375 }, { width: 568, height: 320 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: true,
    });
    await cdp.evaluate('sessionStorage.removeItem("ggs:launch-draft:v1")');
    const launchUrl = await cdp.evaluate('location.origin + "/launch"');
    await cdp.send('Page.navigate', { url: launchUrl });
    await waitFor(() => activeElementId().then(id => id === 'launch-name'), `name field at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-name', `step 1 at ${width}x${height}`);

    await cdp.send('Input.insertText', { text: `Landscape ${width}` });
    await focusByTab('document.activeElement?.classList.contains("launch-back-link")', 'campaign board link');
    await assertPhoneLayoutAfterFocus('', `step 1 previous control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-next"'),
      `step 1 next control at ${width}x${height}`,
    );
    await assertPhoneLayoutAfterFocus('', `step 1 next control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9, 8);
    await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-name'), `name field restored at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-name', `step 1 restored at ${width}x${height}`);
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-brief'), `brief field at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-brief', `step 2 at ${width}x${height}`);

    await cdp.send('Input.insertText', { text: 'A campaign brief for creators.' });
    await focusByTab('document.activeElement?.dataset.testid === "button-launch-previous"', 'step 2 previous control');
    await assertPhoneLayoutAfterFocus('', `step 2 previous control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-next"'),
      `step 2 next control at ${width}x${height}`,
    );
    await assertPhoneLayoutAfterFocus('', `step 2 next control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9, 8);
    await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-brief'), `brief field restored at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-brief', `step 2 restored at ${width}x${height}`);
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-usd'), `pool field at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-usd', `step 3 at ${width}x${height}`);

    for (let index = 0; index < 5; index += 1) await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-toggle-direct-celo"'),
      `direct CELO option at ${width}x${height}`,
    );
    await pressSpace();
    await waitFor(() => cdp.evaluate('Boolean(document.querySelector("#launch-celo"))'), `direct CELO field at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-celo'), `CELO field focus at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-celo', `step 3 direct mode at ${width}x${height}`);
    await cdp.send('Input.insertText', { text: '0.1' });
    await cdp.key('Tab', 'Tab', 9);
    await focusByTab('document.activeElement?.dataset.testid === "button-launch-previous"', 'step 3 previous control');
    await assertPhoneLayoutAfterFocus('', `step 3 previous control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-next"'),
      `step 3 next control at ${width}x${height}`,
    );
    await assertPhoneLayoutAfterFocus('', `step 3 next control at ${width}x${height}`);
    for (let index = 0; index < 3; index += 1) await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-celo'), `CELO field restored at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-celo', `step 3 restored at ${width}x${height}`);
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), `duration field at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-cycle', `step 4 at ${width}x${height}`);

    await focusByTab('document.activeElement?.dataset.testid === "button-launch-previous"', 'step 4 previous control');
    await assertPhoneLayoutAfterFocus('', `step 4 previous control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-next"'),
      `step 4 next control at ${width}x${height}`,
    );
    await assertPhoneLayoutAfterFocus('', `step 4 next control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9, 8);
    await cdp.key('Tab', 'Tab', 9, 8);
    await waitFor(() => activeElementId().then(id => id === 'launch-cycle'), `duration field restored at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-cycle', `step 4 restored at ${width}x${height}`);
    await pressEnter();
    await waitFor(() => activeElementId().then(id => id === 'launch-heading'), `review at ${width}x${height}`);
    await assertPhoneLayoutAfterFocus('launch-heading', `step 5 at ${width}x${height}`);

    await focusByTab('document.activeElement?.dataset.testid === "button-launch-previous"', 'step 5 previous control');
    await assertPhoneLayoutAfterFocus('', `step 5 previous control at ${width}x${height}`);
    await cdp.key('Tab', 'Tab', 9);
    await waitFor(
      () => cdp.evaluate('document.activeElement?.dataset.testid === "button-launch-submit"'),
      `step 5 launch control at ${width}x${height}`,
    );
    await assertPhoneLayoutAfterFocus('', `step 5 launch control at ${width}x${height}`);
    assert.equal(await cdp.evaluate('location.pathname'), '/launch');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});
