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

  // One entry per person (per browser). Disabled for now — flip ONE_CHANCE to
  // true to re-enable the lockout later.
  const ONE_CHANCE = false;
  const DONE_KEY = 'nssaac_completed';

  function alreadyDone() {
    if (!ONE_CHANCE) return false;
    try { return !!localStorage.getItem(DONE_KEY); } catch (e) { return false; }
  }
  function markDone() {
    if (!ONE_CHANCE) return;
    try { localStorage.setItem(DONE_KEY, new Date().toISOString()); } catch (e) {}
  }

  // -------------------------------------------------------------- i18n

  const LANG_KEY = 'nssaac_lang';
  let currentLang = 'ko';

  // Strings that are set dynamically from JS (everything else is translated
  // inline in the HTML via data-ko / data-en attributes).
  const STR = {
    ko: {
      introMsgs: [
        '안녕하세요, 통계 실험에 참여해주셔서 감사합니다!',
        '혹시 기계가 만든 이미지를 진짜 사진과 구별할 수 있으신가요?',
        '아래 시작 버튼을 눌러주세요!',
      ],
      reasonAi: '왜 AI(가짜)처럼 느껴졌나요?',
      reasonReal: '왜 진짜라고 생각했나요?',
      selectAny: '여러 개 선택 가능',
      recorded: '응답이 기록되었습니다. 결과는 다음과 같아요:',
      recordedNoScore: '응답이 기록되었습니다. 감사합니다!',
      failSave: '서버에 저장하지 못했지만, 참여해 주셔서 감사합니다.',
    },
    en: {
      introMsgs: [
        'Hello, and thank you for taking part in this statistics study!',
        'Can you tell a machine-made image from a real photograph?',
        'Press the Begin button below to start!',
      ],
      reasonAi: 'Why did it feel AI-generated?',
      reasonReal: 'Why did you think it was real?',
      selectAny: 'select any',
      recorded: 'Your responses have been recorded. Here is how you did:',
      recordedNoScore: 'Your responses have been recorded. Thank you!',
      failSave: "We couldn't save to the server — but thank you for taking part.",
    },
  };

  function t(key) { return (STR[currentLang] || STR.ko)[key]; }

  // Capture the Korean option text and derive the English (= the stable value)
  // so the dropdowns translate without per-option attributes in the HTML.
  function setupOptionI18n() {
    $$('#demographics-form option').forEach((opt) => {
      if (opt.dataset.ko) return;
      opt.dataset.ko = opt.textContent;
      opt.dataset.en = opt.value ? opt.value : 'Select…';
      if (!opt.value) opt.dataset.ko = '선택…';
    });
  }

  function applyLang(lang) {
    currentLang = (lang === 'en') ? 'en' : 'ko';
    document.documentElement.lang = currentLang;
    $$('[data-ko], [data-en]').forEach((el) => {
      const val = el.getAttribute('data-' + currentLang);
      if (val != null) el.innerHTML = val;
    });
    $$('[data-ko-ph], [data-en-ph]').forEach((el) => {
      const val = el.getAttribute('data-' + currentLang + '-ph');
      if (val != null) el.placeholder = val;
    });
    try { localStorage.setItem(LANG_KEY, currentLang); } catch (e) {}
  }

  function savedLang() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
  }

  async function init() {
    // Escape hatch for testing: visiting with ?reset clears the locks.
    if (/[?&]reset\b/.test(window.location.search)) {
      try { localStorage.removeItem(DONE_KEY); localStorage.removeItem(LANG_KEY); } catch (e) {}
    }

    bindSlider('selfRatedAbility', 'selfRatedAbility-out');
    setupOptionI18n();
    setupSurveyFlow();
    $('#demographics-form').addEventListener('submit', onDemographicsSubmit);
    $('#start-btn').addEventListener('click', () => {
      showScreen('screen-demographics');
      requestAnimationFrame(() => { window.scrollTo(0, 0); updateSurveyFocus(); });
    });

    // If this browser already completed the study, don't let them retake.
    if (alreadyDone()) {
      applyLang(savedLang() || 'ko');
      showScreen('screen-already');
      return;
    }

    // Otherwise start at the language picker.
    applyLang(savedLang() || 'ko'); // sensible default until they choose
    $$('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyLang(btn.dataset.lang);
        showScreen('screen-intro');
        startIntroCycle();
      });
    });
    runStagger($('#screen-lang'));
  }

  // ---- cyclical, scroll-focused demographics flow -------------------------

  let surveyBlocks = [];

  function setupSurveyFlow() {
    const form = document.getElementById('demographics-form');
    if (!form) return;
    surveyBlocks = Array.from(form.querySelectorAll('.q-block'));

    surveyBlocks.forEach((b, i) => {
      // make sure every question (except the final submit) can advance
      if (!b.classList.contains('q-final') && !b.querySelector('.q-next')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'q-next';
        btn.setAttribute('data-ko', '다음 ↓');
        btn.setAttribute('data-en', 'Next ↓');
        btn.textContent = '다음 ↓';
        b.appendChild(btn);
      }
      b.classList.toggle('revealed', i === 0);
    });

    surveyBlocks.forEach((b) => {
      const nextBtn = b.querySelector('.q-next');
      if (nextBtn) nextBtn.addEventListener('click', () => advanceSurvey(b));
      // choosing a dropdown moves you along automatically
      b.querySelectorAll('select').forEach((sel) => {
        sel.addEventListener('change', () => advanceSurvey(b));
      });
    });

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { updateSurveyFocus(); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  // A conditional block (data-show-if="fieldId:Yes") only counts when its
  // controlling field has one of the listed values.
  function isEligible(block) {
    const cond = block.dataset.showIf;
    if (!cond) return true;
    const [field, valsStr] = cond.split(':');
    const el = document.getElementById(field);
    return !!el && valsStr.split('|').includes(el.value);
  }

  // Hide + clear any revealed conditional questions that no longer apply.
  function syncConditionals() {
    surveyBlocks.forEach((b) => {
      if (!b.dataset.showIf || isEligible(b)) return;
      if (b.classList.contains('revealed')) {
        b.classList.remove('revealed', 'focused');
        b.querySelectorAll('select').forEach((s) => { s.value = ''; });
        b.querySelectorAll('input[type="range"]').forEach((r) => { r.value = 5; });
      }
    });
  }

  function advanceSurvey(block) {
    // required questions must be answered before the next appears
    const req = block.querySelector('[required]');
    if (req) {
      const answered = req.type === 'checkbox' ? req.checked : !!req.value;
      if (!answered) {
        block.classList.add('q-invalid');
        if (req.focus) req.focus();
        return;
      }
    }
    // legal minimum age (14+), per consent / PIPA
    const ageInput = block.querySelector('#age');
    if (ageInput) {
      const v = Number(ageInput.value);
      const errEl = block.querySelector('.q-error');
      if (!v || v < 14) {
        if (errEl) errEl.hidden = false;
        block.classList.add('q-invalid');
        ageInput.focus();
        return;
      }
      if (errEl) errEl.hidden = true;
    }

    block.classList.remove('q-invalid');

    syncConditionals(); // drop questions that no longer apply after this answer

    // reveal the next *eligible* question, skipping ones whose condition fails
    let idx = surveyBlocks.indexOf(block) + 1;
    while (idx < surveyBlocks.length && !isEligible(surveyBlocks[idx])) idx++;
    const next = surveyBlocks[idx];
    if (!next || next.classList.contains('revealed')) return; // don't yank when editing
    next.classList.add('revealed');
    setTimeout(() => scrollBlockToCentre(next), 80);
  }

  // The question nearest the centre of the screen becomes fully opaque/editable.
  function updateSurveyFocus() {
    if (!surveyBlocks.length) return;
    const mid = window.innerHeight / 2;
    let best = null;
    let bestD = Infinity;
    surveyBlocks.forEach((b) => {
      if (!b.classList.contains('revealed')) return;
      const r = b.getBoundingClientRect();
      const c = r.top + r.height / 2;
      const d = Math.abs(c - mid);
      if (d < bestD) { bestD = d; best = b; }
    });
    surveyBlocks.forEach((b) => b.classList.toggle('focused', b === best));
  }

  function scrollBlockToCentre(b) {
    const r = b.getBoundingClientRect();
    const target = window.scrollY + r.top - (window.innerHeight / 2 - r.height / 2);
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  // Big intro headline that slowly cycles through a few lines (in the chosen
  // language). Guarded so only one loop runs even if started twice.
  let introCycleRunning = false;

  function startIntroCycle() {
    const el = document.getElementById('intro-cycle');
    if (!el || introCycleRunning) return;
    introCycleRunning = true;
    const msgs = t('introMsgs');
    let i = 0;
    const HOLD = 2500; // how long each line stays (2.5s)
    const FADE = 700;  // matches the CSS transition
    const show = () => {
      // stop the loop once they've left the intro screen
      const intro = document.getElementById('screen-intro');
      if (!intro || !intro.classList.contains('is-active')) { introCycleRunning = false; return; }
      el.textContent = msgs[i];
      el.classList.add('visible');
      setTimeout(() => {
        el.classList.remove('visible');
        setTimeout(() => {
          i = (i + 1) % msgs.length;
          show();
        }, FADE);
      }, HOLD);
    };
    show();
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
      err.textContent = currentLang === 'en'
        ? 'Please provide at least your age and gender.'
        : '나이와 성별은 꼭 입력해 주세요.';
      err.hidden = false;
      return;
    }
    if (Number(age) < 14) {
      err.textContent = currentLang === 'en'
        ? 'You must be 14 or older to take part ㅜㅠ'
        : '너무 어려요 ㅜㅠ (만 14세 이상만 참여할 수 있어요)';
      err.hidden = false;
      return;
    }
    err.hidden = true;

    const aiUsed = $('#aiUsedBefore').value;
    const seenAi = $('#seenAiImages').value;
    state.demographics = {
      age: Number(age),
      gender,
      education: $('#education').value,
      occupationField: $('#occupationField').value,
      aiUsedBefore: aiUsed,
      // these only apply when the controlling answer was "Yes"
      aiUseFrequency: aiUsed === 'Yes' ? $('#aiUseFrequency').value : '',
      aiImageGenUsed: aiUsed === 'Yes' ? $('#aiImageGenUsed').value : '',
      seenAiImages: seenAi,
      selfRatedAbility: seenAi === 'Yes' ? Number($('#selfRatedAbility').value) : '',
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

    $('#next-btn').addEventListener('click', nextPhoto);

    setupMarking();
    setupFollowupFlow();
  }

  // ---- one-at-a-time follow-up reveal -------------------------------------

  const followupState = { step: -1, steps: [] };

  function setupFollowupFlow() {
    followupState.steps = $$('#followup .fq');
    $$('#followup .fq-next').forEach((btn) => {
      btn.addEventListener('click', () => revealFollowupStep(followupState.step + 1));
    });
    // tapping a revealed step makes it the active (editable) one
    followupState.steps.forEach((s) => {
      s.addEventListener('pointerdown', () => {
        if (s.classList.contains('fq-revealed')) {
          followupState.steps.forEach((x) => x.classList.toggle('fq-active', x === s));
        }
      });
    });
  }

  function resetFollowup() {
    followupState.step = -1;
    followupState.steps.forEach((s) => s.classList.remove('fq-revealed', 'fq-active'));
    $('#next-btn').classList.add('fq-hidden');
    $('#photo-frame').classList.remove('marking');
  }

  function revealFollowupStep(i) {
    const steps = followupState.steps;
    if (i < 0 || i >= steps.length) return;
    followupState.step = i;
    for (let k = 0; k <= i; k++) steps[k].classList.add('fq-revealed');
    steps.forEach((s, idx) => s.classList.toggle('fq-active', idx === i));

    if (i === steps.length - 1) {
      $('#next-btn').classList.remove('fq-hidden');
      $('#photo-frame').classList.add('marking'); // enable drawing at the highlight step
    }
    setTimeout(() => steps[i].scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
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
      mark.ctx.strokeStyle = 'rgba(55, 55, 60, 0.4)'; // semi-transparent grey
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
    $('#followup').hidden = true;
    resetFollowup();

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
    const q = guess === 'ai' ? t('reasonAi') : t('reasonReal');
    $('#reason-question').innerHTML =
      q + ' <span class="hint">(' + t('selectAny') + ')</span>';

    // reveal the follow-up one question at a time
    $('#followup').hidden = false;
    revealFollowupStep(0);
  }

  function syncReasonTags() {
    state.current.reasonTags = $$('#reason-tags .chip.active').map((c) => c.dataset.tag);
  }

  function nextPhoto() {
    if (!state.current.guess) return; // require a choice

    state.current.confidence = Number($('#confidence').value);
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
      markDone(); // lock out retakes once the data is safely saved
      $('#score-num').textContent = `${result.score.correct} / ${result.score.total}`;
      $('#score-card').hidden = false;
      $('#done-message').textContent = t('recorded');
    } else if (result && result.ok) {
      markDone();
      $('#done-message').textContent = t('recordedNoScore');
    } else {
      $('#done-message').textContent = t('failSave');
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
