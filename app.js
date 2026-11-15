(() => {
  const body = document.body;
  const app = document.querySelector('.app');
  const stage = document.querySelector('.stage');
  const deck = document.querySelector('[data-deck]');
  const cards = [...deck.querySelectorAll('.card')];
  const undoBtn = document.querySelector('[data-act="undo"]');
  const announce = document.querySelector('[data-announce]');
  const matchList = document.querySelector('[data-matches]');
  const matchCount = document.querySelector('[data-match-count]');
  const matchesEmpty = document.querySelector('[data-matches-empty]');
  const matchesHint = document.querySelector('[data-matches-hint]');
  const dialog = document.querySelector('[data-match-dialog]');
  const chat = document.querySelector('[data-chat]');
  const chatLog = chat.querySelector('[data-chat-log]');
  const chatForm = chat.querySelector('[data-chat-form]');
  const chatInput = chatForm.querySelector('input');
  const starters = chat.querySelector('[data-chat-starters]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const THRESHOLD = 110; // px of drag that commits a swipe
  let index = 0; // first card still in the deck
  const past = []; // [{ card, dir }]
  const matched = new Set();
  const threads = new Map(); // dog id -> [{ from: 'me' | 'them' | 'note', text }]
  let openDog = null; // dog id whose chat is open
  let lastMatch = null; // card shown in the match dialog

  /* scripted replies: this prototype has no backend, so each dog answers from its own lines */
  const REPLIES = {
    biscuit: ['Woof! Yes. Is there a tennis ball involved?', 'I do zoomies at five, so any time before that.', 'Bring snacks and we are friends forever.'],
    clyde: ['A walk? A short one. Then a nap. Deal.', 'The park with the most benches is my favourite.', 'I will be the one lying down halfway.'],
    marmalade: ['Only if there are puddles on the way.', 'The one by the pond. I always end up in it.', 'Fair warning: I will smell like the pond after.'],
    waffles: ['YES. Sorry. Yes!', 'Fetch, always fetch. I am faster than I look.', 'My legs are short but my opinions are strong.'],
  };
  const replyCount = new Map();

  /* views: the cover and the swipe screen */
  const show = (view, push = true) => {
    body.dataset.view = view;
    if (push && location.hash !== '#' + view) window.history.pushState(null, '', '#' + view);
    window.scrollTo(0, 0);
    if (view === 'deck' && !openDog) deck.focus({ preventScroll: true });
  };
  document.querySelectorAll('[data-go]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); closeChat(false); show(a.dataset.go); })
  );
  window.addEventListener('popstate', () => show(location.hash === '#deck' ? 'deck' : 'cover', false));

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

  const cardFor = (id) => cards.find((c) => c.dataset.dog === id);
  const name = (card) => card.querySelector('.card__name').firstChild.textContent.trim();
  const breed = (card) => card.querySelector('.card__breed').textContent.trim();
  const photo = (card) => {
    const src = card.querySelector('img');
    const img = document.createElement('img');
    img.src = src.getAttribute('src');
    img.alt = '';
    img.style.objectPosition = src.style.objectPosition;
    return img;
  };

  /* matches */
  const addMatch = (card) => {
    if (matched.has(card)) return;
    matched.add(card);
    const id = card.dataset.dog;
    if (!threads.has(id)) threads.set(id, [{ from: 'note', text: `You and ${name(card)} matched. Say hello.` }]);
    const li = document.createElement('li');
    li.dataset.dog = id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'match-btn';
    btn.setAttribute('aria-label', `Chat with ${name(card)}`);
    const label = document.createElement('span');
    label.textContent = name(card);
    btn.append(photo(card), label);
    btn.addEventListener('click', () => openChat(id));
    li.append(btn);
    matchList.prepend(li);
    syncMatches();
  };
  const removeMatch = (card) => {
    if (!matched.delete(card)) return;
    const id = card.dataset.dog;
    matchList.querySelector(`[data-dog="${id}"]`)?.remove();
    threads.delete(id);
    replyCount.delete(id);
    if (openDog === id) closeChat();
    syncMatches();
  };
  const syncMatches = () => {
    matchCount.textContent = matched.size;
    matchesEmpty.hidden = matched.size > 0;
    matchesHint.hidden = matched.size === 0;
    matchList.querySelectorAll('.match-btn').forEach((b) =>
      b.setAttribute('aria-current', b.parentElement.dataset.dog === openDog ? 'true' : 'false')
    );
  };

  const openMatch = (card) => {
    lastMatch = card;
    const fig = dialog.querySelector('[data-match-photo]');
    fig.replaceChildren(photo(card));
    fig.firstChild.alt = card.querySelector('img').alt;
    dialog.querySelector('[data-match-text]').textContent = `${name(card)} liked you back. Time to plan a walk.`;
    dialog.showModal();
  };
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'chat' && lastMatch) openChat(lastMatch.dataset.dog);
    else deck.focus({ preventScroll: true });
    dialog.returnValue = '';
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* chat */
  const renderThread = () => {
    const thread = threads.get(openDog) || [];
    chatLog.replaceChildren(...thread.map((m) => {
      const li = document.createElement('li');
      li.className = `msg msg--${m.from}`;
      li.textContent = m.text;
      if (m.from !== 'note') {
        const who = document.createElement('span');
        who.className = 'visually-hidden';
        who.textContent = m.from === 'me' ? 'You: ' : `${name(cardFor(openDog))}: `;
        li.prepend(who);
      }
      return li;
    }));
    if (typing.has(openDog)) {
      const li = document.createElement('li');
      li.className = 'msg msg--them msg--typing';
      li.textContent = `${name(cardFor(openDog))} is typing`;
      chatLog.append(li);
    }
    starters.hidden = thread.some((m) => m.from === 'me');
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const openChat = (id) => {
    const card = cardFor(id);
    if (!card) return;
    openDog = id;
    chat.querySelector('[data-chat-name]').textContent = name(card);
    chat.querySelector('[data-chat-breed]').textContent = breed(card);
    chat.querySelector('[data-chat-avatar]').replaceChildren(photo(card));
    chatInput.placeholder = `Message ${name(card)}`;
    stage.hidden = true;
    chat.hidden = false;
    app.classList.add('is-chatting');
    renderThread();
    syncMatches();
    chatInput.focus({ preventScroll: true });
  };

  function closeChat(focusDeck = true) {
    if (!openDog) return;
    const id = openDog;
    openDog = null;
    chat.hidden = true;
    stage.hidden = false;
    app.classList.remove('is-chatting');
    syncMatches();
    if (focusDeck) {
      const btn = matchList.querySelector(`[data-dog="${id}"] .match-btn`);
      (matchMedia('(max-width: 60rem)').matches || !btn ? deck : btn).focus({ preventScroll: true });
    }
  }
  chat.querySelector('[data-chat-close]').addEventListener('click', () => closeChat());

  const typing = new Set();
  const send = (text) => {
    const id = openDog;
    text = text.trim();
    if (!id || !text) return;
    threads.get(id).push({ from: 'me', text });
    renderThread();
    const lines = REPLIES[id] || ['Woof!'];
    const n = replyCount.get(id) || 0;
    if (n >= lines.length) return; // this dog has said everything it knows
    replyCount.set(id, n + 1);
    typing.add(id);
    setTimeout(() => { if (openDog === id) renderThread(); }, 300);
    setTimeout(() => {
      typing.delete(id);
      if (!threads.has(id)) return; // unmatched meanwhile
      threads.get(id).push({ from: 'them', text: lines[n] });
      if (openDog === id) renderThread();
    }, 1400);
  };
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    send(chatInput.value);
    chatInput.value = '';
    chatInput.focus();
  });
  starters.addEventListener('click', (e) => {
    const b = e.target.closest('.starter');
    if (b) { send(b.textContent); chatInput.focus(); }
  });

  /* a swipe, by drag, button or key */
  const swipe = (dir) => {
    const card = cards[index];
    if (!card || dialog.open || openDog) return;
    const sign = dir === 'like' ? 1 : -1;
    const w = Math.max(window.innerWidth, 800);
    card.classList.remove('is-dragging');
    card.classList.add('is-flying');
    setStamps(card, sign * THRESHOLD);
    card.style.transform = `translate(${sign * w}px, ${card._dy || 0}px) rotate(${sign * 28}deg)`;
    index += 1;
    past.push({ card, dir });
    layout();
    setTimeout(() => {
      card.classList.remove('is-flying');
      card.dataset.pos = 'gone';
      card.style.transform = '';
      setStamps(card, 0);
    }, reduced.matches ? 0 : 420);
    announce.textContent = `${dir === 'like' ? 'Liked' : 'Passed on'} ${name(card)}.`;
    if (dir === 'like' && card.dataset.match === 'true' && !matched.has(card)) {
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
    if (body.dataset.view !== 'deck' || dialog.open) return;
    if (openDog) { if (e.key === 'Escape') closeChat(); return; }
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); swipe('like'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); swipe('nope'); }
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); undo(); }
  });

  /* iOS keeps the layout viewport full height when the keyboard opens; size the mobile chat to the visible area instead */
  const vv = window.visualViewport;
  if (vv) {
    const root = document.documentElement.style;
    const fit = () => {
      root.setProperty('--vvh', `${vv.height}px`);
      root.setProperty('--vvt', `${vv.offsetTop}px`);
      if (openDog) chatLog.scrollTop = chatLog.scrollHeight;
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
  }

  show(location.hash === '#deck' ? 'deck' : 'cover', false);
  syncMatches();
  layout();
})();
