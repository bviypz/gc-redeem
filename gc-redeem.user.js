// ==UserScript==
// @name         Gift Card Redeemer (giftcards.com)
// @namespace    gc-redeemer
// @version      1.4.8
// @description  Redeem ALL giftcards.com "Redeem now" links from your Gmail and auto-fill the Visa registration form. You solve the CAPTCHA manually, then collect card numbers into a TSV download.
// @match        *://mail.google.com/*
// @match        *://*.giftcards.com/*
// @match        *://*.activationspot.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://github.com/bviypz/gc-redeem/releases/latest/download/gc-redeem.meta.js
// @downloadURL  https://github.com/bviypz/gc-redeem/releases/latest/download/gc-redeem.user.js
// ==/UserScript==

/*
 * HOW TO USE (share this with whoever installs it):
 *  1. Install Tampermonkey, then open this file's URL (or paste its contents
 *     into a new userscript) to install it.
 *  2. Tampermonkey menu -> "GC: Settings" and fill in the form once. It has
 *     two sections: Profile (your personal info) and Options (delay between
 *     opening links, debug mode). Nothing is prefilled.
 *  3. Open the Gmail message that contains the "Redeem now" links.
 *  4. Tampermonkey menu -> "GC: Redeem all gift cards". It opens every link
 *     (spaced by your delay setting), fills the email + claim steps, and fills
 *     the registration form on each card page, then stops so YOU solve the
 *     reCAPTCHA and submit manually.
 *  5. After the VisaVirtualAccount pages load, each card number is saved
 *     automatically (with its order number and redeem time). Tampermonkey
 *     menu -> "GC: View collected cards" to review them, or "GC: Download
 *     card data (TSV)" to export (columns: order_number, card_number,
 *     valid_thru, cvv, redeemed_at, collected_at, status).
 *     Re-running a card keeps its original redeemed_at, refreshes
 *     collected_at, and marks status=recollected (vs first_redeem).
 *
 * Already-redeemed cards are handled: if claiming lands straight on the card
 * detail page (no registration form), the card is scraped directly.
 *
 * No tab is ever closed automatically. Tampermonkey menu ->
 * "GC: Close all gift card tabs" closes every giftcards.com /
 * activationspot.com tab at once (with confirmation); the Gmail tab stays.
 * NOTE: after updating the script, reload any already-open tabs — they keep
 * running the old version (including its old menu items) until reloaded.
 *
 * The script never sends your data anywhere. Everything stays in your
 * browser (Tampermonkey storage); the only output is the TSV you download.
 *
 * LOGGING: a green status box appears at the bottom-left of each page with
 * concise progress info. Turn on "Debug mode" in GC: Settings for verbose
 * diagnostics there. Everything is also in the DevTools console: press F12
 * (or Ctrl+Shift+J / Cmd+Option+J), open the Console tab, look for [GC].
 */

(function () {
  'use strict';

  const PROFILE_KEY = 'gc_profile';
  const CARD_PREFIX = 'gc_card_';

  // Debug mode lives in the Settings panel (no code edit needed).
  // When on: extra-verbose logging to the on-page log box, and tabs are
  // never auto-closed. The console always gets everything regardless.
  function isDebug() {
    try { return GM_getValue(PROFILE_KEY, {}).debugMode === true; }
    catch (e) { return false; }
  }

  let __logBox = null;
  function __box() {
    try {
      if (!__logBox) {
        __logBox = document.createElement('div');
        __logBox.style.cssText =
          'position:fixed;left:12px;bottom:12px;z-index:2147483647;width:440px;max-height:240px;' +
          'overflow-y:auto;background:rgba(10,10,10,.88);color:#7CFC00;font:11px/1.5 monospace;' +
          'padding:10px 12px;border-radius:8px;white-space:pre-wrap;box-shadow:0 4px 16px rgba(0,0,0,.4);';
        (document.body || document.documentElement).appendChild(__logBox);
      }
      return __logBox;
    } catch (e) { return null; }
  }
  function __fmt(args) {
    return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  }
  // Concise status: always shown (console + on-page green box). Keep these
  // short — no long URLs here.
  function log(...args) {
    const msg = __fmt(args);
    console.log('[GC]', msg);
    const b = __box();
    if (b) { b.textContent += msg + '\n'; b.scrollTop = b.scrollHeight; }
  }
  // Verbose diagnostics: console always, on-page box only when debug mode is on.
  function debug(...args) {
    const msg = __fmt(args);
    console.log('[GC:DBG]', msg);
    if (!isDebug()) return;
    const b = __box();
    if (b) { b.textContent += msg + '\n'; b.scrollTop = b.scrollHeight; }
  }

  // --- popup-blocker-proof claim handling ---
  // The "Claim your gift" button opens the registration page via window.open,
  // which the popup blocker kills for script-dispatched clicks. We hook
  // window.open (in page context) to capture the URL; if the browser blocked
  // it, we open it ourselves with GM_openInTab, which bypasses the blocker.
  let capturedClaim = null; // {url, blocked}
  function installOpenHook() {
    try {
      const s = document.createElement('script');
      s.textContent =
        '(function(){' +
        'if(window.__gcHooked)return;window.__gcHooked=true;' +
        'var orig=window.open;' +
        'window.open=function(u,t,f){' +
        'var w=null;try{w=orig.apply(this,arguments);}catch(e){}' +
        'try{document.dispatchEvent(new CustomEvent("gc-open",{detail:JSON.stringify({url:String(u),blocked:!w})}));}catch(e){}' +
        'return w;};' +
        'try{document.documentElement.setAttribute("data-gc-hooked","1");}catch(e){}' +
        '})();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      const ok = document.documentElement.getAttribute('data-gc-hooked') === '1';
      debug('window.open hook installed:', ok ? 'yes' : 'NO (page CSP may block inline scripts)');
      return ok;
    } catch (e) {
      debug('window.open hook install threw:', e.message);
      return false;
    }
  }
  document.addEventListener('gc-open', (e) => {
    try { capturedClaim = JSON.parse(e.detail); }
    catch (err) { capturedClaim = { url: String(e.detail), blocked: true }; }
    debug('intercepted window.open ->', capturedClaim.url, '| blocked by browser:', capturedClaim.blocked);
  });

  /* ---------------- tiny helpers ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(msg, ms = 5000) {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;' +
      'background:#1a1a1a;color:#fff;padding:12px 16px;border-radius:8px;' +
      'font:14px/1.4 system-ui,sans-serif;max-width:360px;box-shadow:0 4px 16px rgba(0,0,0,.35);';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }

  function waitFor(sel, timeout = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        const el = document.querySelector(sel);
        if (el) { clearInterval(t); resolve(el); }
        else if (Date.now() - start > timeout) { clearInterval(t); resolve(null); }
      }, 250);
    });
  }

  function xpathFirst(xp) {
    return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

  function waitForXPath(xp, timeout = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        const el = xpathFirst(xp);
        if (el) { clearInterval(t); resolve(el); }
        else if (Date.now() - start > timeout) { clearInterval(t); resolve(null); }
      }, 250);
    });
  }

  // Find a VISIBLE, ENABLED clickable (button/link) by its rendered text,
  // case-insensitive. Tolerant of nested markup (<span> inside <button>),
  // &nbsp;, and casing differences that defeat normalize-space(text()) XPath.
  // Exact-text matches win for the first half of the timeout, then we relax
  // to substring matching.
  function findClickableByText(text, timeout = 25000) {
    const needle = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const norm = (el) => ((el.innerText || el.value || '').replace(/\s+/g, ' ').trim().toLowerCase());
    return new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        const els = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')];
        const usable = els.filter((el) => {
          if (el.disabled) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const elapsed = Date.now() - start;
        let hit = usable.find((el) => norm(el) === needle);
        if (!hit && elapsed > timeout / 2) hit = usable.find((el) => norm(el).includes(needle));
        if (hit) { clearInterval(t); resolve(hit); return; }
        if (elapsed > timeout) { clearInterval(t); resolve(null); }
      }, 300);
    });
  }

  // Wait for the first of several selectors to appear; resolves {sel, el} or null.
  function waitForAny(selectors, timeout = 20000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const t = setInterval(() => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { clearInterval(t); resolve({ sel, el }); return; }
        }
        if (Date.now() - start > timeout) { clearInterval(t); resolve(null); }
      }, 250);
    });
  }

  // Set an input's value the way React-controlled inputs expect: use the
  // native value setter so the framework actually notices the change.
  // (Plain el.value = ... often leaves React thinking the field is empty,
  // which is what causes "Please enter valid email".)
  function setInputValue(el, val) {
    el.focus();
    try {
      const proto = el instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    } catch (e) {
      el.value = val; // fallback
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  /* ---------------- personal-info panel ---------------- */

  // [key, label, type, default] — type is 'text' or 'check'
  const PROFILE_FIELDS = [
    ['email', 'Email', 'text', ''],
    ['firstName', 'First name', 'text', ''],
    ['lastName', 'Last name', 'text', ''],
    ['addressLine1', 'Address line 1', 'text', ''],
    ['city', 'City', 'text', ''],
    ['state', 'State', 'text', ''],
    ['postalCode', 'ZIP / Postal code', 'text', ''],
    ['phoneNumber', 'Phone number', 'text', ''],
  ];
  const SETTING_FIELDS = [
    ['openInterval', 'Delay between opening links (seconds)', 'text', '5'],
    ['debugMode', 'Debug mode (verbose logs)', 'check', false],
  ];
  const ALL_FIELDS = [...PROFILE_FIELDS, ...SETTING_FIELDS];

  // Accept any state format in the profile ("WA", "wa", "Washington", …)
  // and normalize to the 2-letter code the dropdown shows.
  const STATE_ABBR = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
    indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  };
  const STATE_CODES = new Set(Object.values(STATE_ABBR));
  function normalizeState(input) {
    const s = (input || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower.length === 2 && STATE_CODES.has(lower.toUpperCase())) return lower.toUpperCase();
    if (STATE_ABBR[lower]) return STATE_ABBR[lower];
    return s.toUpperCase(); // unknown format: pass through, matching tries value/text
  }

  // --- order-number tracking ---
  // Gmail shows "<p>Order Number: 9768-XXXXXXXX-5460</p>" right before each
  // "Redeem now" button. We map lineItemId -> order number in storage so
  // downstream tabs (which only know URLs) can resolve it.
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  function lineItemIdFromUrl(url) {
    const m = (url || '').match(/lineItemId(?:=|%3D)([^&%#]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }
  // Candidate storage keys for an order number, derived from a tab's own URL.
  function orderKeysForUrl(url) {
    const keys = ['gc_reg_' + djb2(url || '')];
    try {
      const u = new URL(url);
      for (const p of ['id', 'token', 'lineItemId', 'lid', 'cardId']) {
        const v = u.searchParams.get(p);
        if (v) keys.push('gc_regid_' + v);
      }
    } catch (e) {}
    return keys;
  }
  // Walk up from the "Redeem now" anchor looking for a preceding
  // "Order Number: ..." element.
  function findOrderNumber(anchor) {
    let el = anchor;
    for (let depth = 0; depth < 15 && el; depth++) {
      let sib = el.previousElementSibling;
      while (sib) {
        const m = (sib.textContent || '').match(/Order\s*Number\s*:\s*([\d-]+)/i);
        if (m) return m[1].trim();
        sib = sib.previousElementSibling;
      }
      el = el.parentElement;
    }
    return '';
  }
  function fallbackProfilePrompt() {
    const saved = GM_getValue(PROFILE_KEY, {});
    const data = {};
    for (const [k, label, type, def] of ALL_FIELDS) {
      if (type === 'check') {
        const v = prompt('Settings — ' + label + ' (yes/no):', saved[k] ? 'yes' : 'no');
        if (v === null) { toast('Cancelled; nothing was saved.'); return; }
        data[k] = /^(y|yes|true|1)/i.test(v.trim());
      } else {
        const v = prompt('Gift card info — ' + label + ':', saved[k] || def || '');
        if (v === null) { toast('Cancelled; nothing was saved.'); return; }
        data[k] = v.trim();
      }
    }
    GM_setValue(PROFILE_KEY, data);
    toast('Settings saved.');
  }

  function mkEl(tag, text, css) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }

  async function openProfilePanel() {
    const step = (m) => console.log('[GC] panel:', m);
    try {
      step('waiting for body');
      for (let i = 0; i < 40 && !document.body; i++) await sleep(100);
      if (!document.body) throw new Error('document.body not available');
      step('body ready');
      if (document.getElementById('gc-profile-panel')) return;
      const saved = GM_getValue(PROFILE_KEY, {});
      step('storage read ok');

      const panel = mkEl('div', null,
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;' +
        'background:#fff;color:#111;border-radius:12px;padding:24px;width:340px;' +
        'box-shadow:0 8px 40px rgba(0,0,0,.4);font:14px system-ui,sans-serif;');
      panel.id = 'gc-profile-panel';
      panel.appendChild(mkEl('h3', 'Profile & Settings', 'margin:0 0 4px;font-size:16px;'));

      const inputs = {};
      const buildSection = (title, fields, first) => {
        panel.appendChild(mkEl('h4', title,
          'margin:' + (first ? '8px' : '16px') + ' 0 8px;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px;'));
        for (const [k, label, type, def] of fields) {
          if (type === 'check') {
            const lab = mkEl('label', null, 'display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;');
            // Explicit native-checkbox styling: host pages (Gmail etc.) often
            // restyle or hide bare checkboxes via their own stylesheets.
            const inp = mkEl('input', null,
              'appearance:auto;-webkit-appearance:checkbox;width:16px;height:16px;' +
              'margin:0;padding:0;flex:none;accent-color:#1a73e8;cursor:pointer;display:inline-block;');
            inp.type = 'checkbox';
            inp.checked = saved[k] === true;
            inputs[k] = inp;
            lab.appendChild(inp);
            lab.appendChild(document.createTextNode(label));
            panel.appendChild(lab);
          } else {
            const lab = mkEl('label', null, 'display:block;margin-bottom:8px;');
            lab.appendChild(document.createTextNode(label));
            lab.appendChild(mkEl('br'));
            const inp = mkEl('input', null,
              'width:100%;box-sizing:border-box;padding:6px 8px;margin-top:2px;' +
              'border:1px solid #ccc;border-radius:6px;color:#111;background:#fff;');
            inp.value = saved[k] || def || '';
            inputs[k] = inp;
            lab.appendChild(inp);
            panel.appendChild(lab);
          }
        }
      };
      buildSection('Profile', PROFILE_FIELDS, true);
      buildSection('Options', SETTING_FIELDS, false);
      step('fields built');

      const row = mkEl('div', null, 'margin-top:12px;display:flex;justify-content:flex-end;gap:8px;');
      const cancel = mkEl('button', 'Cancel',
        'padding:8px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:6px;cursor:pointer;');
      const save = mkEl('button', 'Save',
        'padding:8px 14px;border:0;background:#1a73e8;color:#fff;border-radius:6px;cursor:pointer;');
      cancel.onclick = () => panel.remove();
      save.onclick = () => {
        try {
          const data = {};
          for (const [k, , type] of ALL_FIELDS) {
            data[k] = type === 'check' ? !!inputs[k].checked : inputs[k].value.trim();
          }
          GM_setValue(PROFILE_KEY, data);
        } catch (e2) {
          toast('Save failed: ' + (e2 && e2.message));
          return;
        }
        panel.remove();
        toast('Settings saved.');
      };
      row.appendChild(cancel);
      row.appendChild(save);
      panel.appendChild(row);
      panel.appendChild(mkEl('p', 'Stored only in Tampermonkey on this browser. Never sent anywhere.',
        'font-size:12px;color:#666;margin:10px 0 0;'));

      document.body.appendChild(panel);
      step('panel appended and visible');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.error('[GC] profile panel failed:', e);
      if (confirm('Settings form failed (' + msg + ').\n\nUse simple one-by-one prompts instead?')) {
        fallbackProfilePrompt();
      }
    }
  }

  /* ---------------- Gmail: expand hidden content ---------------- */

  async function expandGmail() {
    // "Expand all" is usually an icon button with aria-label (no visible text).
    const expandAll =
      document.querySelector('[aria-label="Expand all"]') ||
      [...document.querySelectorAll('button, div[role="button"]')]
        .find((b) => (b.textContent || '').trim() === 'Expand all');
    if (expandAll) {
      debug('clicking "Expand all"');
      try { expandAll.scrollIntoView({ block: 'center' }); } catch (e) {}
      await sleep(300);
      expandAll.click();
      await sleep(800);
    } else {
      debug('no "Expand all" button found (fine if already expanded)');
    }

    // Per-message "Show trimmed content" ("...") buttons; expanding one can
    // reveal more, so repeat until none are left (max 5 rounds).
    for (let round = 0; round < 5; round++) {
      const btns = [...document.querySelectorAll('[aria-label="Show trimmed content"]')]
        .filter((b) => b.offsetParent !== null);
      if (!btns.length) { debug('no trimmed sections left'); break; }
      debug(`expanding ${btns.length} trimmed section(s), round ${round + 1}`);
      for (const b of btns) { b.click(); await sleep(200); }
      await sleep(500);
    }
    await sleep(500);
  }

  /* ---------------- Gmail: open every redeem link ---------------- */

  async function startRedeem() {
    if (!location.hostname.includes('mail.google.com')) {
      toast('Open your Gmail message with the redeem links first, then run this again.');
      return;
    }
    const profile = GM_getValue(PROFILE_KEY, null);
    if (!profile || !profile.email) {
      toast('Open GC: Settings from the Tampermonkey menu first.');
      openProfilePanel();
      return;
    }

    // Expand trimmed/hidden email content so all links are in the DOM.
    await expandGmail();

    const links = [...document.querySelectorAll('a')]
      .filter((a) => a.textContent.trim() === 'Redeem now' && a.href.includes('giftcards.com'));
    // Dedupe by href, keeping the order number found near each button.
    const items = [];
    const seen = new Set();
    for (const a of links) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      items.push({ href: a.href, order: findOrderNumber(a) });
    }
    log('found', items.length, '"Redeem now" link(s)');
    if (!items.length) { toast('No "Redeem now" links found on this page.'); return; }
    const withOrder = items.filter((i) => i.order).length;
    debug(`${withOrder}/${items.length} link(s) have an order number`);

    const iv = parseFloat(profile.openInterval);
    const delaySec = isFinite(iv) && iv > 0 ? iv : 5;
    log(`opening ${items.length} link(s), one every ${delaySec}s`);
    toast(`Opening ${items.length} gift card link(s)…`);
    for (const { href, order } of items) {
      const lid = lineItemIdFromUrl(href);
      if (lid && order) {
        try { GM_setValue('gc_order_' + lid, order); } catch (e) {}
        debug('mapped', lid, '-> order', order);
      } else if (order && !lid) {
        debug('order found but no lineItemId in href, cannot map:', href.slice(0, 120));
      }
      GM_openInTab(href, { active: false, insert: true });
      await sleep(delaySec * 1000);
    }
  }

  /* ---------------- giftcards.com: email -> verify -> claim ---------------- */

  async function handleGiftcards() {
    debug('--- giftcards.com handler start:', location.href);
    installOpenHook();

    // An already-redeemed card can land straight on the card detail page —
    // proceed with whichever page type renders first.
    const first = await waitForAny(['span#cardNumber2', 'input[placeholder="E-mail"]'], 20000);
    if (first && first.sel === 'span#cardNumber2') {
      log('already redeemed — card detail page detected');
      return handleCardPage();
    }

    const profile = GM_getValue(PROFILE_KEY, null);
    if (!profile || !profile.email) {
      log('ERROR: no profile set');
      toast('Open "GC: Settings" from the Tampermonkey menu first.', 8000);
      return;
    }

    // Resolve this tab's order number via the lineItemId in our URL.
    let lid = '';
    let orderNumber = '';
    try {
      lid = lineItemIdFromUrl(location.href);
      if (lid) orderNumber = GM_getValue('gc_order_' + lid, '');
    } catch (e) {}
    debug('lineItemId in page URL:', lid || '(none)', '| mapped order:', orderNumber || '(none)');

    // The email step is skipped when the page doesn't show it (already verified).
    // Re-query: the node captured by the initial race may be stale after a re-render.
    const emailInput = first && first.sel === 'input[placeholder="E-mail"]'
      ? (document.querySelector('input[placeholder="E-mail"]') || first.el)
      : null;
    if (emailInput) {
      debug('email input found');
      await sleep(1500);
      if (!emailInput.value) { setInputValue(emailInput, profile.email); debug('email filled'); }
      else debug('email already filled');
      await sleep(800);

      const verifyBtn = await findClickableByText('Verify', 10000);
      if (!verifyBtn) { log('ERROR: "Verify" button not found'); toast('"Verify" button not found.'); return; }
      log('clicking Verify');
      verifyBtn.click();
    } else {
      debug('no email field (already verified or skipped); trying claim button directly');
    }

    log('looking for "Claim your gift" button…');
    const claimBtn = await findClickableByText('Claim your gift', 25000);
    if (!claimBtn) { log('ERROR: "Claim your gift" button not found after 25s'); toast('"Claim your gift" button not found.'); return; }
    log('claim button found, clicking it now');
    await sleep(1000);
    try { claimBtn.scrollIntoView({ block: 'center' }); } catch (e) {}
    const beforeUrl = location.href;
    claimBtn.click();

    // Wait for the outcome: intercepted window.open, or same-tab navigation.
    let outcome = null; // 'opened-native' | 'opened-by-us' | 'navigated'
    for (let i = 0; i < 40; i++) {
      if (capturedClaim) {
        // Stash the order number under keys derived from the registration URL
        // so the new tab can resolve it (via referrer or its own URL).
        if (orderNumber) {
          for (const k of orderKeysForUrl(capturedClaim.url)) {
            try { GM_setValue(k, orderNumber); } catch (e) {}
          }
          debug('stored order under URL-derived keys');
        }
        if (capturedClaim.blocked && capturedClaim.url) {
          log('popup was blocked by the browser; opening registration URL ourselves');
          let url = capturedClaim.url;
          if (orderNumber) {
            // Tag the order onto the URL so the new tab can read it directly,
            // even if the page redirects on load (defeats URL-hash lookup).
            try {
              const u = new URL(url);
              u.searchParams.set('gc_order', orderNumber);
              url = u.toString();
            } catch (e) {}
          }
          GM_openInTab(url, { active: false, insert: true });
          outcome = 'opened-by-us';
        } else {
          log('site opened the registration tab natively');
          outcome = 'opened-native';
        }
        break;
      }
      if (location.href !== beforeUrl) { outcome = 'navigated'; break; }
      await sleep(200);
    }

    if (outcome === 'navigated') {
      debug('page navigated in this tab to:', location.href);
      await routeCardOrForm(); // card detail (already redeemed) or registration
      return;
    }
    if (!outcome) {
      log('WARNING: claim click produced no new tab; leaving tab open');
      toast('Claim click did nothing visible — tab left open for inspection.', 8000);
      return; // never close on failure
    }
    debug('claim outcome:', outcome);
    log('done — tab left open (tabs are never auto-closed)');
  }

  /* ---------------- activationspot.com: registration form ---------------- */

  async function handleRegistration() {
    debug('registration form handler start');
    const profile = GM_getValue(PROFILE_KEY, null);
    if (!profile) {
      toast('Open "GC: Settings" from the Tampermonkey menu first.', 8000);
      return;
    }
    // Remember the order number for the card page (sessionStorage is per-tab,
    // so no cross-tab race even with many cards in flight).
    const { order: regOrder, src: regSrc } = resolveRegOrder();
    if (regOrder) {
      try { sessionStorage.setItem('gc_order', regOrder); } catch (e) {}
      debug('order for this registration:', regOrder, '(via ' + regSrc + ')');
    } else {
      debug('no order resolved for this registration tab');
    }
    const set = async (sel, val) => {
      const el = await waitFor(sel, 15000);
      if (el && val) setInputValue(el, val);
    };
    await set('input#emailAddress', profile.email);
    await set('input#confirmEmailAddress', profile.email);
    await set('input#firstName', profile.firstName);
    await set('input#lastName', profile.lastName);
    await set('input#addressLine1', profile.addressLine1);
    await set('input#city', profile.city);

    const stateSel = await waitFor('select#stateOrProvince', 15000);
    if (stateSel) {
      // Options carry value="Full Name" but show 2-letter text ("WA");
      // normalizeState() converts whatever the user typed to the code.
      const want = normalizeState(profile.state || '').toLowerCase();
      const opt = [...stateSel.options].find((o) =>
        o.value.trim().toLowerCase() === want || o.text.trim().toLowerCase() === want
      );
      if (opt) {
        stateSel.value = opt.value;
        stateSel.dispatchEvent(new Event('change', { bubbles: true }));
        debug('state selected:', opt.value, '/', opt.text);
      } else {
        log('WARNING: state "' + profile.state + '" not found in dropdown; leaving as-is');
      }
    }

    await set('input#postalCode', profile.postalCode);
    await set('input#phoneNumber', profile.phoneNumber);

    const box = await waitFor('span.checkbox', 15000);
    if (box) {
      box.scrollIntoView({ block: 'center' });
      await sleep(1500);
      box.click();
      await sleep(1000);
    }
    toast('Form filled. Solve the CAPTCHA and submit manually — the card page will be saved automatically.', 9000);
    log('registration form filled; waiting for manual CAPTCHA + submit');
  }

  /* ---------------- VisaVirtualAccount page: scrape + save ---------------- */

  function countCards() {
    return GM_listValues().filter((k) => k.startsWith(CARD_PREFIX)).length;
  }

  async function handleCardPage() {
    debug('issued-card page detected, waiting for card values…');
    const numEl = await waitFor('span#cardNumber2', 25000);
    if (!numEl) { log('ERROR: span#cardNumber2 never appeared'); return; }
    await sleep(1500); // let the values render
    const cardNumber = numEl.innerText.trim();
    const cvv = (document.querySelector('span#cvv2') || { innerText: '' }).innerText.trim();
    const valid = (document.querySelector('div.alignDiv') || { innerText: '' }).innerText.trim();
    if (!cardNumber) return;
    const { order: foundOrder, src } = resolveCardOrder();
    if (foundOrder) debug('order resolved via ' + src + ':', foundOrder);
    else debug('no order number resolved for this card');
    const now = new Date().toISOString();
    const key = CARD_PREFIX + cardNumber.replace(/\s+/g, '');
    const existing = GM_getValue(key, null);
    const record = {
      cardNumber,
      valid,
      cvv,
      // A re-collected card keeps its original order/redeem time; only the
      // collection time (and status) refresh. A newly seen order fills gaps.
      order: foundOrder || (existing && existing.order) || '',
      redeemedAt: (existing && existing.redeemedAt) || now,
      collectedAt: now,
      status: existing ? 'recollected' : 'first_redeem',
      ts: Date.now(),
    };
    GM_setValue(key, record);
    const masked = cardNumber.replace(/\d(?=\d{4})/g, '*');
    const orderTag = record.order ? ' (order ' + record.order + ')' : '';
    if (existing) {
      log('card re-collected (already redeemed before):', masked + orderTag);
      toast(`Card re-collected (already redeemed). Total: ${countCards()}.`, 7000);
    } else {
      log('card saved (first redeem):', masked + orderTag);
      toast(`Card saved (${countCards()} total). Use Tampermonkey menu -> "GC: Download card data (TSV)" when done.`, 7000);
    }
  }

  async function routeActivationspot() {
    // The same domain hosts both the registration form and the issued-card
    // page — whichever marker appears first decides the handler.
    debug('activationspot page detected, routing…');
    return routeCardOrForm();
  }

  // Generic: card detail page (already redeemed or just claimed) vs
  // registration form — whichever marker appears first wins.
  async function routeCardOrForm() {
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('span#cardNumber2')) {
        log('card detail page detected');
        return handleCardPage();
      }
      if (document.querySelector('input#emailAddress')) {
        debug('registration form detected');
        return handleRegistration();
      }
      await sleep(250);
    }
    log('WARNING: page shows neither card details nor registration form');
  }

  // Safe URL description for logs: origin + path + param NAMES (never values).
  function describeUrl(url) {
    try {
      const u = new URL(url);
      const names = [...u.searchParams.keys()].join(',');
      return u.origin + u.pathname + (names ? '?' + names : '');
    } catch (e) { return '(unparseable)'; }
  }

  // Where did this registration tab come from? Used to attach the order #.
  function resolveRegOrder() {
    debug('resolving registration order for', describeUrl(location.href));
    // 0. We opened this tab ourselves after a popup-block and tagged the URL.
    try {
      const p = new URL(location.href).searchParams.get('gc_order');
      if (p) { debug('  via urlparam:', p); return { order: p, src: 'urlparam' }; }
    } catch (e) {}
    // 1. Site opened this tab natively: referrer is the giftcards page URL.
    try {
      const ref = document.referrer || '';
      const lid = lineItemIdFromUrl(ref);
      debug('  referrer:', ref ? describeUrl(ref) : '(empty)', '| lineItemId:', lid || '(none)');
      if (lid) {
        const o = GM_getValue('gc_order_' + lid, '');
        if (o) { debug('  via referrer:', o); return { order: o, src: 'referrer' }; }
        debug('  no mapping stored for lineItemId', lid);
      }
    } catch (e) {}
    // 2. We opened it after a popup-block: order stored under URL-derived keys.
    const keys = orderKeysForUrl(location.href);
    debug('  checking', keys.length, 'URL-derived keys…');
    for (const k of keys) {
      try {
        const o = GM_getValue(k, '');
        if (o) { debug('  via urlkey:', o); return { order: o, src: 'urlkey' }; }
      } catch (e) {}
    }
    debug('  no order found by any method');
    return { order: '', src: 'none' };
  }

  // Where did this card page come from? Used to attach the order #.
  function resolveCardOrder() {
    debug('resolving card order for', describeUrl(location.href));
    // 0. Tagged URL (we opened this tab after a popup-block).
    try {
      const p = new URL(location.href).searchParams.get('gc_order');
      if (p) { debug('  via urlparam:', p); return { order: p, src: 'urlparam' }; }
    } catch (e) {}
    // 1. Same-tab navigation from the registration form (no cross-tab race:
    //    sessionStorage is per-tab).
    try {
      const s = sessionStorage.getItem('gc_order');
      if (s) { debug('  via session:', s); return { order: s, src: 'session' }; }
    } catch (e) {}
    debug('  session: (empty)');
    // 2. Referrer carries the giftcards URL (same-tab claim navigation).
    try {
      const ref = document.referrer || '';
      const lid = lineItemIdFromUrl(ref);
      debug('  referrer:', ref ? describeUrl(ref) : '(empty)', '| lineItemId:', lid || '(none)');
      if (lid) {
        const o = GM_getValue('gc_order_' + lid, '');
        if (o) { debug('  via referrer:', o); return { order: o, src: 'referrer' }; }
        debug('  no mapping stored for lineItemId', lid);
      }
    } catch (e) {}
    // 3. Giftcards tab stored it under keys derived from this page's own URL
    //    (already-redeemed cards opened directly by the claim click).
    const keys = orderKeysForUrl(location.href);
    debug('  checking', keys.length, 'URL-derived keys…');
    for (const k of keys) {
      try {
        const o = GM_getValue(k, '');
        if (o) { debug('  via urlkey:', o); return { order: o, src: 'urlkey' }; }
      } catch (e) {}
    }
    // 4. Best effort: order number printed on the card page itself.
    try {
      const m = (document.body ? document.body.innerText : '').match(/Order\s*Number\s*:\s*([\d-]+)/i);
      if (m) { debug('  via page text:', m[1].trim()); return { order: m[1].trim(), src: 'page' }; }
    } catch (e) {}
    debug('  no order found by any method');
    return { order: '', src: 'none' };
  }

  /* ---------------- collect / download ---------------- */

  function fmtTs(iso) {
    return iso ? String(iso).replace('T', ' ').slice(0, 19) : '';
  }

  function getCardRows() {
    return GM_listValues()
      .filter((k) => k.startsWith(CARD_PREFIX))
      .map((k) => GM_getValue(k))
      .filter(Boolean)
      // Sort by collection time (oldest first); legacy records fall back to ts.
      .sort((a, b) => String(a.collectedAt || a.ts || 0).localeCompare(String(b.collectedAt || b.ts || 0)));
  }

  function downloadCards() {
    const rows = getCardRows();
    if (!rows.length) { toast('No card data collected yet.'); return; }
    const header = 'order_number\tcard_number\tvalid_thru\tcvv\tredeemed_at\tcollected_at\tstatus';
    const lines = rows.map((r) =>
      [r.order || '', r.cardNumber || '', r.valid || '', r.cvv || '',
       r.redeemedAt || '', r.collectedAt || '', r.status || ''].join('\t')
    );
    const tsv = header + '\n' + lines.join('\n');
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'giftcards.tsv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Downloaded ${rows.length} card(s) as giftcards.tsv.`);
    log(`exported ${rows.length} card(s) to TSV`);
  }

  function openCardsPanel() {
    if (document.getElementById('gc-cards-panel')) return;
    const rows = getCardRows();
    const panel = mkEl('div', null,
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;' +
      'background:#fff;color:#111;border-radius:12px;padding:24px;width:min(1020px,94vw);max-height:85vh;' +
      'display:flex;flex-direction:column;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.4);font:14px system-ui,sans-serif;');
    panel.id = 'gc-cards-panel';
    panel.appendChild(mkEl('h3', `Collected gift cards (${rows.length})`, 'margin:0 0 12px;font-size:16px;'));

    const wrap = mkEl('div', null, 'overflow:auto;flex:1;');
    if (!rows.length) {
      wrap.appendChild(mkEl('p', 'No cards collected yet.', 'color:#666;'));
    } else {
      const table = mkEl('table', null, 'width:100%;border-collapse:collapse;font-size:12px;');
      const head = mkEl('tr');
      ['Order #', 'Card number', 'Valid thru', 'CVV', 'Redeemed at', 'Collected at', 'Status'].forEach((t) =>
        head.appendChild(mkEl('th', t, 'text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;white-space:nowrap;'))
      );
      table.appendChild(head);
      for (const r of rows) {
        const tr = mkEl('tr');
        [
          r.order || '—',
          r.cardNumber || '',
          r.valid || '',
          r.cvv || '',
          fmtTs(r.redeemedAt),
          fmtTs(r.collectedAt),
          r.status || '',
        ].forEach((c) =>
          tr.appendChild(mkEl('td', c, 'padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;'))
        );
        table.appendChild(tr);
      }
      wrap.appendChild(table);
    }
    panel.appendChild(wrap);

    const btnRow = mkEl('div', null, 'margin-top:12px;display:flex;justify-content:flex-end;gap:8px;');
    const dl = mkEl('button', 'Download TSV',
      'padding:8px 14px;border:0;background:#1a73e8;color:#fff;border-radius:6px;cursor:pointer;');
    const close = mkEl('button', 'Close',
      'padding:8px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:6px;cursor:pointer;');
    dl.onclick = () => downloadCards();
    close.onclick = () => panel.remove();
    btnRow.appendChild(dl);
    btnRow.appendChild(close);
    panel.appendChild(btnRow);
    (document.body || document.documentElement).appendChild(panel);
  }

  function clearCards() {
    const keys = GM_listValues().filter((k) => k.startsWith(CARD_PREFIX));
    keys.forEach((k) => GM_deleteValue(k));
    toast(`Cleared ${keys.length} saved card(s).`);
  }

  /* ---------------- menu + router ---------------- */

  // Cooperative "close all": a menu click sets a timestamp in storage; every
  // giftcards.com / activationspot.com tab polls for it and closes itself.
  // (A script can only close tabs it opened, so each tab closes itself.)
  // Tabs opened after the signal are unaffected (signal must be newer than
  // the tab). The Gmail tab never watches, so it stays open.
  const __tabBornAt = Date.now();
  function closeAllGcTabs() {
    try {
      if (!confirm('Close all giftcards.com and activationspot.com tabs?\n\nThe Gmail tab stays open.')) return;
    } catch (e) { return; }
    try { GM_setValue('gc_close_all', Date.now()); } catch (e) {}
    toast('Close signal sent — gift card tabs will close themselves.');
    log('close-all signal sent');
  }
  function watchCloseSignal() {
    setInterval(() => {
      let sig = 0;
      try { sig = GM_getValue('gc_close_all', 0); } catch (e) {}
      if (sig > __tabBornAt) {
        log('close-all signal received; closing this tab');
        window.close();
      }
    }, 2000);
  }

  GM_registerMenuCommand('GC: Settings', openProfilePanel);
  GM_registerMenuCommand('GC: Redeem all gift cards', startRedeem);
  GM_registerMenuCommand('GC: View collected cards', openCardsPanel);
  GM_registerMenuCommand('GC: Download card data (TSV)', downloadCards);
  GM_registerMenuCommand('GC: Clear collected card data', clearCards);
  GM_registerMenuCommand('GC: Close all gift card tabs', closeAllGcTabs);

  debug('gc-redeem loaded on', location.hostname, '- menu commands registered');

  const host = location.hostname;
  if (host.includes('giftcards.com')) {
    watchCloseSignal();
    // Only the recipient-experience page is a redeem flow
    // (/us/en/transaction/recipient-experience?lineItemId=...). Homepage,
    // shop, account and other pages are ignored.
    if (location.pathname.includes('/transaction/recipient-experience')) {
      handleGiftcards();
    } else {
      debug('giftcards.com page is not a redeem link; plugin idle:', location.pathname);
    }
  } else if (host.includes('activationspot.com')) {
    watchCloseSignal();
    routeActivationspot();
  }
  // mail.google.com: driven manually via the Tampermonkey menu.
})();
