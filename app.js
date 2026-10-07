(() => {
  "use strict";

  const STORAGE_KEY = "setRepCounter.settings.v2";
  const LEGACY_KEY = "setRepCounter.settings.v1";
  const PHASES = [
    { label: "LOWER", voice: "Lower" },
    { label: "BOTTOM HOLD", voice: "Bottom hold" },
    { label: "LIFT", voice: "Lift" },
    { label: "TOP HOLD", voice: "Top hold" }
  ];
  const LIMITS = {
    sets: { min: 1, max: 99, fallback: 3 },
    reps: { min: 1, max: 999, fallback: 10 },
    restSeconds: { min: 0, max: 600, fallback: 30 }
  };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandaloneIOS = isIOS && window.navigator.standalone === true;
  const isSafariIOS = isIOS &&
    (/Version\/\d+(?:\.\d+)*.*Safari/i.test(navigator.userAgent) || isStandaloneIOS) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(navigator.userAgent);

  const els = {
    soundTest: document.getElementById("soundTest"),
    exerciseProgress: document.getElementById("exerciseProgress"),
    exerciseNameDisplay: document.getElementById("exerciseNameDisplay"),
    statusBadge: document.getElementById("statusBadge"),
    setDisplay: document.getElementById("setDisplay"),
    repDisplay: document.getElementById("repDisplay"),
    tempoDisplay: document.getElementById("tempoDisplay"),
    tempo0: document.getElementById("tempo0"),
    tempo1: document.getElementById("tempo1"),
    tempo2: document.getElementById("tempo2"),
    tempo3: document.getElementById("tempo3"),
    tempoPhases: document.getElementById("tempoPhases"),
    phaseLabel: document.getElementById("phaseLabel"),
    timeDisplay: document.getElementById("timeDisplay"),
    progressBar: document.getElementById("progressBar"),
    elapsedDisplay: document.getElementById("elapsedDisplay"),
    plannedDisplay: document.getElementById("plannedDisplay"),
    liveStatus: document.getElementById("liveStatus"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    resetButton: document.getElementById("resetButton"),
    singleModeButton: document.getElementById("singleModeButton"),
    circuitModeButton: document.getElementById("circuitModeButton"),
    singleSettings: document.getElementById("singleSettings"),
    circuitSettings: document.getElementById("circuitSettings"),
    exerciseName: document.getElementById("exerciseName"),
    sets: document.getElementById("sets"),
    reps: document.getElementById("reps"),
    tempo: document.getElementById("tempo"),
    tempoPhase0: document.getElementById("tempoPhase0"),
    tempoPhase1: document.getElementById("tempoPhase1"),
    tempoPhase2: document.getElementById("tempoPhase2"),
    tempoPhase3: document.getElementById("tempoPhase3"),
    restSeconds: document.getElementById("restSeconds"),
    circuitList: document.getElementById("circuitList"),
    addExerciseButton: document.getElementById("addExerciseButton"),
    estimateDisplay: document.getElementById("estimateDisplay"),
    voiceEnabled: document.getElementById("voiceEnabled"),
    speakTiming: document.getElementById("speakTiming"),
    startCountdown: document.getElementById("startCountdown"),
    beepEnabled: document.getElementById("beepEnabled")
  };

  let mode = "single";
  let circuit = [
    { name: "Exercise 1", sets: 3, reps: 10, tempo: "3-1-1-1", rest: 30 },
    { name: "Exercise 2", sets: 3, reps: 10, tempo: "3-1-1-1", rest: 30 }
  ];

  let program = [];
  let state = "idle";
  let pausedState = null;
  let currentItemIndex = 0;
  let currentSet = 1;
  let currentRep = 0;
  let currentPhaseIndex = -1;
  let pendingAdvance = null;
  let phaseStartedAt = 0;
  let phaseDuration = 0;
  let pauseRemaining = 0;
  let rafId = null;
  let audioContext = null;
  let wakeLock = null;
  let speechUnlocked = !isIOS;
  let speechTestTimer = null;
  let lastSpokenSecond = null;
  let numericSpeechQueue = [];
  let numericSpeechBusy = false;
  let numericSpeechGapTimer = null;
  let workoutStartedAt = 0;
  let pauseStartedAt = 0;
  let totalPausedMs = 0;
  let finalElapsedMs = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function safeInt(value, rule) {
    const n = Number.parseInt(value, 10);
    return clamp(Number.isFinite(n) ? n : rule.fallback, rule.min, rule.max);
  }

  function parseTempo(value) {
    const cleaned = String(value || "").toUpperCase().replace(/\s+/g, "");
    const parts = cleaned.split("-");
    if (parts.length !== 4) return null;
    const parsed = parts.map((token) => {
      if (token === "X") return { token: "X", seconds: 1, explosive: true };
      if (!/^\d{1,2}$/.test(token)) return null;
      const n = Number(token);
      if (n < 0 || n > 30) return null;
      return { token: String(n), seconds: n, explosive: false };
    });
    if (parsed.some((part) => !part)) return null;
    if (parsed.every((part) => part.seconds === 0)) return null;
    return parsed;
  }

  function normaliseTempo(value) {
    const parsed = parseTempo(value);
    return parsed ? parsed.map((part) => part.token).join("-") : "3-1-1-1";
  }

  function phaseInputs() {
    return [els.tempoPhase0, els.tempoPhase1, els.tempoPhase2, els.tempoPhase3];
  }

  function syncSinglePhaseInputsFromTempo() {
    const parts = parseTempo(els.tempo.value) || parseTempo("3-1-1-1");
    phaseInputs().forEach((input, index) => {
      input.value = parts[index].token;
      input.classList.remove("invalid");
    });
  }

  function sanitiseTempoToken(value) {
    const token = String(value || "").trim().toUpperCase();
    if (token === "X") return "X";
    const n = Number.parseInt(token, 10);
    if (!Number.isFinite(n)) return "0";
    return String(clamp(n, 0, 30));
  }

  function syncSingleTempoFromPhaseInputs(saveNow) {
    const tokens = phaseInputs().map((input) => sanitiseTempoToken(input.value));
    phaseInputs().forEach((input, index) => { input.value = tokens[index]; });
    let candidate = tokens.join("-");
    if (!parseTempo(candidate)) {
      tokens[0] = "1";
      els.tempoPhase0.value = "1";
      candidate = tokens.join("-");
    }
    els.tempo.value = candidate;
    els.tempo.classList.remove("invalid");
    if (saveNow) saveSettings();
    else updateEstimate();
  }

  function tempoSeconds(value) {
    const parsed = parseTempo(value) || parseTempo("3-1-1-1");
    return parsed.reduce((sum, part) => sum + part.seconds, 0);
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return hours + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function formatPhaseSeconds(ms, explosive) {
    if (explosive) return "X";
    return "00:" + String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, "0");
  }

  function getSingleItem() {
    const tempo = normaliseTempo(els.tempo.value);
    els.tempo.value = tempo;
    els.tempo.classList.remove("invalid");
    return {
      name: (els.exerciseName.value.trim() || "Exercise").slice(0, 60),
      sets: safeInt(els.sets.value, LIMITS.sets),
      reps: safeInt(els.reps.value, LIMITS.reps),
      tempo: tempo,
      rest: safeInt(els.restSeconds.value, LIMITS.restSeconds)
    };
  }

  function getCircuitItems() {
    return circuit.map((item, i) => ({
      name: (String(item.name || "").trim() || "Exercise " + (i + 1)).slice(0, 60),
      sets: safeInt(item.sets, LIMITS.sets),
      reps: safeInt(item.reps, LIMITS.reps),
      tempo: normaliseTempo(item.tempo),
      rest: safeInt(item.rest, LIMITS.restSeconds)
    }));
  }

  function buildProgram() {
    return mode === "circuit" ? getCircuitItems() : [getSingleItem()];
  }

  function estimateProgramMs(items) {
    let seconds = els.startCountdown.checked ? 3 : 0;
    items.forEach((item, index) => {
      seconds += item.sets * item.reps * tempoSeconds(item.tempo);
      const restsInsideExercise = Math.max(0, item.sets - 1);
      const transitionRest = index < items.length - 1 ? 1 : 0;
      seconds += (restsInsideExercise + transitionRest) * item.rest;
    });
    return seconds * 1000;
  }

  function updateEstimate() {
    const items = buildProgram();
    const ms = estimateProgramMs(items);
    els.estimateDisplay.textContent = formatClock(ms);
    els.plannedDisplay.textContent = formatClock(ms);
    if (state === "idle") updateIdlePreview();
  }

  function saveSettings() {
    const payload = {
      mode: mode,
      single: getSingleItem(),
      circuit: getCircuitItems(),
      voiceEnabled: els.voiceEnabled.checked,
      speakTiming: els.speakTiming.checked,
      startCountdown: els.startCountdown.checked,
      beepEnabled: els.beepEnabled.checked
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
    updateEstimate();
  }

  function loadSettings() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) {}
    if (stored) {
      mode = stored.mode === "circuit" ? "circuit" : "single";
      if (stored.single) {
        els.exerciseName.value = stored.single.name || "Exercise";
        els.sets.value = safeInt(stored.single.sets, LIMITS.sets);
        els.reps.value = safeInt(stored.single.reps, LIMITS.reps);
        els.tempo.value = normaliseTempo(stored.single.tempo);
        els.restSeconds.value = safeInt(stored.single.rest, LIMITS.restSeconds);
      }
      if (Array.isArray(stored.circuit) && stored.circuit.length) circuit = stored.circuit.slice(0, 20);
      ["voiceEnabled", "speakTiming", "startCountdown", "beepEnabled"].forEach((key) => {
        if (typeof stored[key] === "boolean") els[key].checked = stored[key];
      });
    } else {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (legacy) {
          els.sets.value = safeInt(legacy.sets, LIMITS.sets);
          els.reps.value = safeInt(legacy.reps, LIMITS.reps);
          els.restSeconds.value = safeInt(legacy.restSeconds, LIMITS.restSeconds);
          if (typeof legacy.voiceEnabled === "boolean") els.voiceEnabled.checked = legacy.voiceEnabled;
          if (typeof legacy.speakTiming === "boolean") els.speakTiming.checked = legacy.speakTiming;
          if (typeof legacy.startCountdown === "boolean") els.startCountdown.checked = legacy.startCountdown;
          if (typeof legacy.beepEnabled === "boolean") els.beepEnabled.checked = legacy.beepEnabled;
        }
      } catch (_) {}
    }
    syncSinglePhaseInputsFromTempo();
  }

  function setMode(nextMode, persist = true) {
    mode = nextMode === "circuit" ? "circuit" : "single";
    els.singleModeButton.classList.toggle("active", mode === "single");
    els.circuitModeButton.classList.toggle("active", mode === "circuit");
    els.singleSettings.hidden = mode !== "single";
    els.circuitSettings.hidden = mode !== "circuit";
    if (mode === "circuit") renderCircuit();
    if (persist) saveSettings();
    else updateEstimate();
  }

  function renderCircuit() {
    els.circuitList.innerHTML = "";
    circuit.forEach((item, index) => {
      const tempoParts = parseTempo(item.tempo) || parseTempo("3-1-1-1");
      const tempoCode = tempoParts.map((part) => part.token).join("-");
      const card = document.createElement("div");
      card.className = "circuit-card";
      card.dataset.index = String(index);
      card.innerHTML =
        '<div class="circuit-card-header">' +
          '<strong>BLOCK ' + (index + 1) + '</strong>' +
          '<div class="circuit-actions">' +
            '<button class="mini-button" type="button" data-action="up" aria-label="Move up">↑</button>' +
            '<button class="mini-button" type="button" data-action="down" aria-label="Move down">↓</button>' +
            '<button class="mini-button" type="button" data-action="duplicate">Copy</button>' +
            '<button class="mini-button danger" type="button" data-action="remove">×</button>' +
          '</div>' +
        '</div>' +
        '<input class="text-input circuit-name" type="text" maxlength="60" data-field="name" value="' + escapeHtml(item.name || ("Exercise " + (index + 1))) + '" aria-label="Exercise name" />' +
        '<div class="circuit-grid">' +
          circuitField("Sets", "sets", safeInt(item.sets, LIMITS.sets), "number") +
          circuitField("Reps", "reps", safeInt(item.reps, LIMITS.reps), "number") +
        '</div>' +
        '<div class="circuit-timing-box">' +
          '<div class="circuit-timing-title"><strong>REP TEMPO</strong><span data-tempo-code>' + escapeHtml(tempoCode) + '</span></div>' +
          '<div class="circuit-tempo-adjust">' +
            circuitTempoPart("Lower", 0, tempoParts[0].token) +
            circuitTempoPart("Bottom", 1, tempoParts[1].token) +
            circuitTempoPart("Lift", 2, tempoParts[2].token) +
            circuitTempoPart("Top", 3, tempoParts[3].token) +
          '</div>' +
          '<div class="circuit-rest-row"><label>REST BETWEEN SETS / NEXT EXERCISE</label>' +
            '<div class="rest-stepper">' +
              '<button type="button" data-circuit-rest-delta="-5">−5</button>' +
              '<button type="button" data-circuit-rest-delta="-1">−1</button>' +
              '<input type="number" inputmode="numeric" min="0" max="600" data-field="rest" value="' + safeInt(item.rest, LIMITS.restSeconds) + '" />' +
              '<button type="button" data-circuit-rest-delta="1">+1</button>' +
              '<button type="button" data-circuit-rest-delta="5">+5</button>' +
            '</div></div>' +
        '</div>';
      els.circuitList.appendChild(card);
    });
  }

  function circuitTempoPart(label, phaseIndex, token) {
    return '<div class="circuit-tempo-part"><label>' + label + '</label>' +
      '<div class="circuit-mini-stepper">' +
        '<button type="button" data-circuit-tempo-delta="-1" data-phase-index="' + phaseIndex + '">−</button>' +
        '<input type="text" inputmode="' + (phaseIndex === 2 ? 'text' : 'numeric') + '" data-tempo-part="' + phaseIndex + '" value="' + escapeHtml(token) + '" />' +
        '<button type="button" data-circuit-tempo-delta="1" data-phase-index="' + phaseIndex + '">+</button>' +
      '</div></div>';
  }

  function circuitField(label, field, value, type) {
    const inputMode = type === "number" ? ' inputmode="numeric"' : '';
    return '<div class="circuit-field"><label>' + label + '</label><input type="' + type + '"' + inputMode +
      ' data-field="' + field + '" value="' + escapeHtml(String(value)) + '" /></div>';
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function syncCircuitTempoFromCard(card, index, saveNow) {
    const inputs = Array.from(card.querySelectorAll("[data-tempo-part]"))
      .sort((a, b) => Number(a.dataset.tempoPart) - Number(b.dataset.tempoPart));
    if (inputs.length !== 4) return;
    const tokens = inputs.map((input) => sanitiseTempoToken(input.value));
    inputs.forEach((input, i) => {
      input.value = tokens[i];
      input.classList.remove("invalid");
    });
    let candidate = tokens.join("-");
    if (!parseTempo(candidate)) {
      tokens[0] = "1";
      inputs[0].value = "1";
      candidate = tokens.join("-");
    }
    circuit[index].tempo = candidate;
    const code = card.querySelector("[data-tempo-code]");
    if (code) code.textContent = candidate;
    if (saveNow) saveSettings();
    else updateEstimate();
  }

  function updateTempoUI(tempo, activeIndex = -1) {
    const parts = parseTempo(tempo) || parseTempo("3-1-1-1");
    els.tempoDisplay.textContent = parts.map((part) => part.token).join("-");
    [els.tempo0, els.tempo1, els.tempo2, els.tempo3].forEach((el, i) => { el.textContent = parts[i].token; });
    els.tempoPhases.querySelectorAll(".tempo-phase").forEach((el, i) => {
      el.classList.toggle("active", i === activeIndex);
    });
  }

  function updateIdlePreview() {
    if (state !== "idle") return;
    const items = buildProgram();
    const item = items[0];
    els.exerciseNameDisplay.textContent = item.name;
    els.exerciseProgress.textContent = mode === "circuit" ? "EXERCISE 1 / " + items.length : "SINGLE EXERCISE";
    els.setDisplay.textContent = "1 / " + item.sets;
    els.repDisplay.textContent = "0 / " + item.reps;
    updateTempoUI(item.tempo);
    const firstPhase = (parseTempo(item.tempo) || []).find((part) => part.seconds > 0);
    els.phaseLabel.textContent = "READY";
    els.timeDisplay.textContent = firstPhase ? formatPhaseSeconds(firstPhase.seconds * 1000, firstPhase.explosive) : "00:00";
    els.progressBar.style.width = "0%";
    els.elapsedDisplay.textContent = "00:00";
    els.statusBadge.textContent = "Idle";
  }

  function currentItem() {
    return program[currentItemIndex];
  }

  function setStatus(label, badge, live) {
    els.phaseLabel.textContent = label;
    els.statusBadge.textContent = badge;
    if (live) els.liveStatus.textContent = live;
  }

  function updateWorkoutHeader() {
    const item = currentItem();
    if (!item) return;
    els.exerciseNameDisplay.textContent = item.name;
    els.exerciseProgress.textContent = program.length > 1 ?
      "EXERCISE " + (currentItemIndex + 1) + " / " + program.length :
      "SINGLE EXERCISE";
    els.setDisplay.textContent = currentSet + " / " + item.sets;
    els.repDisplay.textContent = currentRep + " / " + item.reps;
    updateTempoUI(item.tempo, currentPhaseIndex);
  }

  function getVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => /^en[-_](GB|SG)/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) || voices[0] || null;
  }

  function speak(text, options) {
    options = options || {};
    const enabled = options.force || els.voiceEnabled.checked;
    if (!enabled || !("speechSynthesis" in window)) return false;
    if (isIOS && !speechUnlocked && !options.force) return false;
    if (options.replace && !isIOS) window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getVoice();
    if (voice && !isIOS) utterance.voice = voice;
    utterance.lang = "en-US";
    utterance.volume = 1;
    utterance.rate = 1.05;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function clearNumericSpeechQueue() {
    numericSpeechQueue = [];
    numericSpeechBusy = false;
    if (numericSpeechGapTimer) {
      clearTimeout(numericSpeechGapTimer);
      numericSpeechGapTimer = null;
    }
  }

  function queueNumericCue(value, gapAfterMs = 220) {
    if (!els.voiceEnabled.checked || !els.speakTiming.checked || !("speechSynthesis" in window)) return;
    if (isIOS && !speechUnlocked) return;
    numericSpeechQueue.push({ text: String(value), gapAfterMs: gapAfterMs });
    drainNumericSpeechQueue();
  }

  function drainNumericSpeechQueue() {
    if (numericSpeechBusy || numericSpeechQueue.length === 0 || !("speechSynthesis" in window)) return;

    // Let non-numeric announcements such as "Set 2" finish before the numeric cadence begins.
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      numericSpeechGapTimer = setTimeout(drainNumericSpeechQueue, 90);
      return;
    }

    const next = numericSpeechQueue.shift();
    numericSpeechBusy = true;

    const utterance = new SpeechSynthesisUtterance(next.text);
    const voice = getVoice();
    if (voice && !isIOS) utterance.voice = voice;
    utterance.lang = "en-US";
    utterance.volume = 1;
    utterance.rate = 1.15;
    utterance.pitch = 1;

    const finish = () => {
      numericSpeechBusy = false;
      numericSpeechGapTimer = setTimeout(drainNumericSpeechQueue, next.gapAfterMs);
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeech() {
    clearNumericSpeechQueue();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function configureIOSAudioSession() {
    try {
      if (navigator.audioSession && "type" in navigator.audioSession) navigator.audioSession.type = "playback";
    } catch (_) {}
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioContextCtor) audioContext = new AudioContextCtor();
    }
    if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
  }

  function primeAudio() {
    configureIOSAudioSession();
    ensureAudio();
  }

  function beep(frequency, duration) {
    if (!els.beepEnabled.checked) return;
    ensureAudio();
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency || 880;
    const d = duration || 0.08;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + d);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + d + 0.02);
  }

  function testSpeechFromUserGesture() {
    if (!("speechSynthesis" in window)) {
      els.soundTest.textContent = "Voice unavailable";
      return;
    }
    primeAudio();
    const utterance = new SpeechSynthesisUtterance("Voice counter ready");
    utterance.lang = "en-US";
    utterance.volume = 1;
    utterance.rate = 0.95;
    let started = false;
    clearTimeout(speechTestTimer);
    els.soundTest.textContent = "Testing sound…";
    utterance.onstart = () => {
      started = true;
      speechUnlocked = true;
      els.soundTest.textContent = "Sound enabled ✓";
    };
    utterance.onend = () => {
      speechUnlocked = true;
      els.soundTest.textContent = "Sound enabled ✓";
    };
    utterance.onerror = () => { els.soundTest.textContent = "Retry sound"; };
    window.speechSynthesis.speak(utterance);
    speechTestTimer = setTimeout(() => {
      if (!started && !window.speechSynthesis.speaking) els.soundTest.textContent = "Retry sound";
    }, 1400);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (_) { wakeLock = null; }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function setRunningUI(running) {
    document.body.classList.toggle("running", running);
    els.startButton.disabled = running;
    els.pauseButton.disabled = !running;
  }

  function startTimedState(nextState, durationMs) {
    state = nextState;
    phaseDuration = durationMs;
    phaseStartedAt = performance.now();
    lastSpokenSecond = Math.ceil(durationMs / 1000) + 1;
    scheduleFrame();
  }

  function beginCountdown() {
    currentPhaseIndex = -1;
    updateWorkoutHeader();
    setStatus("GET READY", "Starting", "Get ready");
    startTimedState("countdown", 3000);
  }

  function beginRep() {
    currentRep += 1;
    currentPhaseIndex = -1;
    updateWorkoutHeader();

    // Rep count stays numeric-only. Give it a little more breathing room
    // before the first tempo number so every cue is intelligible.
    queueNumericCue(currentRep, 320);

    beep(920, 0.06);
    beginPhase(0, currentRep === 1);
  }

  function beginPhase(index, announceSet = false) {
    const item = currentItem();
    const tempo = parseTempo(item.tempo) || parseTempo("3-1-1-1");
    let next = index;
    while (next < 4 && tempo[next].seconds === 0) next += 1;
    if (next >= 4) {
      finishRep();
      return;
    }

    currentPhaseIndex = next;
    updateWorkoutHeader();
    const part = tempo[next];
    const phase = PHASES[next];

    setStatus(part.explosive ? "EXPLODE" : phase.label, "Working", phase.label);

    if (announceSet && currentRep === 1) {
      // Keep the set announcement, but never prefix the rep or tempo numbers with words.
      speak("Set " + currentSet);
    }

    // First number for the phase is queued immediately; subsequent seconds are queued
    // by maybeSpeakCountdown(). Nothing is dropped if the speech engine is still busy.
    queueNumericCue(part.explosive ? "X" : part.seconds, 180);

    beep(part.explosive ? 1120 : 760 + next * 80, 0.045);
    startTimedState("phase", part.seconds * 1000);
    lastSpokenSecond = part.seconds;
    els.timeDisplay.textContent = formatPhaseSeconds(part.seconds * 1000, part.explosive);
  }

  function finishRep() {
    const item = currentItem();
    currentPhaseIndex = -1;
    updateTempoUI(item.tempo);
    if (currentRep < item.reps) {
      beginRep();
      return;
    }
    if (currentSet < item.sets) {
      pendingAdvance = "next-set";
      beginRest(item.rest);
      return;
    }
    if (currentItemIndex < program.length - 1) {
      pendingAdvance = "next-exercise";
      beginRest(item.rest);
      return;
    }
    completeWorkout();
  }

  function beginRest(seconds) {
    if (seconds <= 0) {
      advanceAfterRest();
      return;
    }
    currentPhaseIndex = -1;
    updateWorkoutHeader();
    setStatus("REST", "Resting", "Rest");
    speak("Rest " + seconds + " seconds.", { replace: true });
    beep(520, 0.1);
    startTimedState("rest", seconds * 1000);
  }

  function advanceAfterRest() {
    if (pendingAdvance === "next-set") {
      currentSet += 1;
      currentRep = 0;
      pendingAdvance = null;
      beginRep();
      return;
    }
    if (pendingAdvance === "next-exercise") {
      currentItemIndex += 1;
      currentSet = 1;
      currentRep = 0;
      pendingAdvance = null;
      updateWorkoutHeader();
      speak("Next exercise. " + currentItem().name, { replace: true });
      beginRep();
    }
  }

  function getElapsedMs(now) {
    if (!workoutStartedAt) return 0;
    if (state === "complete") return finalElapsedMs;
    const point = state === "paused" ? pauseStartedAt : (now || performance.now());
    return Math.max(0, point - workoutStartedAt - totalPausedMs);
  }

  function completeWorkout() {
    finalElapsedMs = getElapsedMs(performance.now());
    state = "complete";
    cancelAnimationFrame(rafId);
    rafId = null;
    currentPhaseIndex = -1;
    updateWorkoutHeader();
    updateTempoUI(currentItem().tempo);
    setStatus("COMPLETE", "Done", "Workout complete");
    els.timeDisplay.textContent = "00:00";
    els.progressBar.style.width = "100%";
    els.elapsedDisplay.textContent = formatClock(finalElapsedMs);
    els.pauseButton.disabled = true;
    els.startButton.disabled = false;
    els.startButton.textContent = "Start again";
    document.body.classList.remove("running");
    speak("Workout complete.");
    if (els.beepEnabled.checked) {
      beep(740, 0.08);
      setTimeout(() => beep(880, 0.08), 130);
      setTimeout(() => beep(1040, 0.12), 260);
    }
    releaseWakeLock();
  }

  function maybeSpeakCountdown(remainingSeconds) {
    if (remainingSeconds <= 0 || remainingSeconds === lastSpokenSecond) return;

    if (state === "countdown") {
      queueNumericCue(remainingSeconds, 180);
    }

    if (state === "phase" && els.speakTiming.checked) {
      const tempo = parseTempo(currentItem().tempo);
      const part = tempo && tempo[currentPhaseIndex];
      if (part && !part.explosive) {
        queueNumericCue(remainingSeconds, 180);
      }
    }

    if (state === "rest" && [10, 5, 3, 2, 1].includes(remainingSeconds)) {
      // Keep rest cues readable, but do not allow them to erase queued numeric tempo cues.
      const cue = remainingSeconds >= 5 ? remainingSeconds + " seconds remaining" : String(remainingSeconds);
      speak(cue);
    }

    lastSpokenSecond = remainingSeconds;
  }

  function updateFrame(now) {
    els.elapsedDisplay.textContent = formatClock(getElapsedMs(now));
    if (!["countdown", "phase", "rest"].includes(state)) return;

    const elapsed = Math.max(0, now - phaseStartedAt);
    const remaining = Math.max(0, phaseDuration - elapsed);
    const remainingSeconds = Math.ceil(remaining / 1000);
    const progress = phaseDuration > 0 ? elapsed / phaseDuration : 1;

    if (state === "phase") {
      const tempo = parseTempo(currentItem().tempo);
      const part = tempo[currentPhaseIndex];
      els.timeDisplay.textContent = formatPhaseSeconds(remaining, part.explosive);
    } else {
      els.timeDisplay.textContent = "00:" + String(remainingSeconds).padStart(2, "0");
    }
    els.progressBar.style.width = clamp(progress * 100, 0, 100).toFixed(1) + "%";
    maybeSpeakCountdown(remainingSeconds);

    if (elapsed >= phaseDuration) {
      if (state === "countdown") {
        speak("Go");
        beginRep();
      } else if (state === "phase") {
        beginPhase(currentPhaseIndex + 1);
      } else if (state === "rest") {
        advanceAfterRest();
      }
    }
  }

  function scheduleFrame() {
    if (rafId || state === "paused") return;
    const frame = (now) => {
      rafId = null;
      updateFrame(now);
      if (["countdown", "phase", "rest"].includes(state)) rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }

  function unlockIOSVoiceOnStart() {
    if (!isIOS || speechUnlocked || !els.voiceEnabled.checked || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance("Ready");
    utterance.lang = "en-US";
    utterance.volume = 1;
    utterance.rate = 0.95;
    utterance.onstart = () => { speechUnlocked = true; };
    utterance.onend = () => { speechUnlocked = true; };
    window.speechSynthesis.speak(utterance);
  }

  function startWorkout() {
    stopSpeech();
    primeAudio();
    unlockIOSVoiceOnStart();
    program = buildProgram();
    currentItemIndex = 0;
    currentSet = 1;
    currentRep = 0;
    currentPhaseIndex = -1;
    pendingAdvance = null;
    pausedState = null;
    pauseRemaining = 0;
    workoutStartedAt = performance.now();
    totalPausedMs = 0;
    pauseStartedAt = 0;
    finalElapsedMs = 0;
    els.startButton.textContent = "Start";
    setRunningUI(true);
    requestWakeLock();
    updateWorkoutHeader();
    els.plannedDisplay.textContent = formatClock(estimateProgramMs(program));
    if (els.startCountdown.checked) beginCountdown();
    else beginRep();
  }

  function pauseWorkout() {
    if (!["countdown", "phase", "rest"].includes(state)) return;
    const now = performance.now();
    const elapsed = Math.max(0, now - phaseStartedAt);
    pausedState = state;
    pauseRemaining = Math.max(0, phaseDuration - elapsed);
    pauseStartedAt = now;
    state = "paused";
    cancelAnimationFrame(rafId);
    rafId = null;
    stopSpeech();
    els.pauseButton.textContent = "Resume";
    setStatus("PAUSED", "Paused", "Workout paused");
    els.elapsedDisplay.textContent = formatClock(getElapsedMs(now));
    releaseWakeLock();
  }

  function resumeWorkout() {
    if (state !== "paused" || !pausedState) return;
    const now = performance.now();
    totalPausedMs += Math.max(0, now - pauseStartedAt);
    state = pausedState;
    pausedState = null;
    const elapsedBeforePause = phaseDuration - pauseRemaining;
    phaseStartedAt = now - elapsedBeforePause;
    lastSpokenSecond = Math.ceil(pauseRemaining / 1000) + 1;
    els.pauseButton.textContent = "Pause";
    setStatus(state === "rest" ? "REST" : state === "countdown" ? "GET READY" : PHASES[currentPhaseIndex].label, "Running", "Workout resumed");
    speak("Resume");
    requestWakeLock();
    scheduleFrame();
  }

  function resetWorkout() {
    cancelAnimationFrame(rafId);
    rafId = null;
    stopSpeech();
    releaseWakeLock();
    state = "idle";
    pausedState = null;
    program = [];
    currentItemIndex = 0;
    currentSet = 1;
    currentRep = 0;
    currentPhaseIndex = -1;
    pendingAdvance = null;
    phaseStartedAt = 0;
    phaseDuration = 0;
    pauseRemaining = 0;
    workoutStartedAt = 0;
    pauseStartedAt = 0;
    totalPausedMs = 0;
    finalElapsedMs = 0;
    setRunningUI(false);
    els.startButton.disabled = false;
    els.startButton.textContent = "Start";
    els.pauseButton.textContent = "Pause";
    updateEstimate();
    updateIdlePreview();
  }

  document.querySelectorAll("[data-stepper]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state !== "idle" && state !== "complete") return;
      const key = button.dataset.stepper;
      const rule = LIMITS[key];
      const input = els[key];
      const delta = Number(button.dataset.delta);
      input.value = clamp(safeInt(input.value, rule) + delta, rule.min, rule.max);
      saveSettings();
    });
  });

  document.querySelectorAll("[data-tempo-step]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state !== "idle" && state !== "complete") return;
      const index = Number(button.dataset.tempoStep);
      const input = phaseInputs()[index];
      const delta = Number(button.dataset.delta);
      const current = input.value.trim().toUpperCase() === "X" ? 1 : Number.parseInt(input.value, 10) || 0;
      input.value = String(clamp(current + delta, 0, 30));
      syncSingleTempoFromPhaseInputs(true);
    });
  });

  [els.exerciseName, els.sets, els.reps, els.restSeconds].forEach((input) => {
    input.addEventListener("change", saveSettings);
    input.addEventListener("blur", saveSettings);
  });

  phaseInputs().forEach((input) => {
    input.addEventListener("change", () => syncSingleTempoFromPhaseInputs(true));
    input.addEventListener("blur", () => syncSingleTempoFromPhaseInputs(true));
  });

  els.tempo.addEventListener("input", () => {
    const valid = parseTempo(els.tempo.value);
    els.tempo.classList.toggle("invalid", !valid);
    if (valid) {
      syncSinglePhaseInputsFromTempo();
      updateEstimate();
    }
  });
  els.tempo.addEventListener("blur", () => {
    els.tempo.value = normaliseTempo(els.tempo.value);
    syncSinglePhaseInputsFromTempo();
    saveSettings();
  });

  [els.voiceEnabled, els.speakTiming, els.startCountdown, els.beepEnabled].forEach((input) => {
    input.addEventListener("change", saveSettings);
  });

  els.singleModeButton.addEventListener("click", () => setMode("single"));
  els.circuitModeButton.addEventListener("click", () => setMode("circuit"));

  els.addExerciseButton.addEventListener("click", () => {
    circuit.push({ name: "Exercise " + (circuit.length + 1), sets: 3, reps: 10, tempo: "3-1-1-1", rest: 30 });
    renderCircuit();
    saveSettings();
  });

  els.circuitList.addEventListener("input", (event) => {
    const card = event.target.closest(".circuit-card");
    if (!card) return;
    const index = Number(card.dataset.index);

    if (event.target.dataset.tempoPart !== undefined) {
      syncCircuitTempoFromCard(card, index, false);
      return;
    }

    const field = event.target.dataset.field;
    if (!field) return;
    circuit[index][field] = event.target.value;
    updateEstimate();
  });

  els.circuitList.addEventListener("change", (event) => {
    const card = event.target.closest(".circuit-card");
    if (card && event.target.dataset.tempoPart !== undefined) {
      syncCircuitTempoFromCard(card, Number(card.dataset.index), true);
      return;
    }
    saveSettings();
  });

  els.circuitList.addEventListener("click", (event) => {
    const card = event.target.closest(".circuit-card");
    if (!card) return;
    const index = Number(card.dataset.index);

    const tempoButton = event.target.closest("[data-circuit-tempo-delta]");
    if (tempoButton) {
      const phaseIndex = Number(tempoButton.dataset.phaseIndex);
      const input = card.querySelector('[data-tempo-part="' + phaseIndex + '"]');
      const delta = Number(tempoButton.dataset.circuitTempoDelta);
      const current = input.value.trim().toUpperCase() === "X" ? 1 : Number.parseInt(input.value, 10) || 0;
      input.value = String(clamp(current + delta, 0, 30));
      syncCircuitTempoFromCard(card, index, true);
      return;
    }

    const restButton = event.target.closest("[data-circuit-rest-delta]");
    if (restButton) {
      const input = card.querySelector('[data-field="rest"]');
      const delta = Number(restButton.dataset.circuitRestDelta);
      input.value = String(clamp((Number.parseInt(input.value, 10) || 0) + delta, 0, 600));
      circuit[index].rest = input.value;
      saveSettings();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "remove" && circuit.length > 1) circuit.splice(index, 1);
    if (action === "duplicate") circuit.splice(index + 1, 0, { ...circuit[index] });
    if (action === "up" && index > 0) [circuit[index - 1], circuit[index]] = [circuit[index], circuit[index - 1]];
    if (action === "down" && index < circuit.length - 1) [circuit[index + 1], circuit[index]] = [circuit[index], circuit[index + 1]];
    renderCircuit();
    saveSettings();
  });

  els.startButton.addEventListener("click", startWorkout);
  els.pauseButton.addEventListener("click", () => state === "paused" ? resumeWorkout() : pauseWorkout());
  els.resetButton.addEventListener("click", resetWorkout);

  els.soundTest.addEventListener("click", () => {
    if (isIOS && !isSafariIOS) {
      alert("For reliable spoken cues on iPhone, open this page directly in Safari.");
      return;
    }
    if (isIOS) {
      testSpeechFromUserGesture();
      return;
    }
    stopSpeech();
    speak("Voice counter ready.", { force: true });
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (event.code === "Space" && (state === "paused" || ["countdown", "phase", "rest"].includes(state))) {
      event.preventDefault();
      state === "paused" ? resumeWorkout() : pauseWorkout();
    }
    if (event.key.toLowerCase() === "r") resetWorkout();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ["countdown", "phase", "rest"].includes(state)) {
      requestWakeLock();
      updateFrame(performance.now());
      scheduleFrame();
    }
  });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
  } else {
    els.voiceEnabled.checked = false;
    els.voiceEnabled.disabled = true;
    els.speakTiming.checked = false;
    els.speakTiming.disabled = true;
    els.soundTest.disabled = true;
  }

  configureIOSAudioSession();
  loadSettings();
  renderCircuit();
  setMode(mode, false);
  resetWorkout();

  if (isIOS) els.soundTest.textContent = isSafariIOS ? "Test iPhone voice" : "Open in Safari for voice";
})();
