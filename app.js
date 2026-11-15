(() => {
  const body = document.body;
  const deck = document.querySelector('[data-deck]');
  const cards = [...deck.querySelectorAll('.card')];
  const empty = deck.querySelector('[data-deck-empty]');
  const undoBtn = document.querySelector('[data-act="undo"]');
  const announce = document.querySelector('[data-announce]');
  const matchList = document.querySelector('[data-matches]');
  const matchCount = document.querySelector('[data-match-count]');
  const matchesEmpty = document.querySelector('[data-matches-empty]');
  const dialog = document.querySelector('[data-match-dialog]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const THRESHOLD = 110; // px of drag that commits a swipe
  let index = 0; // first card still in the deck
  const past = []; // [{ card, dir }]
  const matched = new Set();

  /* views: the cover and the swipe screen */
  const show = (view, push = true) => {
    body.dataset.view = view;
    if (push && location.hash !== '#' + view) window.history.pushState(null, '', '#' + view);
    window.scrollTo(0, 0);
    if (view === 'deck') deck.focus({ preventScroll: true });
  };
  document.querySelectorAll('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.go); })
  );
  window.addEventListener('popstate', () => show(location.hash === '#deck' ? 'deck' : 'cover', false));
  show(location.hash === '#deck' ? 'deck' : 'cover', false);

  /* layout of the stack */
  const layout = () => {
    cards.forEach((c, i) => {
      if (c.classList.contains('is-flying')) return;
      if (i < index) { c.dataset.pos = 'gone'; c.style.transform = ''; }
      else c.dataset.pos = String(i - index);
      c.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    });
    deck.classList.toggle('is-done', index >= cards.length);
    undoBtn.disabled = past.length === 0;
  };

  const setStamps = (card, dx) => {
    const t = Math.max(-1, Math.min(1, dx / THRESHOLD));
    card.style.setProperty('--like', t > 0 ? t.toFixed(2) : 0);
    card.style.setProperty('--nope', t < 0 ? (-t).toFixed(2) : 0);
  };

  const name = (card) => card.querySelector('.card__name').firstChild.textContent.trim();

  const addMatch = (card) => {
    if (matched.has(card)) return;
    matched.add(card);
    const li = document.createElement('li');
    li.dataset.dog = card.dataset.dog;
    const img = card.querySelector('img');
    li.innerHTML = `<img src="${img.getAttribute('src')}" alt="" style="object-position:${img.style.objectPosition}"><span>${name(card)}</span>`;
    matchList.prepend(li);
    syncMatches();
  };
  const removeMatch = (card) => {
    if (!matched.delete(card)) return;
    matchList.querySelector(`[data-dog="${card.dataset.dog}"]`)?.remove();
    syncMatches();
  };
  const syncMatches = () => {
    matchCount.textContent = matched.size;
    matchesEmpty.hidden = matched.size > 0;
  };

  const openMatch = (card) => {
    const img = card.querySelector('img');
    const fig = dialog.querySelector('[data-match-photo]');
    const m = fig.querySelector('img') || fig.appendChild(document.createElement('img'));
    m.src = img.getAttribute('src');
    m.alt = img.alt;
    m.style.objectPosition = img.style.objectPosition;
    dialog.querySelector('[data-match-text]').textContent = `${name(card)} liked you back. Time to plan a walk.`;
    dialog.showModal();
  };
  dialog.addEventListener('close', () => deck.focus({ preventScroll: true }));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* a swipe, by drag, button or key */
  const swipe = (dir) => {
    const card = cards[index];
    if (!card || dialog.open) return;
    const sign = dir === 'like' ? 1 : -1;
    const w = Math.max(window.innerWidth, 800);
    card.classList.remove('is-dragging');
    card.classList.add('is-flying');
    setStamps(card, sign * THRESHOLD);
    card.style.transform = `translate(${sign * w}px, ${card._dy || 0}px) rotate(${sign * 28}deg)`;
    index += 1;
    past.push({ card, dir });
    layout();
    const done = () => {
      card.classList.remove('is-flying');
      card.dataset.pos = 'gone';
      card.style.transform = '';
      setStamps(card, 0);
    };
    setTimeout(done, reduced.matches ? 0 : 420);
    announce.textContent = `${dir === 'like' ? 'Liked' : 'Passed on'} ${name(card)}.`;
    if (dir === 'like' && card.dataset.match === 'true') {
      addMatch(card);
      setTimeout(() => openMatch(card), reduced.matches ? 0 : 320);
    }
  };

  const undo = () => {
    const last = past.pop();
    if (!last) return;
    removeMatch(last.card);
    index -= 1;
    layout();
    announce.textContent = `${name(last.card)} is back.`;
  };

  /* dragging the top card */
  let drag = null;
  deck.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card');
    if (!card || card !== cards[index] || e.button > 0) return;
    drag = { card, x: e.clientX, y: e.clientY, id: e.pointerId };
    card.setPointerCapture(e.pointerId);
    card.classList.add('is-dragging');
  });
  deck.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = (e.clientY - drag.y) * 0.4;
    drag.card._dy = dy;
    drag.card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.06}deg)`;
    setStamps(drag.card, dx);
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { card } = drag;
    const dx = e.clientX - drag.x;
    drag = null;
    card.classList.remove('is-dragging');
    if (Math.abs(dx) > THRESHOLD) swipe(dx > 0 ? 'like' : 'nope');
    else { card.style.transform = ''; setStamps(card, 0); }
  };
  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', release);

  document.querySelector('[data-act="like"]').addEventListener('click', () => swipe('like'));
  document.querySelector('[data-act="nope"]').addEventListener('click', () => swipe('nope'));
  undoBtn.addEventListener('click', undo);
  document.querySelector('[data-restart]').addEventListener('click', () => {
    index = 0;
    past.length = 0;
    layout();
    deck.focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (e) => {
    if (body.dataset.view !== 'deck' || dialog.open || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); swipe('like'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); swipe('nope'); }
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); undo(); }
  });

  syncMatches();
  layout();
})();
