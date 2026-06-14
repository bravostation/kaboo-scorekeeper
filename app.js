/* Kaboo Scorekeeper — single-file vanilla JS app */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const STORAGE_KEY = 'kaboo.v1';

  /** ---- State ---- **/
  /** @typedef {{ id:string, name:string }} Player */
  /** @typedef {{ scores: Record<string, number> }} Round */
  /** @typedef {{ id:string, started:number, ended:number|null, players: Player[], rounds: Round[], winCondition: 'low'|'high', target: number|null, allowNegative: boolean }} Game */

  const defaultState = () => ({
    version: 1,
    settings: { winCondition: 'low', target: 100, allowNegative: true },
    activeGame: /** @type {Game|null} */ (null),
    history: /** @type {Game[]} */ ([]),
    lastLineup: /** @type {string[]} */ ([]),
  });

  let state = load();
  // One-time migration from old carboot.v1 key, if present
  try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem('carboot.v1')) {
      const old = localStorage.getItem('carboot.v1');
      localStorage.setItem(STORAGE_KEY, old);
      localStorage.removeItem('carboot.v1');
      state = load();
    }
  } catch (_) {}

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // shallow merge to forward-compat
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.warn('Failed to load state', e);
      return defaultState();
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Couldn’t save (storage full?)', 'error'); }
  }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  /** ---- DOM helpers ---- **/
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + kind;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  function confirmDialog(title, body) {
    return new Promise((resolve) => {
      const dlg = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-body').textContent = body || '';
      const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  /** ---- Tabs ---- **/
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'history') renderHistory();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
  }

  /** ---- Setup view (no active game) ---- **/
  let setupPlayers = []; // [{id, name}]

  function renderSetup() {
    const ul = $('#setup-players');
    ul.innerHTML = '';
    for (const p of setupPlayers) {
      ul.appendChild(el('li', {},
        el('span', {}, p.name),
        el('button', { class: 'remove', title: 'Remove', onclick: () => { setupPlayers = setupPlayers.filter(x => x.id !== p.id); renderSetup(); } }, '×')
      ));
    }
    $('#start-game-btn').disabled = setupPlayers.length < 1;
    const reuse = $('#quick-add-recent');
    reuse.hidden = !state.lastLineup || state.lastLineup.length === 0 || setupPlayers.length > 0;
    if (!reuse.hidden) reuse.textContent = `Reuse last lineup (${state.lastLineup.join(', ')})`;
  }

  $('#add-player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#player-name');
    const name = input.value.trim();
    if (!name) return;
    if (setupPlayers.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast('That name is already added', 'error'); return;
    }
    setupPlayers.push({ id: uid(), name });
    input.value = '';
    input.focus();
    renderSetup();
  });

  $('#quick-add-recent').addEventListener('click', () => {
    setupPlayers = state.lastLineup.map(name => ({ id: uid(), name }));
    renderSetup();
  });

  $('#start-game-btn').addEventListener('click', () => {
    if (setupPlayers.length < 1) return;
    const game = {
      id: uid(),
      started: Date.now(),
      ended: null,
      players: setupPlayers.slice(),
      rounds: [],
      winCondition: state.settings.winCondition,
      target: state.settings.target,
      allowNegative: state.settings.allowNegative,
    };
    state.activeGame = game;
    state.lastLineup = setupPlayers.map(p => p.name);
    setupPlayers = [];
    save();
    renderGame();
    toast('Game started — good luck 🎴', 'success');
  });

  /** ---- Active game view ---- **/
  function totals(game) {
    const t = {};
    for (const p of game.players) t[p.id] = 0;
    for (const r of game.rounds) {
      for (const p of game.players) t[p.id] += Number(r.scores[p.id] || 0);
    }
    return t;
  }

  function leaderId(game) {
    if (game.players.length === 0) return null;
    const t = totals(game);
    const ids = game.players.map(p => p.id);
    if (game.winCondition === 'low') ids.sort((a, b) => t[a] - t[b]);
    else ids.sort((a, b) => t[b] - t[a]);
    return ids[0];
  }
  function trailerId(game) {
    if (game.players.length === 0) return null;
    const t = totals(game);
    const ids = game.players.map(p => p.id);
    if (game.winCondition === 'low') ids.sort((a, b) => t[b] - t[a]);
    else ids.sort((a, b) => t[a] - t[b]);
    return ids[0];
  }

  function renderGame() {
    const setup = $('#setup-view');
    const active = $('#active-view');
    const game = state.activeGame;
    if (!game) {
      setup.hidden = false;
      active.hidden = true;
      renderSetup();
      return;
    }
    setup.hidden = true;
    active.hidden = false;

    const t = totals(game);
    const leader = leaderId(game);
    const winLabel = game.winCondition === 'low' ? 'lowest wins' : 'highest wins';
    const targetTxt = game.target ? ` · target ${game.target}` : '';
    $('#active-meta').textContent = `${game.players.length} players · ${game.rounds.length} round${game.rounds.length === 1 ? '' : 's'} · ${winLabel}${targetTxt}`;
    $('#active-title').textContent = `Game · ${new Date(game.started).toLocaleString()}`;

    // Header row
    const head = $('#score-head');
    head.innerHTML = '';
    head.appendChild(el('th', {}, 'Round'));
    for (const p of game.players) head.appendChild(el('th', {}, p.name));

    // Round rows
    const body = $('#score-body');
    body.innerHTML = '';
    if (game.rounds.length === 0) {
      const tr = el('tr', {}, el('td', { colspan: game.players.length + 1, class: 'muted' }, 'No rounds yet — submit your first below.'));
      body.appendChild(tr);
    } else {
      game.rounds.forEach((r, i) => {
        const tr = el('tr', {}, el('td', {}, `R${i + 1}`));
        for (const p of game.players) {
          tr.appendChild(el('td', {}, String(r.scores[p.id] ?? 0)));
        }
        body.appendChild(tr);
      });
    }

    // Totals
    const foot = $('#score-foot');
    foot.innerHTML = '';
    const totalRow = el('tr', { class: 'crown' }, el('td', {}, 'Total'));
    for (const p of game.players) {
      const cls = (p.id === leader) ? 'winner' : (p.id === trailerId(game) && game.players.length > 1 ? 'loser' : '');
      totalRow.appendChild(el('td', { class: cls }, String(t[p.id])));
    }
    foot.appendChild(totalRow);

    // Round form
    const form = $('#round-form');
    form.innerHTML = '';
    for (const p of game.players) {
      const inputAttrs = { type: 'number', step: '1', name: p.id, inputmode: 'numeric' };
      if (!game.allowNegative) inputAttrs.min = '0';
      form.appendChild(el('label', {},
        el('span', {}, p.name),
        el('input', inputAttrs)
      ));
    }
    $('#round-num').textContent = `#${game.rounds.length + 1}`;
    $('#undo-round-btn').disabled = game.rounds.length === 0;
    $('#round-hint').textContent = game.allowNegative ? 'Negative scores allowed.' : 'Empty inputs count as 0.';
  }

  $('#submit-round-btn').addEventListener('click', () => {
    const game = state.activeGame; if (!game) return;
    const inputs = $$('#round-form input');
    const scores = {};
    let allEmpty = true;
    for (const inp of inputs) {
      const raw = inp.value.trim();
      if (raw === '') { scores[inp.name] = 0; continue; }
      const n = Number(raw);
      if (Number.isNaN(n)) { toast('All scores must be numbers', 'error'); return; }
      if (!game.allowNegative && n < 0) { toast('Negative scores disabled', 'error'); return; }
      scores[inp.name] = n;
      allEmpty = false;
    }
    if (allEmpty) { toast('Enter at least one score', 'error'); return; }
    game.rounds.push({ scores });
    save();
    renderGame();

    // Auto-end if target reached
    if (game.target) {
      const t = totals(game);
      const reached = Object.values(t).some(v => game.winCondition === 'low' ? v >= game.target : v >= game.target);
      if (reached) {
        toast('🎯 Target reached', 'success');
      }
    }
  });

  $('#clear-round-btn').addEventListener('click', () => {
    $$('#round-form input').forEach(i => { i.value = ''; });
    $$('#round-form input')[0]?.focus();
  });

  $('#undo-round-btn').addEventListener('click', async () => {
    const game = state.activeGame; if (!game || game.rounds.length === 0) return;
    if (!await confirmDialog('Undo last round?', 'This removes the most recent round entry.')) return;
    game.rounds.pop();
    save();
    renderGame();
    toast('Last round removed');
  });

  $('#end-game-btn').addEventListener('click', async () => {
    const game = state.activeGame; if (!game) return;
    if (game.rounds.length === 0) {
      if (!await confirmDialog('Discard game?', 'No rounds played. End and discard?')) return;
      state.activeGame = null;
      save();
      renderGame();
      return;
    }
    if (!await confirmDialog('End the game?', 'It will be saved to history.')) return;
    game.ended = Date.now();
    state.history.unshift(game);
    state.activeGame = null;
    save();
    renderGame();
    const t = totals(game);
    const winId = leaderId(game);
    const winName = game.players.find(p => p.id === winId)?.name || '—';
    toast(`🏆 ${winName} wins with ${t[winId]}`, 'success');
  });

  /** ---- History ---- **/
  function renderHistory() {
    const list = $('#history-list');
    list.innerHTML = '';
    if (state.history.length === 0) {
      list.appendChild(el('p', { class: 'muted' }, 'No completed games yet.'));
      return;
    }
    for (const game of state.history) {
      const t = totals(game);
      const winId = leaderId(game);
      const winName = game.players.find(p => p.id === winId)?.name || '—';
      const dt = new Date(game.ended || game.started);
      const summary = el('div', { class: 'row' },
        el('div', {},
          el('div', {}, el('strong', {}, dt.toLocaleString()), ' ', el('span', { class: 'winner-tag' }, `🏆 ${winName}`)),
          el('div', { class: 'meta' }, `${game.players.length} players · ${game.rounds.length} rounds · ${game.winCondition === 'low' ? 'low' : 'high'} wins`)
        )
      );
      const det = el('details', {},
        el('summary', {}, 'Round breakdown'),
        roundsTable(game)
      );
      const actions = el('div', { class: 'item-actions' },
        el('button', { class: 'btn ghost small', onclick: () => rematchFrom(game) }, 'Rematch'),
        el('button', { class: 'btn danger small', onclick: () => deleteGame(game.id) }, 'Delete')
      );
      list.appendChild(el('div', { class: 'history-item' }, summary, det, actions));
    }
  }

  function roundsTable(game) {
    const t = totals(game);
    const tbl = el('table');
    const thead = el('thead', {}, (() => {
      const tr = el('tr', {}, el('th', {}, 'Round'));
      game.players.forEach(p => tr.appendChild(el('th', {}, p.name)));
      return tr;
    })());
    const tbody = el('tbody');
    game.rounds.forEach((r, i) => {
      const tr = el('tr', {}, el('td', {}, `R${i + 1}`));
      game.players.forEach(p => tr.appendChild(el('td', {}, String(r.scores[p.id] ?? 0))));
      tbody.appendChild(tr);
    });
    const tfoot = el('tfoot');
    const totalTr = el('tr', {}, el('td', {}, 'Total'));
    game.players.forEach(p => totalTr.appendChild(el('td', {}, String(t[p.id]))));
    tfoot.appendChild(totalTr);
    tbl.appendChild(thead); tbl.appendChild(tbody); tbl.appendChild(tfoot);
    return el('div', { class: 'table-wrap' }, tbl);
  }

  async function deleteGame(id) {
    if (!await confirmDialog('Delete this game?', 'This cannot be undone.')) return;
    state.history = state.history.filter(g => g.id !== id);
    save();
    renderHistory();
    toast('Game deleted');
  }

  async function rematchFrom(game) {
    if (state.activeGame) {
      if (!await confirmDialog('Replace active game?', 'You have a game in progress. Discard it and start rematch?')) return;
      state.activeGame = null;
    }
    setupPlayers = game.players.map(p => ({ id: uid(), name: p.name }));
    save();
    switchTab('game');
    renderGame();
    toast('Players loaded — hit Start');
  }

  /** ---- Stats ---- **/
  function renderStats() {
    const meta = $('#stats-meta');
    const root = $('#stats-content');
    root.innerHTML = '';
    const games = state.history.slice();
    if (games.length === 0) {
      meta.textContent = '';
      root.appendChild(el('p', { class: 'muted' }, 'Play a few games to see stats.'));
      return;
    }
    meta.textContent = `Across ${games.length} completed game${games.length === 1 ? '' : 's'}.`;

    // Per-player aggregates (matched by name)
    /** @type {Record<string, {name:string, gamesPlayed:number, wins:number, totalPoints:number, totalRounds:number, bestRound:number|null, worstRound:number|null}>} */
    const agg = {};
    let totalRounds = 0;
    for (const g of games) {
      const t = totals(g);
      const winId = leaderId(g);
      totalRounds += g.rounds.length;
      for (const p of g.players) {
        const k = p.name.toLowerCase();
        if (!agg[k]) agg[k] = { name: p.name, gamesPlayed: 0, wins: 0, totalPoints: 0, totalRounds: 0, bestRound: null, worstRound: null };
        agg[k].gamesPlayed += 1;
        agg[k].totalPoints += t[p.id];
        agg[k].totalRounds += g.rounds.length;
        if (p.id === winId) agg[k].wins += 1;
        for (const r of g.rounds) {
          const v = Number(r.scores[p.id] || 0);
          if (agg[k].bestRound == null || (g.winCondition === 'low' ? v < agg[k].bestRound : v > agg[k].bestRound)) agg[k].bestRound = v;
          if (agg[k].worstRound == null || (g.winCondition === 'low' ? v > agg[k].worstRound : v < agg[k].worstRound)) agg[k].worstRound = v;
        }
      }
    }

    // Topline cards
    const topPlayers = Object.values(agg).sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed);
    const champ = topPlayers[0];
    const grid = el('div', { class: 'stat-grid' },
      stat('Games played', games.length, true),
      stat('Total rounds', totalRounds),
      stat('Avg rounds/game', games.length ? (totalRounds / games.length).toFixed(1) : '—'),
      stat('Reigning champ', champ ? `${champ.name} (${champ.wins} W)` : '—', true),
    );
    root.appendChild(grid);

    // Leaderboard
    const lb = el('table', { class: 'leaderboard' });
    const lbHead = el('thead', {}, el('tr', {},
      el('th', {}, 'Player'),
      el('th', {}, 'Games'),
      el('th', {}, 'Wins'),
      el('th', {}, 'Win %'),
      el('th', {}, 'Avg pts/game'),
      el('th', {}, 'Avg pts/round'),
      el('th', {}, 'Best rd'),
      el('th', {}, 'Worst rd'),
    ));
    const lbBody = el('tbody');
    for (const p of topPlayers) {
      const winPct = p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0;
      const avgPerGame = p.gamesPlayed ? (p.totalPoints / p.gamesPlayed).toFixed(1) : '—';
      const avgPerRound = p.totalRounds ? (p.totalPoints / p.totalRounds).toFixed(1) : '—';
      lbBody.appendChild(el('tr', {},
        el('td', {}, p.name),
        el('td', { class: 'num' }, String(p.gamesPlayed)),
        el('td', { class: 'num' }, String(p.wins)),
        el('td', { class: 'num' }, `${winPct}%`),
        el('td', { class: 'num' }, avgPerGame),
        el('td', { class: 'num' }, avgPerRound),
        el('td', { class: 'num' }, p.bestRound == null ? '—' : String(p.bestRound)),
        el('td', { class: 'num' }, p.worstRound == null ? '—' : String(p.worstRound)),
      ));
    }
    lb.appendChild(lbHead); lb.appendChild(lbBody);
    root.appendChild(el('h3', {}, 'Leaderboard'));
    root.appendChild(el('div', { class: 'table-wrap' }, lb));

    // Recent rivalry: head-to-head summary if exactly two players appear most
    const sortedByPlay = Object.values(agg).sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    if (sortedByPlay.length >= 2) {
      const a = sortedByPlay[0], b = sortedByPlay[1];
      const both = games.filter(g => g.players.find(p => p.name.toLowerCase() === a.name.toLowerCase()) && g.players.find(p => p.name.toLowerCase() === b.name.toLowerCase()));
      if (both.length > 0) {
        let aw = 0, bw = 0;
        for (const g of both) {
          const t = totals(g);
          const ap = g.players.find(p => p.name.toLowerCase() === a.name.toLowerCase());
          const bp = g.players.find(p => p.name.toLowerCase() === b.name.toLowerCase());
          const av = t[ap.id], bv = t[bp.id];
          const aWins = g.winCondition === 'low' ? av < bv : av > bv;
          if (av === bv) continue;
          if (aWins) aw++; else bw++;
        }
        root.appendChild(el('h3', {}, 'Top rivalry'));
        root.appendChild(el('p', { class: 'muted' }, `${a.name} vs ${b.name}: ${aw}–${bw} across ${both.length} shared game${both.length === 1 ? '' : 's'}.`));
      }
    }
  }

  function stat(label, value, accent) {
    return el('div', { class: 'stat' + (accent ? ' accent' : '') },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, String(value))
    );
  }

  /** ---- Settings ---- **/
  function renderSettings() {
    $('#setting-win').value = state.settings.winCondition;
    $('#setting-target').value = state.settings.target ?? '';
    $('#setting-negative').checked = !!state.settings.allowNegative;
    $('#app-version').textContent = APP_VERSION;
  }

  $('#setting-win').addEventListener('change', (e) => {
    state.settings.winCondition = e.target.value === 'high' ? 'high' : 'low';
    save();
    if (state.activeGame) { state.activeGame.winCondition = state.settings.winCondition; save(); renderGame(); }
    toast('Win condition saved');
  });
  $('#setting-target').addEventListener('change', (e) => {
    const n = Number(e.target.value);
    state.settings.target = e.target.value === '' || Number.isNaN(n) ? null : n;
    save();
    if (state.activeGame) { state.activeGame.target = state.settings.target; save(); renderGame(); }
  });
  $('#setting-negative').addEventListener('change', (e) => {
    state.settings.allowNegative = !!e.target.checked;
    save();
    if (state.activeGame) { state.activeGame.allowNegative = state.settings.allowNegative; save(); renderGame(); }
  });

  $('#wipe-btn').addEventListener('click', async () => {
    if (!await confirmDialog('Wipe all data?', 'Active game, history, and settings will be removed.')) return;
    state = defaultState();
    save();
    renderGame(); renderSettings();
    toast('All data wiped');
  });

  $('#export-btn').addEventListener('click', () => exportJson({ history: state.history }));
  $('#export-all-btn').addEventListener('click', () => exportJson(state));
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!await confirmDialog('Import data?', 'This will merge / replace your current data.')) return;
      // accept either full state or just history
      if (obj && typeof obj === 'object') {
        if (Array.isArray(obj.history)) state.history = obj.history.concat(state.history);
        if (obj.settings) Object.assign(state.settings, obj.settings);
        if (obj.activeGame && !state.activeGame) state.activeGame = obj.activeGame;
        if (Array.isArray(obj.lastLineup)) state.lastLineup = obj.lastLineup;
      }
      save();
      renderGame(); renderHistory(); renderStats(); renderSettings();
      toast('Imported', 'success');
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  function exportJson(obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `kaboo-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Exported');
  }

  /** ---- Initial paint ---- **/
  renderGame();
  renderSettings();

  // Safety: warn before unload if active game has unsaved-looking input
  window.addEventListener('beforeunload', () => save());
})();
