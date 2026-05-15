// ============================================================
// Chess Club Hub — Main App Controller (v2)
// Adds: Chess Clock, Computer Opponent, ELO Ratings
// ============================================================

import { initGameState, legalMoves, makeMove, color, type, PIECES, toFen, undoMove } from './chess/engine.js';
import * as boardUI from './chess/board-ui.js';
import { exportPGN, downloadPGN }    from './chess/pgn.js';
import { ChessClock, TIME_CONTROLS } from './chess/clock.js';
import { DIFFICULTY_LEVELS, getBestMoveAsync } from './chess/ai.js';
import { getRatingTitle, getPlayerRating,
         updateRatingsAfterGame, getEloLeaderboard } from './chess/elo.js';
import { initStorage, getProfile, saveProfile, getGames, saveGame, getGame, deleteGame,
         upsertPlayer, getLeaderboard, getTournaments, saveTournament, genId } from './storage/db.js';
import { createTournament, recordResult, getBracketSummary } from './tournament/bracket.js';
import { generateRoomCode, createRoom, joinRoom, sendMove, onMove,
         onOpponentJoin, sendChat, ensureAnonymousAuth, setActiveClub,
         cloudCreateClub, cloudJoinClub, cloudRecordOnlineGameResult, leaveRoomChannel,
         getCurrentUid, fetchClubRatings,
         sendMagicLink, completeMagicLinkSignIn, getAuthUser } from './multiplayer/relay.js';
import { escapeHtml, isLinkedAccount } from './js/utils.js';
import { createEvent, updateEvent, publishEvent,
         getEvents, getMyEvents, formatEventDate, validateEventForm } from './js/events.js';
import { registerForEvent, getMyRegistration, validateRegistrationForm } from './js/registrations.js';
import { analyzePosition, analyzeGame, cancel as cancelEngine } from './engine/analysis.js';
import { renderEvalGraph } from './js/ui/eval-graph.js';

// ── State ─────────────────────────────────────────────────────

let gameState    = null;
let selected     = null;
let hints        = [];
let flipped      = false;
let lastMove     = null;        // { from: [r,c], to: [r,c] }
let pendingPreMove = null;      // { from: [r,c], to: [r,c] } | null  (online only)
let gameMode     = 'local';   // 'local' | 'cpu' | 'online-host' | 'online-guest'
let myColor      = 'w';
let cpuColor     = 'b';
let cpuDifficulty = 1;
let roomCode     = null;
let playerNames  = { w: 'White', b: 'Black' };
let activeGameId = null;
let annotations  = {};
let clock        = null;
let pendingPromo = null;
let cpuThinking  = false;

// Review
let reviewGame = null;
let reviewIdx  = 0;
let engineDepth = 18;          // active per-position depth
let engineSource = '';         // 'cloud' | 'local' | ''

/** Opponent Firebase uid (online games) for server ELO */
let opponentUid = null;

// ── Board UI helpers ──────────────────────────────────────────

function _capturedBy(col) {
  if (!gameState) return [];
  return gameState.history
    .filter(h => h.piece[0] === col && h.captured)
    .map(h => h.captured);
}

function setPreMove(from, to) {
  if (gameMode !== 'online-host' && gameMode !== 'online-guest') return;
  pendingPreMove = { from, to };
  renderBoard();
}

function _clearPreMove() {
  pendingPreMove = null;
}

// ── Auth modal ────────────────────────────────────────────────

window.sendAuthLink = async function() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email || !email.includes('@')) return toast('Enter a valid email address');
  try {
    await sendMagicLink(email);
    toast('Check your email — sign-in link sent! ✉️');
    document.getElementById('auth-modal').style.display = 'none';
  } catch (e) {
    toast(e.message || 'Could not send sign-in link');
    console.error(e);
  }
};

window.dismissAuth = function() {
  document.getElementById('auth-modal').style.display = 'none';
  sessionStorage.setItem('authDismissed', '1');
};

// ── Events UI ─────────────────────────────────────────────────

function openCreateEventForm() {
  document.getElementById('ev-form-title').textContent = 'New Event';
  document.getElementById('ev-form').reset();
  delete document.getElementById('ev-form').dataset.editingId;
  document.getElementById('ev-form-container').style.display = '';
}

function openEditEventForm(ev) {
  document.getElementById('ev-form').reset();
  document.getElementById('ev-form-title').textContent = 'Edit Event';
  document.getElementById('ev-title').value = ev.title;
  document.getElementById('ev-start').value = ev.startDate.slice(0, 10);
  document.getElementById('ev-end').value = ev.endDate.slice(0, 10);
  document.getElementById('ev-address').value = ev.location?.address || '';
  document.getElementById('ev-city').value = ev.location?.city || '';
  document.getElementById('ev-state').value = ev.location?.state || '';
  document.getElementById('ev-format').value = ev.format;
  document.getElementById('ev-max-players').value = ev.maxPlayers;
  document.getElementById('ev-uscf-rated').checked = Boolean(ev.uscfRated);
  document.getElementById('ev-form').dataset.editingId = ev.id;
  document.getElementById('ev-form-container').style.display = '';
}

window.openCreateEventForm = openCreateEventForm;

window.closeRegModal = function () {
  const modal = document.getElementById('reg-modal');
  modal.close();
  document.getElementById('reg-form').reset();
  document.getElementById('reg-form-error').hidden = true;
  document.getElementById('reg-success').hidden = true;
  document.getElementById('reg-form').hidden = false;
};

window.openRegModal = function (eventId, eventTitle) {
  const modal = document.getElementById('reg-modal');
  document.getElementById('reg-event-name').textContent = eventTitle;
  modal.dataset.eventId = eventId;
  document.getElementById('reg-form').hidden = false;
  document.getElementById('reg-success').hidden = true;
  document.getElementById('reg-form-error').hidden = true;
  modal.showModal();
};

document.getElementById('reg-modal').addEventListener('cancel', () => {
  window.closeRegModal();
});

window.closeCheckinModal = function () {
  document.getElementById('checkin-modal').close();
};

document.getElementById('checkin-modal').addEventListener('cancel', () => {
  window.closeCheckinModal();
});

window.openCheckinModal = async function (eventId, eventTitle) {
  const modal = document.getElementById('checkin-modal');
  document.getElementById('checkin-event-name').textContent = eventTitle;
  modal.dataset.eventId = eventId;
  const listEl = document.getElementById('checkin-list');
  const countLabel = document.getElementById('checkin-count-label');
  listEl.textContent = 'Loading…';
  countLabel.textContent = '';
  modal.showModal();

  const { getRegistrations, checkInPlayer, generateCSV } = await import('./js/registrations.js');
  let registrations = [];
  try {
    registrations = await getRegistrations(eventId);
  } catch (err) {
    listEl.textContent = 'Failed to load registrations.';
    return;
  }

  // Stale-data race guard: if modal was reopened for a different event, discard results
  if (modal.dataset.eventId !== eventId) return;

  const confirmed = registrations.filter(r => r.status === 'confirmed' || r.status === 'checked_in');
  const waitlisted = registrations.filter(r => r.status === 'waitlisted');
  countLabel.textContent = `${confirmed.length} confirmed · ${waitlisted.length} waitlisted`;

  document.getElementById('checkin-csv-btn').onclick = () => {
    const csv = generateCSV(registrations);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrations-${eventId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  listEl.textContent = '';
  if (registrations.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-dim)';
    empty.textContent = 'No registrations yet.';
    listEl.appendChild(empty);
    return;
  }

  function renderCheckinRow(reg) {
    const row = document.createElement('div');
    row.className = 'checkin-row';
    row.setAttribute('role', 'listitem');

    const nameEl = document.createElement('span');
    nameEl.className = 'checkin-name';
    nameEl.textContent = reg.playerName;

    const statusEl = document.createElement('span');
    statusEl.className = `checkin-status checkin-status--${reg.status}`;
    statusEl.textContent = reg.status.replace(/_/g, ' ');

    row.appendChild(nameEl);
    row.appendChild(statusEl);

    if (reg.status === 'confirmed') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = 'Check In';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Checking in…';
        try {
          await checkInPlayer(reg.id);
          statusEl.textContent = 'checked in';
          statusEl.className = 'checkin-status checkin-status--checked_in';
          btn.remove();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Check In';
          toast(err.message || 'Check-in failed.');
        }
      });
      row.appendChild(btn);
    }
    return row;
  }

  registrations.forEach(reg => listEl.appendChild(renderCheckinRow(reg)));
};

document.getElementById('reg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('reg-submit-btn');
  const errEl = document.getElementById('reg-form-error');
  errEl.hidden = true;
  const playerName = document.getElementById('reg-player-name').value.trim();
  const playerEmail = document.getElementById('reg-player-email').value.trim();
  const formErr = validateRegistrationForm({ playerName, playerEmail });
  if (formErr) {
    errEl.textContent = formErr;
    errEl.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Registering…';
  try {
    const eventId = document.getElementById('reg-modal').dataset.eventId;
    const result = await registerForEvent({ eventId, playerName, playerEmail });
    document.getElementById('reg-form').hidden = true;
    const successMsg = document.getElementById('reg-success-msg');
    successMsg.textContent = result.status === 'confirmed'
      ? 'Registration confirmed! Check your email.'
      : `You are on the waitlist at position ${result.waitlistPosition}. We'll email you if a spot opens.`;
    document.getElementById('reg-success').hidden = false;
    await renderEvents();
  } catch (err) {
    errEl.textContent = err.message || 'Registration failed. Please try again.';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Register';
  }
});

window.closeEventForm = function() {
  document.getElementById('ev-form-container').style.display = 'none';
};

window.switchEventsTab = function(tab) {
  const isUpcoming = tab === 'upcoming';
  document.getElementById('ev-panel-upcoming').style.display = isUpcoming ? '' : 'none';
  document.getElementById('ev-panel-mine').style.display = isUpcoming ? 'none' : '';
  document.getElementById('ev-tab-upcoming').style.borderBottom =
    isUpcoming ? '2px solid var(--gold)' : '';
  document.getElementById('ev-tab-mine').style.borderBottom =
    isUpcoming ? '' : '2px solid var(--gold)';
};

window.submitEventForm = async function() {
  const startVal = document.getElementById('ev-start').value;
  const endVal = document.getElementById('ev-end').value;
  const formPayload = {
    title: document.getElementById('ev-title').value,
    startDate: startVal,
    endDate: endVal,
    address: document.getElementById('ev-address').value,
    city: document.getElementById('ev-city').value,
    state: document.getElementById('ev-state').value,
    format: document.getElementById('ev-format').value,
    maxPlayers: document.getElementById('ev-max-players').value,
    uscfRated: document.getElementById('ev-uscf-rated').checked,
  };
  const error = validateEventForm(formPayload);
  if (error) return toast(error);

  const cloudPayload = {
    title: formPayload.title,
    startDate: startVal + 'T00:00:00',
    endDate: endVal + 'T23:59:59',
    location: {
      address: formPayload.address,
      city: formPayload.city,
      state: formPayload.state,
    },
    format: formPayload.format,
    maxPlayers: parseInt(formPayload.maxPlayers, 10),
    uscfRated: formPayload.uscfRated,
  };

  const editingId = document.getElementById('ev-form').dataset.editingId;
  try {
    if (editingId) {
      await updateEvent({ eventId: editingId, ...cloudPayload });
      toast('Event updated ✅');
    } else {
      await createEvent(cloudPayload);
      toast('Event saved as draft ✅');
    }
    window.closeEventForm();
    await renderEvents();
  } catch (e) {
    toast(e.message || 'Could not save event');
    console.error(e);
  }
};

window.publishEventFromUI = async function(eventId) {
  if (!confirm('Publish this event? It will be visible to all players.')) return;
  try {
    await publishEvent(eventId);
    toast('Event published! 🎉');
    await renderEvents();
  } catch (e) {
    toast(e.message || 'Could not publish event');
    console.error(e);
  }
};

function buildEventCard(ev, isOwner) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = '.75rem';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;';

  const title = document.createElement('h3');
  title.style.margin = '0';
  title.textContent = ev.title;

  const badge = document.createElement('span');
  badge.style.cssText = 'font-size:.75rem;padding:.2rem .5rem;border-radius:8px;background:var(--surface2);border:1px solid var(--border);text-transform:capitalize;';
  badge.textContent = ev.status;

  header.appendChild(title);
  header.appendChild(badge);
  card.appendChild(header);

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:.85rem;color:var(--text-dim);display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.75rem;';

  const dateSpan = document.createElement('span');
  const startStr = formatEventDate(ev.startDate);
  const endStr = formatEventDate(ev.endDate);
  dateSpan.textContent = startStr === endStr
    ? `📅 ${startStr}`
    : `📅 ${startStr} – ${endStr}`;

  const locSpan = document.createElement('span');
  locSpan.textContent = `📍 ${ev.location?.city || ''}${ev.location?.state ? ', ' + ev.location.state : ''}`;

  const fmtSpan = document.createElement('span');
  fmtSpan.textContent = `🏆 ${ev.format.replace(/_/g, ' ')} · ${ev.maxPlayers} players`;

  meta.appendChild(dateSpan);
  meta.appendChild(locSpan);
  meta.appendChild(fmtSpan);
  card.appendChild(meta);

  if (isOwner && ev.status === 'draft') {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-outline btn-sm';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditEventForm(ev);

    const publishBtn = document.createElement('button');
    publishBtn.className = 'btn btn-emerald btn-sm';
    publishBtn.textContent = 'Publish';
    publishBtn.onclick = () => window.publishEventFromUI(ev.id);

    actions.appendChild(editBtn);
    actions.appendChild(publishBtn);
    card.appendChild(actions);
  }

  if (isOwner && (ev.status === 'open' || ev.status === 'in_progress')) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;';

    const countBadge = document.createElement('span');
    countBadge.style.cssText = 'font-size:.8rem;color:var(--text-dim);';
    countBadge.textContent = '…';
    actions.appendChild(countBadge);

    const manageBtn = document.createElement('button');
    manageBtn.className = 'btn btn-outline btn-sm';
    manageBtn.textContent = 'Manage';
    manageBtn.addEventListener('click', () => window.openCheckinModal(ev.id, ev.title));
    actions.appendChild(manageBtn);

    card.appendChild(actions);

    import('./js/registrations.js').then(({ getRegistrationCount }) => {
      return getRegistrationCount(ev.id);
    }).then(count => {
      countBadge.textContent = `${count} / ${ev.maxPlayers ?? '?'} registered`;
    }).catch(() => {
      countBadge.textContent = '';
    });
  }

  const currentUid = getAuthUser()?.uid;
  if (!isOwner && ev.status === 'open' && ev.organizerUid !== currentUid) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;';

    const regBtn = document.createElement('button');
    regBtn.className = 'btn btn-emerald btn-sm';
    regBtn.textContent = 'Register';
    regBtn.addEventListener('click', () => window.openRegModal(ev.id, ev.title));
    actions.appendChild(regBtn);
    card.appendChild(actions);

    // Async: update button with user's current registration status
    getMyRegistration(ev.id).then(reg => {
      if (!reg || reg.status === 'withdrawn') return;
      regBtn.disabled = true;
      const labels = {
        confirmed: 'Confirmed',
        waitlisted: `Waitlisted #${reg.waitlistPosition}`,
        checked_in: 'Checked In',
      };
      regBtn.textContent = labels[reg.status] || reg.status;
    }).catch(() => {});
  }

  return card;
}

async function renderEvents() {
  const listEl = document.getElementById('events-list');
  const myListEl = document.getElementById('my-events-list');
  if (!listEl || !myListEl) return;

  listEl.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;">Loading…</p>';
  myListEl.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;">Loading…</p>';

  try {
    const [upcoming, mine] = await Promise.all([getEvents('open'), getMyEvents()]);

    listEl.innerHTML = '';
    if (upcoming.length === 0) {
      const msg = document.createElement('p');
      msg.style.cssText = 'color:var(--text-dim);font-size:.9rem;';
      msg.textContent = 'No upcoming events. Check back soon!';
      listEl.appendChild(msg);
    } else {
      upcoming.forEach(ev => listEl.appendChild(buildEventCard(ev, false)));
    }

    myListEl.innerHTML = '';
    if (mine.length === 0) {
      const msg = document.createElement('p');
      msg.style.cssText = 'color:var(--text-dim);font-size:.9rem;';
      msg.textContent = 'No events yet. Click "+ Create Event" to add one.';
      myListEl.appendChild(msg);
    } else {
      mine.forEach(ev => myListEl.appendChild(buildEventCard(ev, true)));
    }
  } catch (e) {
    listEl.innerHTML = '';
    myListEl.innerHTML = '';
    const errMsg = document.createElement('p');
    errMsg.style.cssText = 'color:var(--text-dim);font-size:.9rem;';
    errMsg.textContent = 'Error loading events. Check your connection.';
    listEl.appendChild(errMsg);
    myListEl.appendChild(errMsg.cloneNode(true));
    console.error('renderEvents error:', e);
  }
}

// ── Init UI ───────────────────────────────────────────────────

async function initUI() {
  // Mount the board UI (DOM must exist, board element is present from page load)
  boardUI.mount(document.getElementById('chessboard'), {
    onMove: (from, to) => {
      selected = from;
      hints = legalMoves(gameState, from[0], from[1]);
      onSquareClick(to[0], to[1]);
    },
    onPreMove: setPreMove,
  });

  await initStorage();
  try { await ensureAnonymousAuth(); } catch (e) { console.warn('Auth', e); }

  // Complete magic link sign-in if user is returning from clicking their email link
  try {
    const linkedUser = await completeMagicLinkSignIn();
    if (linkedUser) toast(`Signed in as ${linkedUser.email} ✅`);
  } catch (e) {
    console.warn('Magic link completion failed', e);
  }

  // Nudge anonymous users to sign in after 30 seconds (once per session)
  if (!isLinkedAccount(getAuthUser()) && !sessionStorage.getItem('authDismissed')) {
    setTimeout(() => {
      const modal = document.getElementById('auth-modal');
      if (modal && !isLinkedAccount(getAuthUser())) modal.style.display = 'flex';
    }, 30_000);
  }

  // Populate time control selects
  const tcHTML = TIME_CONTROLS.map((tc, i) =>
    `<option value="${i}">${tc.label}</option>`).join('');
  ['local-time-control','cpu-time-control','online-time-control'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = tcHTML; el.value = '4'; } // default: 5 min
  });

  // Difficulty buttons
  const diffEl = document.getElementById('difficulty-btns');
  if (diffEl) {
    diffEl.innerHTML = DIFFICULTY_LEVELS.map((d, i) =>
      `<button class="btn btn-surface btn-sm diff-btn" data-idx="${i}" onclick="setDifficulty(${i})">${d.label}</button>`
    ).join('');
    setDifficulty(1); // default: intermediate
  }

  updatePlayerFields();
  await loadProfile();
  await renderHome();

  initEngineSettingsStrip();

  try {
    const { refreshIcons } = await import('./js/ui/icons.js');
    globalThis.refreshLucideIcons = refreshIcons;
    await refreshIcons();
  } catch (e) {
    console.warn('Lucide icons unavailable', e);
  }
}

// ── Navigation ────────────────────────────────────────────────

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => { void nav(btn.dataset.page); });
});

const PAGE_TITLES = {
  home:        'Chess Club Hub — Home',
  play:        'Play Chess — Chess Club Hub',
  review:      'Game Review — Chess Club Hub',
  tournament:  'Tournaments — Chess Club Hub',
  leaderboard: 'Leaderboard — Chess Club Hub',
  events:      'Events — Chess Club Hub',
};

window.nav = async function(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  document.title = PAGE_TITLES[page] || 'Chess Club Hub';
  if (page === 'leaderboard') { await renderLeaderboard(); await renderEloLeaderboard(); await renderClubEloBoard(); }
  if (page === 'review')      await renderReviewList();
  if (page === 'tournament')  await renderTournaments();
  if (page === 'home')        await renderHome();
  if (page === 'events')      await renderEvents();
};

// ── Profile ───────────────────────────────────────────────────

async function loadProfile() {
  const p = await getProfile();
  setActiveClub(p.clubId || null);
  const cur = document.getElementById('club-current-id');
  if (cur) cur.textContent = p.clubId || '— (join or create a club below)';
  if (p.name) {
    document.getElementById('profile-name').value = p.name;
    await updateEloBadge(p.name);
  }
  document.getElementById('stat-wins').textContent   = p.wins;
  document.getElementById('stat-losses').textContent = p.losses;
  document.getElementById('stat-draws').textContent  = p.draws;
}

async function updateEloBadge(name) {
  if (!name) return;
  const player = await getPlayerRating(name);
  const { title, icon } = getRatingTitle(player.rating);
  document.getElementById('elo-icon').textContent   = icon;
  document.getElementById('elo-rating').textContent = player.rating;
  document.getElementById('elo-title').textContent  = title;
}

window.saveProfileName = async function() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) return toast('Enter a name first');
  const p = await getProfile();
  p.name = name;
  await saveProfile(p);
  setActiveClub(p.clubId || null);
  await updateEloBadge(name);
  toast('Profile saved ✅');
};

// ── Home ──────────────────────────────────────────────────────

async function renderHome() {
  await loadProfile();
  const games = (await getGames()).slice(0, 5);
  const el = document.getElementById('home-recent-games');
  if (!games.length) { el.innerHTML = '<p style="color:var(--text-dim);font-size:.9rem;">No games yet. Play one!</p>'; return; }
  el.innerHTML = games.map(g => gameCardHTML(g)).join('');
}

window.createClubFromHome = async function() {
  const clubName = document.getElementById('club-create-name')?.value?.trim();
  const joinPhrase = document.getElementById('club-create-phrase')?.value || '';
  if (!clubName || clubName.length < 2) return toast('Enter a club name (2+ characters)');
  if (joinPhrase.length < 4) return toast('Join phrase must be at least 4 characters');
  const displayName = (document.getElementById('profile-name')?.value || '').trim() || 'Owner';
  try {
    await ensureAnonymousAuth();
    const { clubId } = await cloudCreateClub({ clubName, joinPhrase, displayName });
    const p = await getProfile();
    p.clubId = clubId;
    await saveProfile(p);
    setActiveClub(clubId);
    const cur = document.getElementById('club-current-id');
    if (cur) cur.textContent = clubId;
    toast(`Club created! ID: ${clubId} — share this ID and the join phrase with members.`);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not create club (deploy Cloud Functions?)');
  }
};

window.joinClubFromHome = async function() {
  const clubId = document.getElementById('club-join-id')?.value?.trim().toUpperCase();
  const joinPhrase = document.getElementById('club-join-phrase')?.value || '';
  const displayName = (document.getElementById('profile-name')?.value || '').trim() || 'Member';
  if (!clubId || clubId.length < 4) return toast('Enter a club ID');
  if (joinPhrase.length < 4) return toast('Enter the join phrase');
  try {
    await ensureAnonymousAuth();
    await cloudJoinClub({ clubId, joinPhrase, displayName });
    const p = await getProfile();
    p.clubId = clubId;
    await saveProfile(p);
    setActiveClub(clubId);
    const cur = document.getElementById('club-current-id');
    if (cur) cur.textContent = clubId;
    toast('Joined club! Online play now uses this club.');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not join club');
  }
};

function gameCardHTML(g) {
  const icon  = g.result === 'draw' ? '🤝' : g.result === 'w' ? '♔' : '♚';
  const badge = g.myResult === 'win'  ? '<span class="game-badge badge-win">WIN</span>'
              : g.myResult === 'loss' ? '<span class="game-badge badge-loss">LOSS</span>'
              : '<span class="game-badge badge-draw">DRAW</span>';
  return `<div class="game-card" onclick="loadReview('${g.id}')">
    <span class="game-result">${icon}</span>
    <div class="game-meta">
      <div class="game-players">${g.white} vs ${g.black}</div>
      <div class="game-date">${new Date(g.date).toLocaleDateString()}</div>
    </div>
    ${badge}
  </div>`;
}

// ── Play Setup ────────────────────────────────────────────────

function hideAllPanels() {
  ['local-setup','computer-setup','create-room-panel','join-room-panel']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

window.showLocalSetup    = () => { hideAllPanels(); document.getElementById('local-setup').style.display = 'block'; };
window.showComputerSetup = async () => { hideAllPanels(); document.getElementById('computer-setup').style.display = 'block';
  const p = await getProfile(); if (p.name) document.getElementById('cpu-player-name').value = p.name; };
window.showCreateRoom    = async () => { hideAllPanels(); document.getElementById('create-room-panel').style.display = 'block';
  const p = await getProfile(); if (p.name) document.getElementById('host-name').value = p.name; };
window.showJoinRoom      = async () => { hideAllPanels(); document.getElementById('join-room-panel').style.display = 'block';
  const p = await getProfile(); if (p.name) document.getElementById('guest-name').value = p.name; };

window.setDifficulty = function(idx) {
  cpuDifficulty = idx;
  document.querySelectorAll('.diff-btn').forEach((b, i) => {
    b.className = i === idx ? 'btn btn-gold btn-sm diff-btn' : 'btn btn-surface btn-sm diff-btn';
  });
};

window.startGame = async function(mode) {
  gameMode = mode;
  let white = 'White', black = 'Black';
  let tcIdx = 4;

  if (mode === 'local') {
    white = document.getElementById('local-white').value.trim() || 'White';
    black = document.getElementById('local-black').value.trim() || 'Black';
    tcIdx = parseInt(document.getElementById('local-time-control').value);
    myColor = 'w';
  } else if (mode === 'cpu') {
    const name = document.getElementById('cpu-player-name').value.trim() || 'Player';
    let col = document.getElementById('cpu-player-color').value;
    if (col === 'r') col = Math.random() < 0.5 ? 'w' : 'b';
    myColor  = col;
    cpuColor = col === 'w' ? 'b' : 'w';
    white = col === 'w' ? name : `CPU (${DIFFICULTY_LEVELS[cpuDifficulty].label})`;
    black = col === 'b' ? name : `CPU (${DIFFICULTY_LEVELS[cpuDifficulty].label})`;
    tcIdx = parseInt(document.getElementById('cpu-time-control').value);
  }

  playerNames = { w: white, b: black };

  // Show ELO ratings next to names
  const wElo = await getPlayerRating(white); const bElo = await getPlayerRating(black);
  document.getElementById('elo-white').textContent = mode !== 'cpu' ? `${wElo.rating} ELO` : '';
  document.getElementById('elo-black').textContent = mode !== 'cpu' ? `${bElo.rating} ELO` : '';

  startClock(tcIdx);
  launchGame();
};

// ── Clock setup ───────────────────────────────────────────────

function startClock(tcIdx) {
  if (clock) clock.stop();
  const tc = TIME_CONTROLS[tcIdx];
  clock = new ChessClock(
    tc.minutes, tc.increment,
    times => updateTimerDisplay(times),
    loser  => handleTimeout(loser)
  );

  const showTimers = tc.minutes > 0;
  ['timer-white','timer-black'].forEach(id => {
    document.getElementById(id).style.display = showTimers ? 'inline' : 'none';
  });
  if (showTimers) updateTimerDisplay({ w: tc.minutes*60000, b: tc.minutes*60000 });
}

function updateTimerDisplay(times) {
  ['w','b'].forEach(c => {
    const el = document.getElementById(`timer-${c === 'w' ? 'white' : 'black'}`);
    if (!el) return;
    el.textContent = clock.getFormatted(c);
    el.classList.toggle('timer-low', clock.isLow(c));
    const isActive = clock.running && clock.active === c;
    el.classList.toggle('running', isActive);
    el.classList.toggle('idle', !isActive);
    // Also mark the parent bar as active
    const barId = c === 'w' ? 'bar-white' : 'bar-black';
    document.getElementById(barId)?.classList.toggle('active', isActive);
  });
}

function handleTimeout(loser) {
  if (!gameState) return;
  const winner = loser === 'w' ? 'b' : 'w';
  toast(`⏰ ${playerNames[loser]}'s time ran out! ${playerNames[winner]} wins!`);
  gameState.winner = winner;
  gameState.status = 'checkmate';
  updateStatus();
  void finalizeGame();
}

// ── Launch Game ───────────────────────────────────────────────

function launchGame(online = false) {
  gameState    = initGameState();
  selected     = null;
  hints        = [];
  lastMove     = null;
  pendingPreMove = null;
  annotations  = {};
  cpuThinking  = false;
  activeGameId = genId();

  document.getElementById('play-setup').style.display = 'none';
  document.getElementById('play-game').style.display  = 'block';
  document.getElementById('name-white').textContent   = playerNames.w;
  document.getElementById('name-black').textContent   = playerNames.b;
  document.getElementById('cpu-thinking').style.display = 'none';

  if (online) {
    document.getElementById('online-info').style.display = 'block';
    document.getElementById('active-room-code').textContent = roomCode;
    document.getElementById('chat-panel').style.display = 'block';
  } else {
    document.getElementById('online-info').style.display = 'none';
    document.getElementById('chat-panel').style.display  = 'none';
  }

  renderBoard();
  renderMoveList();
  updateStatus();
  _updateUndoBtn();

  // Start clock on first move (white)
  if (clock?.enabled) clock.start('w');

  // If playing as black vs CPU, let CPU move first
  if (gameMode === 'cpu' && cpuColor === 'w') scheduleCpuMove();
}

// ── Board Rendering ───────────────────────────────────────────

function renderBoard() {
  if (!gameState) return;
  const interactive = !(
    cpuThinking ||
    (gameMode === 'cpu' && gameState.turn === cpuColor) ||
    (gameMode !== 'local' && gameMode !== 'cpu' && gameState.turn !== myColor)
  );
  boardUI.render(gameState, {
    selected,
    hints,
    lastMove,
    preMove: pendingPreMove,
    capturedByTop:    _capturedBy(flipped ? 'w' : 'b'),
    capturedByBottom: _capturedBy(flipped ? 'b' : 'w'),
    flipped,
    interactive,
  });

  // Wire click handlers onto newly rendered squares
  const boardEl = document.getElementById('chessboard');
  boardEl.querySelectorAll('[data-r]').forEach(sq => {
    sq.addEventListener('click', () => onSquareClick(+sq.dataset.r, +sq.dataset.c));
  });
}

function renderCoords() {
  // Coordinate labels are now rendered inside the board squares by board-ui.js
}

window.flipBoard = function() { flipped = !flipped; _clearPreMove(); renderBoard(); };

// ── Square Click ──────────────────────────────────────────────

function onSquareClick(r, c) {
  if (!gameState || gameState.status==='checkmate' || gameState.status==='stalemate') return;
  if (cpuThinking) return;
  if (gameMode==='cpu' && gameState.turn===cpuColor) return;
  if (gameMode!=='local' && gameMode!=='cpu' && gameState.turn!==myColor) return;

  const piece = gameState.board[r][c];

  if (selected) {
    const isHint = hints.some(([hr,hc]) => hr===r && hc===c);
    if (isHint) {
      if (type(gameState.board[selected[0]][selected[1]])==='P' && (r===0||r===7)) {
        pendingPromo = { from: selected, to: [r,c] };
        document.getElementById('promo-modal').style.display = 'flex';
        return;
      }
      executeMove(selected, [r,c]);
      return;
    }
    selected = null; hints = [];
    if (piece && color(piece)===gameState.turn) { selected=[r,c]; hints=legalMoves(gameState,r,c); }
  } else {
    if (piece && color(piece)===gameState.turn) { selected=[r,c]; hints=legalMoves(gameState,r,c); }
  }
  renderBoard();
}

// ── Execute Move ──────────────────────────────────────────────

function executeMove(from, to, promotion = 'Q', opts = {}) {
  const movingColor = gameState.turn;
  const movingPiece = gameState.board[from[0]][from[1]];

  boardUI.animateMove(from, to, movingPiece, () => {
    gameState = makeMove(gameState, from, to, promotion);
    lastMove  = { from, to };
    selected  = null;
    hints     = [];

    // Switch clock
    if (clock?.enabled) clock.switch(movingColor);

    renderBoard();
    renderMoveList();
    updateStatus();
    _updateUndoBtn();
    void autoSave();

    if (gameMode !== 'local' && !opts.skipRelay) void sendMove(roomCode, { from, to, promotion });

    if (gameState.status==='checkmate'||gameState.status==='stalemate') {
      if (clock) { clock.stop(); updateTimerDisplay(clock.times); }
      setTimeout(() => void finalizeGame(), 400);
      return;
    }

    // CPU response
    if (gameMode==='cpu' && gameState.turn===cpuColor) scheduleCpuMove();

    opts.onDone?.();
  });
}

window.promote = function(piece) {
  document.getElementById('promo-modal').style.display = 'none';
  if (pendingPromo) { executeMove(pendingPromo.from, pendingPromo.to, piece); pendingPromo=null; }
};

// ── CPU Move ──────────────────────────────────────────────────

function scheduleCpuMove() {
  if (cpuThinking) return;
  cpuThinking = true;
  document.getElementById('cpu-thinking').style.display = 'block';

  getBestMoveAsync(gameState, cpuDifficulty).then(move => {
    cpuThinking = false;
    document.getElementById('cpu-thinking').style.display = 'none';
    if (!move || !gameState) return;
    executeMove(move.from, move.to);
  }).catch(err => {
    cpuThinking = false;
    document.getElementById('cpu-thinking').style.display = 'none';
    console.error('CPU move error:', err);
  });
}

// ── Remote moves ──────────────────────────────────────────────

function handleRemoteMove(moveData) {
  if (color(gameState.board[moveData.from[0]][moveData.from[1]]) === myColor) return;

  const pre = pendingPreMove;
  _clearPreMove();

  executeMove(moveData.from, moveData.to, moveData.promotion || 'Q', {
    skipRelay: true,
    onDone: () => {
      if (!pre || !gameState) return;
      const lm = legalMoves(gameState, pre.from[0], pre.from[1]);
      if (lm.some(([r, c]) => r === pre.to[0] && c === pre.to[1])) {
        executeMove(pre.from, pre.to);
      }
    },
  });
}

// ── Online rooms ──────────────────────────────────────────────

window.createOnlineRoom = async function() {
  const prof = await getProfile();
  if (!prof.clubId) return toast('Create or join a club on Home before online play.');
  setActiveClub(prof.clubId);

  const name = document.getElementById('host-name').value.trim() || 'Host';
  const tcIdx = parseInt(document.getElementById('online-time-control').value);
  roomCode = generateRoomCode();
  opponentUid = null;
  playerNames = { w: name, b: '...' };
  gameMode = 'online-host'; myColor = 'w';
  document.getElementById('room-code-display').style.display = 'block';
  document.getElementById('room-code-text').textContent = roomCode;
  let launched = false;
  try {
    await createRoom(roomCode, name);
    onOpponentJoin((guestName, guestUid) => {
      if (launched) return;
      launched = true;
      playerNames.b = guestName;
      opponentUid = guestUid;
      toast(`${guestName} joined!`);
      startClock(tcIdx);
      launchGame(true);
    });
    onMove(handleRemoteMove);
  } catch (e) {
    toast(e.message || 'Could not create room (Firebase rules / club?)');
    console.error(e);
  }
};

window.joinOnlineRoom = async function() {
  const prof = await getProfile();
  if (!prof.clubId) return toast('Create or join a club on Home before online play.');
  setActiveClub(prof.clubId);

  const name = document.getElementById('guest-name').value.trim() || 'Guest';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) return toast('Enter a 6-character room code');
  gameMode = 'online-guest'; myColor = 'b'; roomCode = code;
  try {
    const data = await joinRoom(code, name);
    opponentUid = data.hostUid || null;
    playerNames = { w: data.host, b: name };
    onMove(handleRemoteMove);
    const tcIdx = parseInt(document.getElementById('online-time-control').value);
    startClock(tcIdx);
    launchGame(true);
  } catch (e) {
    toast(e.message || 'Could not join room');
  }
};

window.copyRoomCode = () => { navigator.clipboard.writeText(roomCode); toast('Room code copied!'); };

// ── Status bar ────────────────────────────────────────────────

function updateStatus() {
  const el = document.getElementById('game-status');
  const { status, turn, winner } = gameState;
  el.className = 'status-bar ' + status;
  if (status==='checkmate') el.textContent = `♛ Checkmate! ${playerNames[winner]} wins!`;
  else if (status==='stalemate') el.textContent = `🤝 Stalemate — Draw!`;
  else if (status==='check') el.textContent = `⚠️ ${playerNames[turn]} is in Check!`;
  else if (status==='draw') el.textContent = `🤝 Draw (50-move rule)`;
  else el.textContent = `${playerNames[turn]}'s turn`;

  document.getElementById('bar-white').classList.toggle('active', turn==='w');
  document.getElementById('bar-black').classList.toggle('active', turn==='b');
}

// ── Move list ─────────────────────────────────────────────────

function renderMoveList() {
  const el = document.getElementById('move-list');
  const hist = gameState.history;
  let html = '';
  for (let i=0;i<hist.length;i+=2) {
    const wm=hist[i], bm=hist[i+1];
    html+=`<div class="move-pair">
      <span class="move-num">${i/2+1}.</span>
      <span class="move-san${i===hist.length-1?' active':''}">${moveSAN(wm)}</span>
      ${bm?`<span class="move-san${i+1===hist.length-1?' active':''}">${moveSAN(bm)}</span>`:''}
    </div>`;
  }
  el.innerHTML = html || '<span style="color:var(--text-dim)">No moves yet</span>';
  el.scrollTop = el.scrollHeight;
}

function moveSAN(m) {
  if (!m) return '';
  const files='abcdefgh', ranks='87654321';
  const t=type(m.piece), dest=files[m.to[1]]+ranks[m.to[0]];
  if (t==='P') return (m.captured||Math.abs(m.to[1]-m.from[1])===1) ? files[m.from[1]]+'x'+dest : dest;
  return t+(m.captured?'x':'')+dest;
}

// ── Game actions ──────────────────────────────────────────────

window.offerDraw = function() {
  if (!gameState) return;
  if (confirm('Accept a draw?')) { gameState.status='stalemate'; if(clock){clock.stop();updateTimerDisplay(clock.times);} void finalizeGame('draw'); }
};

window.resignGame = function() {
  if (!gameState||!confirm('Resign?')) return;
  const winner = gameState.turn==='w'?'b':'w';
  gameState.winner=winner; gameState.status='checkmate';
  if(clock){clock.stop();updateTimerDisplay(clock.times);}
  _clearPreMove();
  updateStatus(); void finalizeGame();
};

window.endAndSave = function() { void autoSave(true); toast('Game saved!'); backToSetup(); };

function backToSetup() {
  leaveRoomChannel();
  opponentUid = null;
  _clearPreMove();
  document.getElementById('play-setup').style.display='block';
  document.getElementById('play-game').style.display='none';
  hideAllPanels();
}

// ── Undo ──────────────────────────────────────────────────────

window.undoLastMove = function() {
  if (!gameState || gameState.history.length === 0) return;
  if (gameMode === 'online-host' || gameMode === 'online-guest') return;

  gameState = undoMove(gameState);
  if (gameMode === 'cpu' && gameState.history.length > 0 && gameState.turn === cpuColor) {
    gameState = undoMove(gameState); // also undo the CPU's reply
  }

  selected = null;
  hints    = [];
  lastMove = gameState.history.length > 0
    ? { from: gameState.history.at(-1).from, to: gameState.history.at(-1).to }
    : null;

  renderBoard();
  renderMoveList();
  updateStatus();
  _updateUndoBtn();
};

function _updateUndoBtn() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  const disabled = !gameState ||
    gameState.history.length === 0 ||
    gameMode === 'online-host' ||
    gameMode === 'online-guest';
  btn.disabled = disabled;
  btn.style.opacity = disabled ? '0.4' : '';
}

// ── ELO finalization ──────────────────────────────────────────

async function finalizeGame(forceResult) {
  const { status, winner } = gameState;
  let result = forceResult;
  if (!result) {
    if (status==='checkmate') result = winner;
    else result = 'draw';
  }

  await autoSave(true, result);

  if (gameMode==='cpu' || !result) {
    setTimeout(() => { showEloModal(null); }, 300);
    return;
  }

  if (gameMode === 'online-host' || gameMode === 'online-guest') {
    const profile = await getProfile();
    const clubId = profile.clubId;
    const wUid = gameMode === 'online-host' ? getCurrentUid() : opponentUid;
    const bUid = gameMode === 'online-guest' ? getCurrentUid() : opponentUid;
    if (clubId && wUid && bUid) {
      try {
        const eloResult = await cloudRecordOnlineGameResult({
          clubId,
          result,
          whiteUid: wUid,
          blackUid: bUid,
          whiteName: playerNames.w,
          blackName: playerNames.b,
          roomCode: roomCode || '',
        });
        setTimeout(() => showEloModal(eloResult, result), 300);
        return;
      } catch (e) {
        console.error(e);
        toast('Club ELO update failed — deploy Functions or check rules.');
      }
    }
    setTimeout(() => showEloModal(null, result, true), 300);
    return;
  }

  const eloResult = await updateRatingsAfterGame(playerNames.w, playerNames.b, result);
  setTimeout(() => showEloModal(eloResult, result), 300);
}

function showEloModal(eloResult, result, onlineFailed) {
  const modal = document.getElementById('elo-modal');
  const title = document.getElementById('elo-modal-title');
  const body  = document.getElementById('elo-modal-body');

  if (!eloResult) {
    const { status, winner } = gameState;
    title.textContent = status==='checkmate' ? `${playerNames[winner]} wins! 🎉`
                      : status==='stalemate' ? "Stalemate — Draw! 🤝" : "Game Over";
    if (onlineFailed) {
      body.innerHTML = `<p style="color:var(--text-dim);text-align:center;">Online club ratings were not updated. Deploy <code>functions/</code> and database rules, or verify both players are club members.</p>`;
    } else if (gameMode === 'cpu') {
      body.innerHTML = `<p style="color:var(--text-dim);text-align:center;">Computer games do not change ELO. Play a local two-player or online club game for ratings.</p>`;
    } else {
      body.innerHTML = `<p style="color:var(--text-dim);text-align:center;">Local ELO (this device) updates for same-device games. Online club ELO uses Firebase.</p>`;
    }
  } else {
    const wTitle = getRatingTitle(eloResult.newWhiteRating);
    const bTitle = getRatingTitle(eloResult.newBlackRating);
    const msg = result==='w' ? `${playerNames.w} wins! 🎉`
              : result==='b' ? `${playerNames.b} wins! 🎉`
              : "Draw! 🤝";
    title.textContent = msg;
    body.innerHTML = `
      <div style="display:flex;gap:1rem;justify-content:center;margin-bottom:1rem;">
        <div style="text-align:center;flex:1;">
          <div style="font-size:1.5rem;">${wTitle.icon}</div>
          <div style="font-weight:700;">${playerNames.w}</div>
          <div style="font-size:1.4rem;font-family:monospace;color:var(--gold);">${eloResult.newWhiteRating}</div>
          <div style="font-size:.85rem;color:${eloResult.changeA>=0?'var(--emerald)':'var(--red)'};">
            ${eloResult.changeA>=0?'+':''}${eloResult.changeA} ELO
          </div>
          <div style="font-size:.75rem;color:var(--text-dim);">${wTitle.title}</div>
        </div>
        <div style="text-align:center;flex:1;">
          <div style="font-size:1.5rem;">${bTitle.icon}</div>
          <div style="font-weight:700;">${playerNames.b}</div>
          <div style="font-size:1.4rem;font-family:monospace;color:var(--gold);">${eloResult.newBlackRating}</div>
          <div style="font-size:.85rem;color:${eloResult.changeB>=0?'var(--emerald)':'var(--red)'};">
            ${eloResult.changeB>=0?'+':''}${eloResult.changeB} ELO
          </div>
          <div style="font-size:.75rem;color:var(--text-dim);">${bTitle.title}</div>
        </div>
      </div>`;
  }

  modal.style.display = 'flex';
}

window.closeEloModal = async function() {
  document.getElementById('elo-modal').style.display = 'none';
  backToSetup();
  await renderHome();
};

// ── Auto-save ─────────────────────────────────────────────────

async function autoSave(final=false, result) {
  const profile = await getProfile();
  const myName  = profile.name||'Me';
  const r       = result || gameState.winner || (gameState.status==='stalemate'?'draw':null);

  const record = {
    id: activeGameId, white: playerNames.w, black: playerNames.b,
    date: new Date().toISOString(), result: r, moves: gameState.history,
    status: gameState.status, annotations,
    myResult: !r?null: r==='draw'?'draw':
      playerNames[r]?.toLowerCase()===myName.toLowerCase()?'win':'loss',
    mode: gameMode,
  };
  await saveGame(record);

  if (final && r) {
    const myRole = playerNames.w.toLowerCase()===myName.toLowerCase()?'w':'b';
    const myRes  = r==='draw'?'draw':r===myRole?'win':'loss';
    const p = await getProfile();
    if(myRes==='win') p.wins++; if(myRes==='loss') p.losses++; if(myRes==='draw') p.draws++;
    await saveProfile(p);
    await upsertPlayer(playerNames.w, r==='draw'?'draw':r==='w'?'win':'loss');
    await upsertPlayer(playerNames.b, r==='draw'?'draw':r==='b'?'win':'loss');
  }
}

// ── Chat ──────────────────────────────────────────────────────

window.sendChatMsg = function() {
  const input=document.getElementById('chat-input');
  const text=input.value.trim();
  if(!text||!roomCode) return;
  const sender=gameMode==='online-host'?playerNames.w:playerNames.b;
  sendChat(roomCode,sender,text);
  appendChat(sender,text);
  input.value='';
};

function appendChat(sender, text) {
  const box = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'sender';
  nameSpan.textContent = sender + ':';
  msg.appendChild(nameSpan);
  msg.append(' ' + text);
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

// ── Review ────────────────────────────────────────────────────

async function renderReviewList() {
  const games = await getGames();
  const el=document.getElementById('review-games-list');
  if(!games.length){el.innerHTML='<p style="color:var(--text-dim);">No saved games yet.</p>';return;}
  el.innerHTML=games.map(g=>gameCardHTML(g)).join('');
}

window.loadReview = async function(id) {
  reviewGame = await getGame(id); if(!reviewGame) return;
  reviewIdx=reviewGame.moves.length;
  // Refresh the Analyze button label if cached analysis exists.
  const btn = document.getElementById('analyze-game-btn');
  if (reviewGame.analysis) {
    btn.textContent = `⚙️ Re-analyze (was depth ${reviewGame.analysis.depth})`;
    renderEvalGraphForGame();
  } else {
    btn.textContent = '⚙️ Analyze game';
    document.getElementById('eval-graph-container').hidden = true;
  }
  document.getElementById('review-list').style.display='none';
  document.getElementById('review-board-view').style.display='block';
  renderReviewBoard(); renderReviewMoveList();
};

window.backToList = async function() {
  cancelEngine();
  document.getElementById('review-list').style.display='block';
  document.getElementById('review-board-view').style.display='none';
  await renderReviewList();
};

// ── Engine eval (cloud → local fallback via engine/analysis.js) ───

function initEngineSettingsStrip() {
  const chips = document.querySelectorAll('.depth-chip');
  const slider = document.getElementById('depth-slider');
  const sliderWrap = document.getElementById('depth-slider-wrap');
  const sliderVal = document.getElementById('depth-slider-val');

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const v = chip.dataset.depth;
      if (v === 'custom') {
        sliderWrap.hidden = false;
        engineDepth = Number(slider.value);
      } else {
        sliderWrap.hidden = true;
        engineDepth = Number(v);
      }
      if (reviewGame) refreshEngineForCurrentPosition();
    });
  });

  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
    engineDepth = Number(slider.value);
    if (reviewGame && document.getElementById('depth-custom-toggle').classList.contains('active')) {
      refreshEngineForCurrentPosition();
    }
  });
}

async function fetchEngineEval(fen) {
  const evalEl   = document.getElementById('engine-eval');
  const linesEl  = document.getElementById('engine-lines');
  const depthEl  = document.getElementById('engine-depth');
  const statusEl = document.getElementById('engine-status');
  const sourceEl = document.getElementById('engine-source');

  evalEl.textContent  = '…';
  evalEl.style.color  = 'var(--text-dim)';
  linesEl.innerHTML   = '';
  depthEl.textContent = '';
  statusEl.textContent = '';

  let result;
  try {
    result = await analyzePosition(fen, { depth: engineDepth, multiPV: 3 });
  } catch (e) {
    if (e?.name === 'AbortError') return;
    statusEl.textContent = "Engine couldn't load. Reconnect and try again.";
    evalEl.textContent = '—';
    // Disable the Analyze button when the engine can't load.
    const analyzeBtn = document.getElementById('analyze-game-btn');
    if (analyzeBtn) analyzeBtn.disabled = true;
    return;
  }

  if (result.reason === 'terminal' || !result.pvs.length) {
    evalEl.textContent = '—';
    return;
  }

  // Source badge
  sourceEl.textContent = result.source === 'cloud' ? 'Cloud' : 'Local';
  sourceEl.className = `engine-source ${result.source}`;
  engineSource = result.source;

  depthEl.textContent = `depth ${result.reachedDepth}`;
  const top = result.pvs[0];
  if (top.mate != null) {
    const m = top.mate;
    evalEl.textContent = m > 0 ? `M${m}` : `-M${Math.abs(m)}`;
    evalEl.style.color = m > 0 ? 'var(--emerald)' : 'var(--red)';
  } else {
    const cp = top.cp / 100;
    evalEl.textContent = (cp >= 0 ? '+' : '') + cp.toFixed(2);
    evalEl.style.color = cp > 0.3 ? 'var(--emerald)' : cp < -0.3 ? 'var(--red)' : 'var(--text)';
  }

  // PV lines — DOM-built (no innerHTML).
  while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
  for (const pv of result.pvs) {
    const row = document.createElement('div');
    const score = document.createElement('span');
    score.style.color = 'var(--gold)';
    score.style.display = 'inline-block';
    score.style.minWidth = '3.5rem';
    score.textContent = pv.mate != null
      ? (pv.mate > 0 ? `M${pv.mate}` : `-M${Math.abs(pv.mate)}`)
      : ((pv.cp >= 0 ? '+' : '') + (pv.cp / 100).toFixed(2));
    row.appendChild(score);
    row.appendChild(document.createTextNode(pv.moves.split(' ').slice(0, 6).join(' ')));
    linesEl.appendChild(row);
  }
}

function refreshEngineForCurrentPosition() {
  if (!reviewGame) return;
  // The existing renderReviewBoard() already calls fetchEngineEval with the
  // current FEN. Re-rendering is the simplest re-trigger.
  renderReviewBoard();
}

window.runAnalyzeGame = async function() {
  if (!reviewGame) return;
  const btn          = document.getElementById('analyze-game-btn');
  const progressWrap = document.getElementById('analyze-progress');
  const progressFill = document.getElementById('analyze-progress-fill');
  const progressLabel= document.getElementById('analyze-progress-label');

  // Confirmation if depth >= 20.
  if (engineDepth >= 20) {
    const cores = navigator.hardwareConcurrency || 2;
    const warn = cores <= 2
      ? `Full-game analysis at depth ${engineDepth} may take 10+ minutes on this device. Continue?`
      : `Full-game analysis at depth ${engineDepth} will take several minutes. Continue?`;
    if (!confirm(warn)) return;
  }

  const fullGameDepth = engineDepth >= 20 ? engineDepth : 14;  // lighter default per spec
  btn.disabled = true;
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Starting…';

  let result;
  try {
    result = await analyzeGame(reviewGame.moves, { depth: fullGameDepth }, (p) => {
      const pct = ((p.index + 1) / p.total) * 100;
      progressFill.style.width = pct.toFixed(1) + '%';
      progressLabel.textContent = `Move ${p.index}/${p.total - 1}`;
    });
  } catch (e) {
    progressLabel.textContent = 'Analysis cancelled';
    btn.disabled = false;
    setTimeout(() => { progressWrap.hidden = true; }, 1500);
    return;
  }

  // Persist on the game record.
  reviewGame.analysis = result;
  await saveGame(reviewGame);

  renderEvalGraphForGame();
  renderReviewMoveList();
  progressWrap.hidden = true;
  btn.disabled = false;
};

function renderEvalGraphForGame() {
  const container = document.getElementById('eval-graph-container');
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!reviewGame?.analysis?.evals?.length) { container.hidden = true; return; }
  const svg = renderEvalGraph(reviewGame.analysis.evals, {
    onClick: (idx) => { reviewIdx = idx; renderReviewBoard(); renderReviewMoveList(); },
  });
  container.appendChild(svg);
  container.hidden = false;
}

window.reviewNav = function(dir) {
  if(!reviewGame)return;
  const max=reviewGame.moves.length;
  if(dir==='start') reviewIdx=0; if(dir==='end') reviewIdx=max;
  if(dir==='prev')  reviewIdx=Math.max(0,reviewIdx-1);
  if(dir==='next')  reviewIdx=Math.min(max,reviewIdx+1);
  renderReviewBoard(); renderReviewMoveList();
};

function renderReviewBoard() {
  const board=document.getElementById('review-board');
  board.innerHTML='';
  let state=initGameState();
  for(let i=0;i<reviewIdx;i++){const m=reviewGame.moves[i];state=makeMove(state,m.from,m.to,m.promotion||'Q');}
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const sq=document.createElement('div');
    sq.className=`sq ${(r+c)%2===0?'light':'dark'}`;
    const piece=state.board[r][c]; if(piece) { sq.textContent=PIECES[piece]; sq.dataset.pieceColor=piece[0]; }
    board.appendChild(sq);
  }
  document.getElementById('annotation-text').value=(reviewGame.annotations||{})[reviewIdx]||'';
  fetchEngineEval(toFen(state));
}

function renderReviewMoveList() {
  const el=document.getElementById('review-move-list');
  const moves=reviewGame.moves; let html='';
  for(let i=0;i<moves.length;i+=2){
    const wm=moves[i],bm=moves[i+1];
    html+=`<div class="move-pair"><span class="move-num">${i/2+1}.</span>
      <span class="move-san${reviewIdx===i+1?' active':''}" onclick="jumpReview(${i+1})">${moveSAN(wm)}</span>
      ${bm?`<span class="move-san${reviewIdx===i+2?' active':''}" onclick="jumpReview(${i+2})">${moveSAN(bm)}</span>`:''}
    </div>`;
  }
  el.innerHTML=html||'<span style="color:var(--text-dim)">No moves</span>';
}

window.jumpReview  = function(idx){reviewIdx=idx;renderReviewBoard();renderReviewMoveList();};
window.saveAnnotation = async function(){if(!reviewGame)return;reviewGame.annotations=reviewGame.annotations||{};reviewGame.annotations[reviewIdx]=document.getElementById('annotation-text').value.trim();await saveGame(reviewGame);toast('Annotation saved ✅');};
window.exportCurrentGame = function(){if(!reviewGame)return;downloadPGN({white:reviewGame.white,black:reviewGame.black,result:reviewGame.result==='w'?'1-0':reviewGame.result==='b'?'0-1':'1/2-1/2',date:reviewGame.date?.slice(0,10),moves:reviewGame.moves},`${reviewGame.white}-vs-${reviewGame.black}.pgn`);};
window.deleteCurrentGame = async function(){if(!reviewGame||!confirm('Delete this game?'))return;await deleteGame(reviewGame.id);await backToList();toast('Game deleted');};

// ── Tournament ────────────────────────────────────────────────

window.showNewTournament = ()=>{ document.getElementById('new-tournament-form').style.display='block'; updatePlayerFields(); };
window.hideNewTournament = ()=>{ document.getElementById('new-tournament-form').style.display='none'; };
document.getElementById('t-size')?.addEventListener('change', updatePlayerFields);

function updatePlayerFields() {
  const size=parseInt(document.getElementById('t-size')?.value||4);
  const container=document.getElementById('t-player-fields');
  if(!container) return;
  container.innerHTML='';
  for(let i=0;i<size;i++) container.innerHTML+=`<div class="field"><label>Player ${i+1}</label><input type="text" class="t-player" placeholder="Name..." maxlength="20" /></div>`;
}

window.createTournamentNow = async function() {
  const name=document.getElementById('t-name').value.trim()||'Tournament';
  const inputs=[...document.querySelectorAll('.t-player')];
  const players=inputs.map(i=>i.value.trim()).filter(Boolean);
  if(players.length!==inputs.length) return toast('Fill in all player names');
  try{
    const t=createTournament(name,players);
    await saveTournament(t);
    hideNewTournament();
    await renderTournaments();
    toast(`Tournament "${name}" created! 🏆`);
  }
  catch(e){toast(e.message);}
};

async function renderTournaments() {
  const list = await getTournaments();
  const el=document.getElementById('tournament-list');
  if(!list.length){el.innerHTML='<p style="color:var(--text-dim)">No tournaments yet.</p>';return;}
  el.innerHTML=list.map(t=>{
    const summary=getBracketSummary(t);
    return `<div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h2 style="margin:0;">🏆 ${t.name}</h2>
        <span style="font-size:.8rem;color:var(--text-dim);">${t.status==='complete'?`👑 Winner: ${t.winner}`:'In Progress'}</span>
      </div>
      <div class="bracket">${summary.map(r=>`
        <div class="bracket-round">
          <div class="bracket-round-label">${r.label}</div>
          ${r.matches.map(m=>`<div class="bracket-match">
            <div class="bracket-player ${m.result==='white'?'winner':''} ${!m.white?'pending':''}">${m.white||'TBD'}</div>
            <div class="bracket-player ${m.result==='black'?'winner':''} ${!m.black?'pending':''}">${m.black||'TBD'}</div>
            ${m.status==='ready'&&t.status!=='complete'?`<div style="padding:.4rem;display:flex;gap:.25rem;justify-content:center;">
              <button class="btn btn-gold btn-sm"    onclick="recordTournamentResult('${t.id}','${m.id}','white')">W</button>
              <button class="btn btn-outline btn-sm" onclick="recordTournamentResult('${t.id}','${m.id}','draw')">D</button>
              <button class="btn btn-surface btn-sm" onclick="recordTournamentResult('${t.id}','${m.id}','black')">B</button>
            </div>`:''}
          </div>`).join('')}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

window.recordTournamentResult = async function(tId,matchId,result) {
  const list = await getTournaments();
  let t=list.find(x=>x.id===tId); if(!t)return;
  let ri=-1,mi=-1;
  t.rounds.forEach((r,rIdx)=>r.matches.forEach((m,mIdx)=>{if(m.id===matchId){ri=rIdx;mi=mIdx;}}));
  if(ri<0) return;
  t=recordResult(t,ri,mi,result);
  await saveTournament(t);
  await renderTournaments();
  if(t.status==='complete'){toast(`🎉 Winner: ${t.winner}`);await upsertPlayer(t.winner,'win');}
};

async function renderClubEloBoard() {
  const card = document.getElementById('club-elo-card');
  const body = document.getElementById('club-elo-body');
  if (!card || !body) return;
  const p = await getProfile();
  if (!p.clubId) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  try {
    await ensureAnonymousAuth();
    const rows = await fetchClubRatings(p.clubId);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" style="color:var(--text-dim);text-align:center;padding:1rem;">No online club games recorded yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r, i) => {
      const { title, icon, color: tc } = getRatingTitle(r.rating || 800);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
      const games = (r.wins || 0) + (r.losses || 0) + (r.draws || 0);
      return `<tr><td>${medal}</td><td style="font-weight:600;">${escapeHtml(r.name || r.uid?.slice(0, 8) || '?')}</td>
        <td><span style="font-size:.8rem;">${icon}</span> <span style="color:${tc};font-size:.8rem;">${title}</span></td>
        <td style="font-weight:700;font-family:monospace;">${r.rating ?? 800}</td>
        <td style="color:var(--emerald);">${r.wins || 0}</td>
        <td style="color:#ef4444;">${r.losses || 0}</td>
        <td style="color:var(--text-dim);">${r.draws || 0}</td>
        <td style="color:var(--text-dim);">${games}</td></tr>`;
    }).join('');
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="8" style="color:var(--text-dim);text-align:center;padding:1rem;">Could not load club ratings (rules / auth).</td></tr>';
  }
}

// ── Leaderboard ───────────────────────────────────────────────

window.switchTab = async function(tab) {
  document.getElementById('lb-elo').style.display  = tab==='elo'  ? 'block' : 'none';
  document.getElementById('lb-wins').style.display = tab==='wins' ? 'block' : 'none';
  document.getElementById('tab-elo').className  = tab==='elo'  ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
  document.getElementById('tab-wins').className = tab==='wins' ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
  if (tab === 'elo') await renderClubEloBoard();
};

async function renderLeaderboard() {
  const players = await getLeaderboard();
  const body=document.getElementById('leaderboard-body');
  if(!players.length){body.innerHTML='<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:1rem;">No players yet</td></tr>';return;}
  body.innerHTML=players.map((p,i)=>{
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;
    const games=p.wins+p.losses+p.draws;
    return `<tr><td class="${rc}">${medal}</td><td>${p.name}</td>
      <td class="${rc}" style="font-weight:700;">${p.wins+p.draws*.5}</td>
      <td style="color:var(--emerald);">${p.wins}</td>
      <td style="color:#ef4444;">${p.losses}</td>
      <td style="color:var(--text-dim);">${p.draws}</td>
      <td style="color:var(--text-dim);">${games}</td></tr>`;
  }).join('');
}

async function renderEloLeaderboard() {
  const players = await getEloLeaderboard();
  const body=document.getElementById('elo-body');
  if(!players.length){body.innerHTML='<tr><td colspan="8" style="color:var(--text-dim);text-align:center;padding:1rem;">No ELO data yet — play some rated games!</td></tr>';return;}
  body.innerHTML=players.map((p,i)=>{
    const {title,icon,color:tc}=getRatingTitle(p.rating);
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;
    const games=p.gamesPlayed;
    return `<tr><td class="${rc}">${medal}</td><td style="font-weight:600;">${p.name}</td>
      <td><span style="font-size:.8rem;">${icon}</span> <span style="color:${tc};font-size:.8rem;">${title}</span></td>
      <td class="${rc}" style="font-weight:700;font-family:monospace;">${p.rating}</td>
      <td style="color:var(--emerald);">${p.wins}</td>
      <td style="color:#ef4444;">${p.losses}</td>
      <td style="color:var(--text-dim);">${p.draws}</td>
      <td style="color:var(--text-dim);">${games}</td></tr>`;
  }).join('');
}

// ── Toast ──────────────────────────────────────────────────────

function toast(msg) {
  const el=document.createElement('div'); el.className='toast'; el.textContent=msg;
  document.body.appendChild(el); setTimeout(()=>el.remove(),3000);
}
window.toast=toast;

// ── Boot ──────────────────────────────────────────────────────

initUI().catch(err => { console.error(err); toast('App init failed — check console'); });
