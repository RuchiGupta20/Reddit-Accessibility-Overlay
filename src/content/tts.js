// TTS TODOS: 

// [X] Reduce voice options...only give 5 of the best/most natural ones
// [ ] Add a save button to TTS settings
// [X] Fix play title so it doesnt open in new page
// [X] Make the listen button prettier
// [X] Add progress bar to player
// [ ] Add Focused Reading Mode (line-by-line highlighting)
// [X] Fix pause and play buttons (esp for comments)
// [X] Contemplate where playback speed setting should go 
// [ ] What to do about images with text...

var ttsVoices = [];
var ttsSession = null;

const HL_WORD_CLASS = "rao-hl-word";
const HL_ACTIVE_CLASS = "rao-hl-active";

const VOICE_PRIORITY = [
  "Google US English",
  "Google UK English Female",
  "Google UK English Male",
  "Samantha",
  "Alex",
  "Zira",
  "David",
  "Karen",
  "Daniel",
  "Moira",
];

function pickBestVoices(all) {
  const picked = [];
  for (const name of VOICE_PRIORITY) {
    if (picked.length >= 5) break;
    const match = all.find(v => v.name.includes(name) && !picked.includes(v));
    if (match) picked.push(match);
  }
  for (const v of all) {
    if (picked.length >= 5) break;
    if (!picked.includes(v)) picked.push(v);
  }
  return picked;
}

(function initVoices() {
  function load() {
    const all = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
    ttsVoices = pickBestVoices(all);
  }
  load();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    load();
    if (overlayElements?.ttsVoiceInput) populateVoiceSelect(overlayElements.ttsVoiceInput);
  });
})();

function populateVoiceSelect(select) {
  const prev = select.value;
  select.innerHTML = '<option value="">Default voice</option>' +
    ttsVoices.map(v => `<option value="${v.voiceURI}">${v.name}</option>`).join("");
  if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
}

function wrapAndExtract(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (!n.parentElement.closest("button, .rao-tts-wrapper, .rao-post-player, .rao-comment-player")) {
      textNodes.push(n);
    }
  }

  let raw = "";
  const spans = [];

  for (const tn of textNodes) {
    const tokens = tn.textContent.split(/(\s+)/);
    const frag = document.createDocumentFragment();
    for (const tok of tokens) {
      if (!tok || /^\s+$/.test(tok)) {
        frag.appendChild(document.createTextNode(tok));
        raw += tok;
      } else {
        const span = document.createElement("span");
        span.className = HL_WORD_CLASS;
        span.textContent = tok;
        spans.push({ el: span, start: raw.length, length: tok.length });
        frag.appendChild(span);
        raw += tok;
      }
    }
    tn.replaceWith(frag);
  }

  const leadingWS = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const correctedSpans = spans
    .map(s => ({ ...s, start: s.start - leadingWS }))
    .filter(s => s.start >= 0);

  return { text, spans: correctedSpans };
}

function unwrapWords(el) {
  el.querySelectorAll(`.${HL_WORD_CLASS}`).forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
  el.normalize();
}

function clearWordHighlight() {
  document.querySelectorAll(`.${HL_ACTIVE_CLASS}`).forEach(el => el.classList.remove(HL_ACTIVE_CLASS));
}

function extractReadableText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    "button, [role='button'], svg, .rao-tts-btn, .rao-tts-wrapper, .rao-post-player, .rao-comment-player, faceplate-number, shreddit-award-button"
  ).forEach(nd => nd.remove());
  return ((clone.innerText || clone.textContent) ?? "").trim().replace(/\s+/g, " ");
}

function setPlayerState(player, state) {
  player.dataset.ttsState = state;
  const btn = player.querySelector(".rao-ctrl-play");
  if (!btn) return;
  btn.textContent = state === "playing" ? "⏸" : "▶";
  btn.setAttribute("aria-label", state === "playing" ? "Pause" : "Play");
}

function updateProgress(player, ratio) {
  const fill = player.querySelector(".rao-player-progress-fill");
  if (fill) fill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
}

function stopTTS() {
  window.speechSynthesis.cancel();
  if (!ttsSession) return;
  clearWordHighlight();
  for (const seg of ttsSession.segments) {
    if (seg.wrapped && seg.el) unwrapWords(seg.el);
  }
  if (ttsSession.player) {
    setPlayerState(ttsSession.player, "idle");
    updateProgress(ttsSession.player, 0);
  }
  ttsSession.onStateChange?.("idle");
  ttsSession = null;
}

function getVoice() {
  const uri = currentSettings.ttsVoice;
  return uri ? (window.speechSynthesis.getVoices().find(v => v.voiceURI === uri) ?? null) : null;
}

function startTTS(player, segments, highlightEnabled, onStateChange) {
  stopTTS();

  let fullText = "";
  const processedSegs = [];

  for (const raw of segments) {
    const prefix = raw.label ? `${raw.label}: ` : "";
    const utteranceStart = fullText.length + prefix.length;
    let text = "";
    let spans = [];
    let wrapped = false;

    if (raw.el && highlightEnabled) {
      const result = wrapAndExtract(raw.el);
      text = result.text;
      spans = result.spans;
      wrapped = true;
    } else {
      text = raw.staticText ?? ((raw.el?.innerText || raw.el?.textContent) ?? "").trim().replace(/\s+/g, " ");
    }

    fullText += prefix + text + " ";
    processedSegs.push({ ...raw, text, spans, wrapped, utteranceStart, utteranceEnd: utteranceStart + text.length });
  }

  if (!fullText.trim()) return;

  const utterance = new SpeechSynthesisUtterance(fullText.trim());
  utterance.rate = currentSettings.ttsRate ?? 1;
  const voice = getVoice();
  if (voice) utterance.voice = voice;

  const totalLen = Math.max(1, fullText.length);
  ttsSession = { player, segments: processedSegs, utterance, onStateChange: onStateChange ?? null };

  utterance.addEventListener("start", () => {
    if (player) setPlayerState(player, "playing");
    onStateChange?.("playing");
  });

  utterance.addEventListener("boundary", (e) => {
    const ci = e.charIndex;
    if (player) updateProgress(player, ci / totalLen);
    if (!highlightEnabled) return;
    clearWordHighlight();

    for (const seg of processedSegs) {
      if (!seg.wrapped || !seg.spans.length) continue;
      if (ci < seg.utteranceStart - 2 || ci > seg.utteranceEnd + 10) continue;
      const pos = ci - seg.utteranceStart;
      let best = null;
      for (const s of seg.spans) {
        if (s.start <= pos + 2) best = s;
        else break;
      }
      if (best) best.el.classList.add(HL_ACTIVE_CLASS);
      break;
    }
  });

  const onDone = () => {
    if (ttsSession?.utterance !== utterance) return;
    if (player) {
      updateProgress(player, 1);
      setTimeout(() => { if (ttsSession?.utterance === utterance) stopTTS(); }, 500);
    } else {
      stopTTS();
    }
  };
  utterance.addEventListener("end", onDone);
  utterance.addEventListener("error", () => { if (ttsSession?.utterance === utterance) stopTTS(); });

  window.speechSynthesis.speak(utterance);
}
