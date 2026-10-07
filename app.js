(() => {
  "use strict";

  const STORAGE_KEY = "setRepCounter.settings.v1";
  const SETTINGS = {
    sets: { min: 1, max: 99, fallback: 3 },
    reps: { min: 1, max: 999, fallback: 10 },
    repSeconds: { min: 1, max: 60, fallback: 5 },
    restSeconds: { min: 0, max: 600, fallback: 30 }
  };

  const els = {
    sets: document.getElementById("sets"),
    reps: document.getElementById("reps"),
    repSeconds: document.getElementById("repSeconds"),
    restSeconds: document.getElementById("restSeconds"),
    voiceEnabled: document.getElementById("voiceEnabled"),
    speakTiming: document.getElementById("speakTiming"),
    startCountdown: document.getElementById("startCountdown"),
    beepEnabled: document.getElementById("beepEnabled"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    resetButton: document.getElementById("resetButton"),
    soundTest: document.getElementById("soundTest"),
    phaseLabel: document.getElementById("phaseLabel"),
    statusBadge: document.getElementById("statusBadge"),
    setDisplay: document.getElementById("setDisplay"),
    repDisplay: document.getElementById("repDisplay"),
    timeDisplay: document.getElementById("timeDisplay"),
    progressBar: document.getElementById("progressBar"),
    liveStatus: document.getElementById("liveStatus")
  };

  let config = null;
  let state = "idle";
  let pausedState = null;
  let currentSet = 1;
  let currentRep = 0;
  let phaseEnd = 0;
  let phaseDuration = 0;
  let pauseRemaining = 0;
  let lastSpokenSecond = null;
  let rafId = null;
  let audioContext = null;
  let wakeLock = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function numericValue(key) {
    const rule = SETTINGS[key];
    const raw = Number.parseInt(els[key].value, 10);
    return clamp(Number.isFinite(raw) ? raw : rule.fallback, rule.min, rule.max);
  }

  function normaliseInputs() {
    Object.keys(SETTINGS).forEach((key) => {
      els[key].value = numericValue(key);
    });
  }

  function readConfig() {
    normaliseInputs();
    return {
      sets: numericValue("sets"),
      reps: numericValue("reps"),
      repSeconds: numericValue("repSeconds"),
      restSeconds: numericValue("restSeconds"),
      voiceEnabled: els.voiceEnabled.checked,
      speakTiming: els.speakTiming.checked,
      startCountdown: els.startCountdown.checked,
      beepEnabled: els.beepEnabled.checked
    };
  }

  function saveSettings() {
    const settings = readConfig();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {
      // Storage can be blocked in privacy modes; the app still works.
    }
    updateIdlePreview();
  }

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      for (const key of Object.keys(SETTINGS)) {
        if (stored[key] !== undefined) els[key].value = stored[key];
      }
      for (const key of ["voiceEnabled", "speakTiming", "startCountdown", "beepEnabled"]) {
        if (typeof stored[key] === "boolean") els[key].checked = stored[key];
      }
    } catch (_) {
      // Ignore malformed or unavailable storage.
    }
    normaliseInputs();
  }

  function setStatus(label, badge, liveText = null) {
    els.phaseLabel.textContent = label;
    els.statusBadge.textContent = badge;
    if (liveText) els.liveStatus.textContent = liveText;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function updateIdlePreview() {
    if (state !== "idle") return;
    const preview = readConfig();
    els.setDisplay.textContent = "1 / " + preview.sets;
    els.repDisplay.textContent = "0 / " + preview.reps;
    els.timeDisplay.textContent = formatTime(preview.repSeconds);
    els.progressBar.style.width = "0%";
  }

  function getVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((voice) => /^en[-_](GB|SG)/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      voices[0] ||
      null
    );
  }

  function speak(text, { force = false } = {}) {
    const enabled = force || (config ? config.voiceEnabled : els.voiceEnabled.checked);
    if (!enabled || !("speechSynthesis" in window)) return;

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.2;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioContextCtor) audioContext = new AudioContextCtor();
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  }

  function beep(frequency = 880, duration = 0.09) {
    if (!(config ? config.beepEnabled : els.beepEnabled.checked)) return;
    ensureAudio();
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.02);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (_) {
      wakeLock = null;
    }
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
    els.resetButton.disabled = false;
  }

  function beginCountdown() {
    state = "countdown";
    phaseDuration = 3000;
    phaseEnd = performance.now() + phaseDuration;
    lastSpokenSecond = 4;
    setStatus("GET READY", "Starting", "Get ready");
    updateFrame(performance.now());
    scheduleFrame();
  }

  function beginRep(firstOfSet = false) {
    state = "rep";
    currentRep += 1;
    phaseDuration = config.repSeconds * 1000;
    phaseEnd = performance.now() + phaseDuration;
    lastSpokenSecond = config.repSeconds;
    setStatus("WORK", "Running", "Set " + currentSet + ", rep " + currentRep);

    const prefix = firstOfSet ? "Set " + currentSet + ". " : "";
    const timing = config.speakTiming ? ". " + config.repSeconds + " seconds" : "";
    speak(prefix + "Rep " + currentRep + timing);
    beep(920, 0.07);

    updateFrame(performance.now());
    scheduleFrame();
  }

  function beginRest() {
    if (config.restSeconds <= 0) {
      currentSet += 1;
      currentRep = 0;
      beginRep(true);
      return;
    }

    state = "rest";
    phaseDuration = config.restSeconds * 1000;
    phaseEnd = performance.now() + phaseDuration;
    lastSpokenSecond = config.restSeconds + 1;
    setStatus("REST", "Resting", "Set " + currentSet + " complete. Rest.");
    speak("Set " + currentSet + " complete. Rest " + config.restSeconds + " seconds.");
    beep(520, 0.12);

    updateFrame(performance.now());
    scheduleFrame();
  }

  function completeWorkout() {
    state = "complete";
    cancelAnimationFrame(rafId);
    rafId = null;
    stopSpeech();
    speak("Workout complete.");
    setStatus("COMPLETE", "Done", "Workout complete");
    els.timeDisplay.textContent = "00:00";
    els.progressBar.style.width = "100%";
    els.pauseButton.disabled = true;
    els.startButton.disabled = false;
    els.startButton.textContent = "Start again";
    document.body.classList.remove("running");

    if (config.beepEnabled) {
      beep(740, 0.08);
      setTimeout(() => beep(880, 0.08), 130);
      setTimeout(() => beep(1040, 0.12), 260);
    }
    releaseWakeLock();
  }

  function handlePhaseEnd() {
    if (state === "countdown") {
      speak("Go");
      currentRep = 0;
      beginRep(true);
      return;
    }

    if (state === "rep") {
      if (currentRep < config.reps) {
        beginRep(false);
      } else if (currentSet < config.sets) {
        beginRest();
      } else {
        completeWorkout();
      }
      return;
    }

    if (state === "rest") {
      currentSet += 1;
      currentRep = 0;
      beginRep(true);
    }
  }

  function maybeSpeakTiming(remainingSeconds) {
    if (!config.speakTiming || remainingSeconds <= 0 || remainingSeconds === lastSpokenSecond) return;

    if (state === "countdown") {
      speak(String(remainingSeconds));
      lastSpokenSecond = remainingSeconds;
      return;
    }

    if (state === "rep" && remainingSeconds < config.repSeconds) {
      speak(String(remainingSeconds));
      lastSpokenSecond = remainingSeconds;
      return;
    }

    if (state === "rest") {
      const shouldSpeak =
        remainingSeconds === 10 ||
        remainingSeconds === 5 ||
        remainingSeconds === 3 ||
        remainingSeconds === 2 ||
        remainingSeconds === 1;

      if (shouldSpeak) {
        speak(remainingSeconds >= 5 ? remainingSeconds + " seconds remaining" : String(remainingSeconds));
      }
      lastSpokenSecond = remainingSeconds;
    }
  }

  function updateFrame(now) {
    if (!["countdown", "rep", "rest"].includes(state)) return;

    const remainingMs = Math.max(0, phaseEnd - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const progress = phaseDuration > 0 ? 1 - remainingMs / phaseDuration : 1;

    els.setDisplay.textContent = currentSet + " / " + config.sets;
    els.repDisplay.textContent = currentRep + " / " + config.reps;
    els.timeDisplay.textContent = formatTime(remainingSeconds);
    els.progressBar.style.width = clamp(progress * 100, 0, 100).toFixed(1) + "%";

    maybeSpeakTiming(remainingSeconds);

    if (remainingMs <= 0) handlePhaseEnd();
  }

  function scheduleFrame() {
    if (rafId || state === "paused") return;
    const frame = (now) => {
      rafId = null;
      updateFrame(now);
      if (["countdown", "rep", "rest"].includes(state)) {
        rafId = requestAnimationFrame(frame);
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  function startWorkout() {
    stopSpeech();
    ensureAudio();
    config = readConfig();
    currentSet = 1;
    currentRep = 0;
    pausedState = null;
    pauseRemaining = 0;
    els.startButton.textContent = "Start";
    setRunningUI(true);
    requestWakeLock();

    if (config.startCountdown) {
      beginCountdown();
    } else {
      beginRep(true);
    }
  }

  function pauseWorkout() {
    if (!["countdown", "rep", "rest"].includes(state)) return;
    pausedState = state;
    pauseRemaining = Math.max(0, phaseEnd - performance.now());
    state = "paused";
    cancelAnimationFrame(rafId);
    rafId = null;
    stopSpeech();
    els.pauseButton.textContent = "Resume";
    setStatus("PAUSED", "Paused", "Workout paused");
    releaseWakeLock();
  }

  function resumeWorkout() {
    if (state !== "paused" || !pausedState) return;
    state = pausedState;
    phaseEnd = performance.now() + pauseRemaining;
    pausedState = null;
    lastSpokenSecond = Math.ceil(pauseRemaining / 1000);
    els.pauseButton.textContent = "Pause";
    setStatus(state === "rest" ? "REST" : state === "countdown" ? "GET READY" : "WORK", "Running", "Workout resumed");
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
    config = null;
    currentSet = 1;
    currentRep = 0;
    phaseEnd = 0;
    phaseDuration = 0;
    pauseRemaining = 0;
    lastSpokenSecond = null;
    setRunningUI(false);
    els.startButton.disabled = false;
    els.startButton.textContent = "Start";
    els.pauseButton.textContent = "Pause";
    setStatus("READY", "Idle", "Ready");
    updateIdlePreview();
  }

  document.querySelectorAll("[data-stepper]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state !== "idle" && state !== "complete") return;
      const key = button.dataset.stepper;
      const delta = Number(button.dataset.delta);
      const rule = SETTINGS[key];
      const next = clamp(numericValue(key) + delta, rule.min, rule.max);
      els[key].value = next;
      saveSettings();
    });
  });

  Object.keys(SETTINGS).forEach((key) => {
    els[key].addEventListener("change", saveSettings);
    els[key].addEventListener("blur", saveSettings);
  });

  [els.voiceEnabled, els.speakTiming, els.startCountdown, els.beepEnabled].forEach((input) => {
    input.addEventListener("change", saveSettings);
  });

  els.startButton.addEventListener("click", startWorkout);
  els.pauseButton.addEventListener("click", () => {
    if (state === "paused") resumeWorkout();
    else pauseWorkout();
  });
  els.resetButton.addEventListener("click", resetWorkout);
  els.soundTest.addEventListener("click", () => {
    stopSpeech();
    speak("Voice counter ready.", { force: true });
    if (els.beepEnabled.checked) {
      ensureAudio();
      const saved = config;
      config = { beepEnabled: true };
      beep(880, 0.08);
      config = saved;
    }
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (typing) return;

    if (event.code === "Space" && (state === "paused" || ["countdown", "rep", "rest"].includes(state))) {
      event.preventDefault();
      if (state === "paused") resumeWorkout();
      else pauseWorkout();
    }

    if (event.key.toLowerCase() === "r") resetWorkout();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ["countdown", "rep", "rest"].includes(state)) {
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

  loadSettings();
  resetWorkout();
})();
