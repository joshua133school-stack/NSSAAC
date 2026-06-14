/* ===========================================================================
   Real, or rendered? — client logic
   Handles screen flow, the photo quiz, the staggered text animation, and
   submitting results to the server.
   =========================================================================== */

(function () {
  'use strict';

  const state = {
    photos: [],          // [{ src, truth }]
    index: 0,            // current photo
    demographics: {},
    responses: [],       // [{ src, truth, guess, confidence, reasonTags, reasonText }]
    current: null,       // working response for the current photo
  };

  // -------------------------------------------------------------- utilities

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('is-active'));
    const el = document.getElementById(id);
    el.classList.add('is-active');
    runStagger(el);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /** Animate [data-stagger] elements: headings letter-by-letter, others fade up. */
  function runStagger(root) {
    const items = $$('[data-stagger]', root);
    let delay = 0;
    items.forEach((el) => {
      const isHeading = el.classList.contains('display') || el.classList.contains('title');
      if (isHeading && !el.dataset.split) {
        splitToChars(el);
        el.dataset.split = '1';
      }
      if (isHeading) {
        el.style.opacity = 1;
        $$('.char', el).forEach((c, i) => {
          c.style.animationDelay = (delay + i * 0.028) + 's';
          c.style.animationName = 'none';
          // force reflow so the animation restarts on re-entry
          void c.offsetWidth;
          c.style.animationName = 'charIn';
        });
        delay += 0.028 * $$('.char', el).length + 0.15;
      } else {
        el.style.opacity = 0;
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animationDelay = delay + 's';
        el.classList.add('reveal');
        el.style.animation = '';
        delay += 0.18;
      }
    });
  }

  function splitToChars(el) {
    const text = el.textContent;
    el.textContent = '';
    for (const ch of text) {
      if (ch === ' ') {
        el.appendChild(document.createTextNode(' '));
      } else {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch;
        el.appendChild(span);
      }
    }
  }

  // -------------------------------------------------------------- intro

  async function init() {
    // wire slider outputs
    bindSlider('selfRatedAbility', 'selfRatedAbility-out');

    runStagger($('#screen-intro'));

    $('#start-btn').addEventListener('click', () => showScreen('screen-demographics'));

    // fetch inventory just to show the count and detect empty state
    try {
      const status = await fetch('/api/status').then((r) => r.json());
      $('#intro-count').textContent = Math.min(
        status.photos_per_session,
        status.ai_photos + status.real_photos
      ) || status.photos_per_session;
    } catch (e) { /* non-fatal */ }

    $('#demographics-form').addEventListener('submit', onDemographicsSubmit);
    $('#restart-btn').addEventListener('click', () => window.location.reload());
  }

  function bindSlider(inputId, outId) {
    const input = document.getElementById(inputId);
    const out = document.getElementById(outId);
    if (!input || !out) return;
    const update = () => { out.textContent = input.value; };
    input.addEventListener('input', update);
    update();
  }

  // -------------------------------------------------------------- demographics

  function onDemographicsSubmit(e) {
    e.preventDefault();
    const err = $('#demographics-error');

    const age = $('#age').value.trim();
    const gender = $('#gender').value;
    if (!age || !gender) {
      err.textContent = 'Please provide at least your age and gender.';
      err.hidden = false;
      return;
    }
    err.hidden = true;

    state.demographics = {
      age: Number(age),
      gender,
      education: $('#education').value,
      country: $('#country').value.trim(),
      occupationField: $('#occupationField').value,
      nativeEnglish: $('#nativeEnglish').value,
      aiUsedBefore: $('#aiUsedBefore').value,
      aiUseFrequency: $('#aiUseFrequency').value,
      aiTypesUsed: $$('#aiTypesUsed input:checked').map((c) => c.value),
      imageAiExperience: $('#imageAiExperience').value,
      selfRatedAbility: Number($('#selfRatedAbility').value),
      visionCorrected: $('#visionCorrected').value,
      overallComments: '',
    };

    loadPhotosAndStart();
  }

  // -------------------------------------------------------------- quiz

  async function loadPhotosAndStart() {
    let data;
    try {
      data = await fetch('/api/photos').then((r) => r.json());
    } catch (e) {
      data = { photos: [] };
    }

    if (!data.photos || data.photos.length === 0) {
      showScreen('screen-empty');
      return;
    }

    state.photos = data.photos;
    state.index = 0;
    state.responses = [];

    wireQuizControls();
    showScreen('screen-quiz');
    renderPhoto();
  }

  let quizWired = false;
  function wireQuizControls() {
    if (quizWired) return;
    quizWired = true;

    bindSlider('confidence', 'confidence-out');

    $$('.choice').forEach((btn) => {
      btn.addEventListener('click', () => selectGuess(btn));
    });

    $$('#reason-tags .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        syncReasonTags();
      });
    });

    $('#reasonText').addEventListener('input', (e) => {
      if (state.current) state.current.reasonText = e.target.value;
    });

    $('#next-btn').addEventListener('click', nextPhoto);

    setupMarking();
  }

  // ---- highlight ("mark the weird part") canvas ----------------------------

  const mark = { canvas: null, ctx: null, drawing: false, hasDrawn: false };

  function setupMarking() {
    mark.canvas = $('#mark-canvas');
    mark.ctx = mark.canvas.getContext('2d');

    const pos = (e) => {
      const r = mark.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const start = (e) => {
      if (!$('#photo-frame').classList.contains('marking')) return;
      mark.drawing = true;
      mark.hasDrawn = true;
      const p = pos(e);
      mark.ctx.beginPath();
      mark.ctx.moveTo(p.x, p.y);
      e.preventDefault();
    };
    const move = (e) => {
      if (!mark.drawing) return;
      const p = pos(e);
      const w = Math.max(10, mark.canvas.width * 0.035);
      mark.ctx.lineWidth = w;
      mark.ctx.lineCap = 'round';
      mark.ctx.lineJoin = 'round';
      mark.ctx.strokeStyle = 'rgba(255, 70, 45, 0.45)';
      mark.ctx.lineTo(p.x, p.y);
      mark.ctx.stroke();
      e.preventDefault();
    };
    const end = () => { mark.drawing = false; };

    mark.canvas.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);

    $('#mark-clear').addEventListener('click', clearMarks);
  }

  function sizeMarkCanvas() {
    const frame = $('#photo-frame');
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    // resizing the canvas also clears it
    mark.canvas.width = w;
    mark.canvas.height = h;
    mark.hasDrawn = false;
  }

  function clearMarks() {
    if (!mark.ctx) return;
    sizeMarkCanvas();
    mark.ctx.clearRect(0, 0, mark.canvas.width, mark.canvas.height);
    mark.hasDrawn = false;
  }

  /**
   * Flatten the photo + the highlight into one small JPEG and return it as
   * base64 (no data-URL prefix), or null if the participant drew nothing.
   */
  function buildAnnotation() {
    if (!mark.hasDrawn) return null;
    const img = $('#quiz-image');
    const cw = mark.canvas.width;
    const ch = mark.canvas.height;
    if (!cw || !ch || !img.naturalWidth) return null;

    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext('2d');

    // replicate object-fit: cover so the marks line up with the photo
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    ctx.drawImage(mark.canvas, 0, 0);

    // downscale so the spreadsheet stays light
    const maxDim = 480;
    const s = Math.min(1, maxDim / Math.max(cw, ch));
    let final = out;
    if (s < 1) {
      final = document.createElement('canvas');
      final.width = Math.round(cw * s);
      final.height = Math.round(ch * s);
      final.getContext('2d').drawImage(out, 0, 0, final.width, final.height);
    }
    try {
      return final.toDataURL('image/jpeg', 0.7).split(',')[1] || null;
    } catch (e) {
      return null; // tainted canvas (shouldn't happen for same-origin images)
    }
  }

  function renderPhoto() {
    const photo = state.photos[state.index];
    state.current = {
      src: photo.src,
      truth: photo.truth,
      guess: null,
      confidence: 5,
      reasonTags: [],
      reasonText: '',
      annotation: null,
    };

    // progress
    const n = state.index + 1;
    $('#quiz-counter').textContent = `${n} / ${state.photos.length}`;
    $('#quiz-bar').style.width = `${(state.index / state.photos.length) * 100}%`;

    // image with swap animation
    const frame = $('#photo-frame');
    const img = $('#quiz-image');
    img.src = photo.src;
    frame.classList.remove('swap');
    void frame.offsetWidth;
    frame.classList.add('swap');

    // reset controls
    $$('.choice').forEach((b) => b.classList.remove('selected'));
    $$('#reason-tags .chip').forEach((c) => c.classList.remove('active'));
    $('#confidence').value = 5;
    $('#confidence-out').textContent = '5';
    $('#reasonText').value = '';
    $('#followup').hidden = true;

    // reset the highlight layer for the new photo
    frame.classList.remove('marking');
    clearMarks();
  }

  function selectGuess(btn) {
    $$('.choice').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    const guess = btn.dataset.guess;
    state.current.guess = guess;

    // the reason prompt adapts to what they chose
    const q = guess === 'ai'
      ? '왜 AI(가짜)처럼 느껴졌나요?'
      : '왜 진짜라고 생각했나요?';
    $('#reason-question').innerHTML =
      q + ' <span class="hint">(여러 개 선택 가능 · select any)</span>';

    // turn on highlighting for this photo
    $('#photo-frame').classList.add('marking');

    $('#followup').hidden = false;
    $('#followup').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function syncReasonTags() {
    state.current.reasonTags = $$('#reason-tags .chip.active').map((c) => c.dataset.tag);
  }

  function nextPhoto() {
    if (!state.current.guess) return; // require a choice

    state.current.confidence = Number($('#confidence').value);
    state.current.reasonText = $('#reasonText').value.trim();
    syncReasonTags();
    state.current.annotation = buildAnnotation();
    state.responses.push(state.current);

    state.index += 1;
    if (state.index >= state.photos.length) {
      finish();
    } else {
      renderPhoto();
    }
  }

  // -------------------------------------------------------------- finish

  async function finish() {
    $('#quiz-bar').style.width = '100%';

    const payload = {
      demographics: state.demographics,
      responses: state.responses,
    };

    let result = null;
    try {
      result = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
    } catch (e) {
      result = null;
    }

    if (result && result.ok && result.score) {
      $('#score-num').textContent = result.score.correct;
      $('#score-total').textContent = result.score.total;
      $('#score-card').hidden = false;
      $('#done-message').textContent =
        'Your responses have been recorded. Here is how you did:';
    } else if (!result || !result.ok) {
      $('#done-message').textContent =
        'We could not reach the server to save your responses — but thank you for taking part.';
    }

    showScreen('screen-done');
  }

  // ------------------------------------------------------------------ go

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
