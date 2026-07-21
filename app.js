// ---------- State ----------
let DATA = null;
let view = { mode: 'root', bubble: null, subtopic: null }; // mode: 'root' | 'subtopics'
let particles = []; // {el, x, y, vx, vy, r, kind, ref}
let mouse = { x: -9999, y: -9999 };
let lastShownWindowId = null;
let animFrame = null;

const field = document.getElementById('bubble-field');
const backBtn = document.getElementById('back-button');
const backLabel = document.getElementById('back-label');

// ---------- Load data ----------
fetch('data.json')
  .then(r => r.json())
  .then(data => {
    DATA = data;
    document.getElementById('loading').style.display = 'none';
    renderStatLine(data.meta);
    buildSpecialBubbles(data);
    renderRoot();
  })
  .catch(err => {
    document.getElementById('loading').textContent =
      'Could not load data.json — make sure you are running a local server (see README) and data.json is in this folder.';
    console.error(err);
  });

function renderStatLine(meta) {
  const start = new Date(meta.start_date);
  const end = new Date(meta.end_date);
  const years = ((end - start) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
  document.getElementById('stat-line').textContent =
    `${years} years together · ${meta.total_messages.toLocaleString()} messages · ${meta.senders.join(' & ')}`;
}

// Fold significant_moments into synthetic "bubbles" with a flat window_ids list
// (no subtopic step — clicking them jumps straight to the excerpt view).
function buildSpecialBubbles(data) {
  const specials = [];
  const labels = {
    arguments: { emoji: '💥', name: 'Arguments' },
    cherished_moments: { emoji: '💛', name: 'Moments We Cherish' },
  };
  for (const [category, items] of Object.entries(data.significant_moments || {})) {
    if (!items || !items.length) continue;
    const meta = labels[category] || { emoji: '⭐', name: category };
    specials.push({
      id: `special-${category}`,
      emoji: meta.emoji,
      name: meta.name,
      count: items.length,
      special: true,
      window_ids: items.map(it => it.window_id),
    });
  }
  data.bubbles = [...specials, ...data.bubbles];
}

// ---------- Physics ----------
function sizeScale(count, minCount, maxCount, minR, maxR) {
  if (maxCount === minCount) return (minR + maxR) / 2;
  const t = (Math.sqrt(count) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
  return minR + t * (maxR - minR);
}

function clearField() {
  field.innerHTML = '';
  particles = [];
}

function makeBubbleEl(item, radius, extraClass) {
  const el = document.createElement('div');
  el.className = 'bubble' + (extraClass ? ' ' + extraClass : '');
  el.style.width = radius * 2 + 'px';
  el.style.height = radius * 2 + 'px';
  el.style.setProperty('--emoji-size', Math.max(16, radius * 0.5) + 'px');
  el.style.setProperty('--label-size', Math.max(9, Math.min(13, radius * 0.16)) + 'px');

  const emoji = document.createElement('div');
  emoji.className = 'emoji';
  emoji.textContent = item.emoji;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = item.name;

  el.appendChild(emoji);
  el.appendChild(label);
  return el;
}

function renderRoot() {
  view = { mode: 'root', bubble: null, subtopic: null };
  backBtn.classList.remove('visible');
  clearField();

  const bubbles = DATA.bubbles;
  const counts = bubbles.map(b => b.count);
  const minCount = Math.min(...counts), maxCount = Math.max(...counts);
  const fieldRect = field.getBoundingClientRect();

  bubbles.forEach((b) => {
    const r = sizeScale(b.count, minCount, maxCount, 42, 130);
    const extra = b.special ? 'special' : '';
    const el = makeBubbleEl(b, r, extra);
    field.appendChild(el);

    const x = Math.random() * (fieldRect.width - 2 * r) + r;
    const y = Math.random() * (fieldRect.height - 2 * r - 140) + r + 120;

    const p = {
      el, x, y,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      r, kind: 'bubble', ref: b,
    };
    particles.push(p);

    el.addEventListener('click', () => onBubbleClick(b));
  });

  startPhysics();
}

function renderSubtopics(bubble) {
  view = { mode: 'subtopics', bubble, subtopic: null };
  backBtn.classList.add('visible');
  backLabel.textContent = bubble.name;
  clearField();

  const subs = bubble.subtopics;
  const counts = subs.map(s => s.count);
  const minCount = Math.min(...counts), maxCount = Math.max(...counts);
  const fieldRect = field.getBoundingClientRect();
  const cx = fieldRect.width / 2, cy = fieldRect.height / 2 + 20;
  const orbitR = Math.min(fieldRect.width, fieldRect.height) * 0.32;

  subs.forEach((s, i) => {
    const r = sizeScale(s.count, minCount, maxCount, 38, 100);
    const el = makeBubbleEl(s, r, 'subtopic');
    field.appendChild(el);

    const angle = (i / subs.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * orbitR;
    const y = cy + Math.sin(angle) * orbitR;

    const p = {
      el, x, y,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      r, kind: 'subtopic', ref: s,
    };
    particles.push(p);

    el.addEventListener('click', () => onSubtopicClick(s));
  });

  startPhysics();
}

function onBubbleClick(bubble) {
  if (bubble.special || (bubble.window_ids && bubble.window_ids.length)) {
    lastShownWindowId = null;
    showExcerpt(bubble.window_ids);
    return;
  }
  renderSubtopics(bubble);
}

function onSubtopicClick(subtopic) {
  lastShownWindowId = null;
  showExcerpt(subtopic.window_ids);
}

backBtn.addEventListener('click', () => {
  if (view.mode === 'subtopics') renderRoot();
});

// ---------- Physics loop ----------
function startPhysics() {
  if (animFrame) cancelAnimationFrame(animFrame);
  const fieldRect = field.getBoundingClientRect();

  function tick() {
    for (const p of particles) {
      // gentle random jitter
      p.vx += (Math.random() - 0.5) * 0.012;
      p.vy += (Math.random() - 0.5) * 0.012;

      // mouse repel
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const repelRadius = 110;
      if (dist < repelRadius && dist > 0.01) {
        const force = (1 - dist / repelRadius) * 0.6;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }

      // speed clamp
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const maxSpeed = 0.5;
      if (speed > maxSpeed) { p.vx = (p.vx / speed) * maxSpeed; p.vy = (p.vy / speed) * maxSpeed; }

      p.x += p.vx;
      p.y += p.vy;

      // bounce off edges (keep clear of header)
      const minY = 120, maxY = fieldRect.height - p.r;
      const minX = p.r, maxX = fieldRect.width - p.r;
      if (p.x < minX) { p.x = minX; p.vx *= -0.6; }
      if (p.x > maxX) { p.x = maxX; p.vx *= -0.6; }
      if (p.y < minY) { p.y = minY; p.vy *= -0.6; }
      if (p.y > maxY) { p.y = maxY; p.vy *= -0.6; }

      p.el.style.transform = `translate3d(${p.x - p.r}px, ${p.y - p.r}px, 0)`;
    }
    animFrame = requestAnimationFrame(tick);
  }
  tick();
}

document.addEventListener('mousemove', (e) => {
  const rect = field.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});
document.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

window.addEventListener('resize', () => {
  if (view.mode === 'root') renderRoot();
  else if (view.mode === 'subtopics') renderSubtopics(view.bubble);
});

// ---------- Excerpt panel ----------
const overlay = document.getElementById('excerpt-overlay');
const excerptTitle = document.getElementById('excerpt-title');
const excerptDate = document.getElementById('excerpt-date');
const excerptBody = document.getElementById('excerpt-body');
const shuffleBtn = document.getElementById('shuffle-btn');
const closeBtn = document.getElementById('excerpt-close');

let currentWindowIds = [];

function showExcerpt(windowIds) {
  currentWindowIds = windowIds;
  const wid = pickWindowId(windowIds);
  renderExcerptCard(wid);
  overlay.classList.add('visible');
}

function pickWindowId(windowIds) {
  if (windowIds.length === 1) return windowIds[0];
  let choice;
  let attempts = 0;
  do {
    choice = windowIds[Math.floor(Math.random() * windowIds.length)];
    attempts++;
  } while (choice === lastShownWindowId && attempts < 10);
  lastShownWindowId = choice;
  return choice;
}

function renderExcerptCard(windowId) {
  const w = DATA.windows[String(windowId)];
  if (!w) return;

  const senders = DATA.meta.senders;
  const dateObj = new Date(w.start_ts);
  excerptDate.textContent = dateObj.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  excerptTitle.textContent = 'A moment from your chat';

  excerptBody.innerHTML = '';
  const lines = parseTranscript(w.text);
  lines.forEach(line => {
    const row = document.createElement('div');
    const side = line.sender === senders[0] ? 'a' : 'b';
    row.className = 'msg-row ' + side;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const textNode = document.createElement('div');
    textNode.textContent = line.text || (line.attachment ? '' : '');
    if (line.text) bubble.appendChild(textNode);

    if (line.attachment) {
      const media = document.createElement('div');
      media.className = 'msg-media';
      const ext = line.attachment.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        const img = document.createElement('img');
        img.src = 'media/' + line.attachment;
        img.alt = 'shared photo';
        img.onerror = () => { media.textContent = '📷 ' + line.attachment; };
        media.appendChild(img);
      } else if (['mp4', 'mov'].includes(ext)) {
        const vid = document.createElement('video');
        vid.src = 'media/' + line.attachment;
        vid.controls = true;
        vid.onerror = () => { media.textContent = '🎬 ' + line.attachment; };
        media.appendChild(vid);
      } else {
        media.textContent = '📎 ' + line.attachment;
      }
      bubble.appendChild(media);
    }

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = line.time;
    bubble.appendChild(time);

    row.appendChild(bubble);
    excerptBody.appendChild(row);
  });
}

// Parses lines like:
//   [HH:MM] Sender Name: message text
//   [HH:MM] Sender Name: message text (attached: filename.jpg)
//   [HH:MM] Sender Name: (attached: filename.jpg)
// Multi-line messages (continuation lines with no [HH:MM] prefix) get folded into
// the previous line's text.
function parseTranscript(text) {
  const lineRe = /^\[(\d{2}:\d{2})\]\s([^:]+):\s?(.*)$/;
  const attachRe = /\(attached:\s*([^)]+)\)\s*$/;

  const raw = text.split('\n');
  const parsed = [];

  for (const rawLine of raw) {
    const m = rawLine.match(lineRe);
    if (m) {
      let [, time, sender, rest] = m;
      let attachment = null;
      const am = rest.match(attachRe);
      if (am) {
        attachment = am[1].trim();
        rest = rest.replace(attachRe, '').trim();
      }
      parsed.push({ time, sender: sender.trim(), text: rest, attachment });
    } else if (parsed.length) {
      parsed[parsed.length - 1].text += (parsed[parsed.length - 1].text ? '\n' : '') + rawLine;
    }
  }
  return parsed;
}

shuffleBtn.addEventListener('click', () => {
  const wid = pickWindowId(currentWindowIds);
  renderExcerptCard(wid);
});

closeBtn.addEventListener('click', () => overlay.classList.remove('visible'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('visible'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('visible'); });

// expose for testing in Node (no-op in browser)
if (typeof module !== 'undefined') { module.exports = { parseTranscript, sizeScale }; }