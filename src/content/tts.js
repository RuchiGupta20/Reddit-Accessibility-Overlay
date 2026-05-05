// TTS TODOS:

// [X] Reduce voice options...only give 5 of the best/most natural ones
// [X] Fix play title so it doesnt open in new page
// [X] Make the listen button prettier
// [X] Add progress bar to player
// [X] Add Focused Reading Mode (line-by-line highlighting)
    // [ ] Make focused reading mode obvious as a feature...nothing indicates its presense rn.
// [X] Fix pause and play buttons (esp for comments)
// [X] Contemplate where playback speed setting should go
// [X] Make mute button work on browser
// [ ] What to do about images with text...
// [ ] It's reading the embedded video titles and stuff...
// [ ] Add a save button to TTS settings?

var ttsVoices = [];
var ttsSession = null;
var tabMuted = false;

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

// Builds a list of word positions (node + offset) without mutating the DOM.
// Used by the CSS Custom Highlight API to highlight words as TTS progresses.
function extractWordRanges(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const words = [];
  let text = "";
  let n;

  while ((n = walker.nextNode())) {
    if (n.parentElement.closest("button, [role='button'], svg, .rao-tts-wrapper, .rao-post-player")) continue;
    const nodeText = n.textContent;
    let i = 0;
    while (i < nodeText.length) {
      if (/\s/.test(nodeText[i])) { text += nodeText[i++]; continue; }
      let j = i;
      while (j < nodeText.length && !/\s/.test(nodeText[j])) j++;
      words.push({ node: n, nodeOffset: i, length: j - i, textStart: text.length });
      text += nodeText.slice(i, j);
      i = j;
    }
  }

  const leadingWS = text.length - text.trimStart().length;
  return {
    text: text.trim(),
    words: words.map(w => ({ ...w, textStart: w.textStart - leadingWS })).filter(w => w.textStart >= 0),
  };
}

function extractReadableText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(
    "button, [role='button'], svg, .rao-tts-btn, .rao-tts-wrapper, .rao-post-player, .rao-comment-player, faceplate-number, shreddit-award-button"
  ).forEach(nd => nd.remove());
  return ((clone.innerText || clone.textContent) ?? "").trim().replace(/\s+/g, " ");
}

function clearWordHighlight() {
  CSS.highlights?.delete("rao-active-word");
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

function showMuteToast() {
  if (document.querySelector(".rao-mute-toast")) return;
  const toast = document.createElement("div");
  toast.className = "rao-mute-toast";
  toast.textContent = "Tab is muted — unmute the tab to use text-to-speech";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function startTTS(player, segments, highlightEnabled, onStateChange) {
  if (tabMuted) { showMuteToast(); return; }
  stopTTS();

  let fullText = "";
  const processedSegs = [];

  for (const raw of segments) {
    const prefix = raw.label ? `${raw.label}: ` : "";
    const utteranceStart = fullText.length + prefix.length;
    let text = "";
    let words = [];

    if (raw.el && highlightEnabled) {
      const result = extractWordRanges(raw.el);
      text = result.text;
      words = result.words;
    } else {
      text = raw.staticText ?? ((raw.el?.innerText || raw.el?.textContent) ?? "").trim().replace(/\s+/g, " ");
    }

    fullText += prefix + text + " ";
    processedSegs.push({ ...raw, text, words, utteranceStart, utteranceEnd: utteranceStart + text.length });
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
      if (!seg.words.length) continue;
      if (ci < seg.utteranceStart - 2 || ci > seg.utteranceEnd + 10) continue;
      const pos = ci - seg.utteranceStart;
      let best = null;
      for (const w of seg.words) {
        if (w.textStart <= pos + 2) best = w;
        else break;
      }
      if (best && CSS.highlights) {
        const range = new Range();
        range.setStart(best.node, best.nodeOffset);
        range.setEnd(best.node, best.nodeOffset + best.length);
        CSS.highlights.set("rao-active-word", new Highlight(range));
      }
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

// --- Focused Reading Mode ---

var focusSession = null;

function clearFocusedReading() {
  if (!focusSession) return;
  CSS.highlights?.delete("rao-focused-sentence");
  focusSession.dimEl?.removeAttribute("data-rao-dim");
  focusSession.playBtn?.remove();
  stopTTS();
  focusSession = null;
}

function findSentenceRange(clickedNode, clickedOffset) {
  const blockEl = clickedNode.parentElement?.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, td") ?? clickedNode.parentElement;
  if (!blockEl) return null;

  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  const nodeMap = [];
  let fullText = "";
  let n;
  while ((n = walker.nextNode())) {
    nodeMap.push({ node: n, start: fullText.length });
    fullText += n.textContent;
  }

  const entry = nodeMap.find(m => m.node === clickedNode);
  if (!entry) return null;
  const clickPos = entry.start + clickedOffset;

  let sentenceStart = 0;
  for (let i = clickPos - 1; i >= 1; i--) {
    if (/[.!?]/.test(fullText[i - 1]) && /\s/.test(fullText[i])) {
      sentenceStart = i + 1;
      break;
    }
  }
  while (sentenceStart < fullText.length && /\s/.test(fullText[sentenceStart])) sentenceStart++;

  let sentenceEnd = fullText.length;
  for (let i = clickPos; i < fullText.length; i++) {
    if (/[.!?]/.test(fullText[i])) { sentenceEnd = i + 1; break; }
  }

  const range = document.createRange();
  let startSet = false, endSet = false;
  for (let i = 0; i < nodeMap.length; i++) {
    const { node, start } = nodeMap[i];
    const end = nodeMap[i + 1]?.start ?? fullText.length;
    if (!startSet && sentenceStart >= start && sentenceStart < end) {
      range.setStart(node, sentenceStart - start);
      startSet = true;
    }
    if (!endSet && sentenceEnd > start && sentenceEnd <= end) {
      range.setEnd(node, sentenceEnd - start);
      endSet = true;
    }
    if (startSet && endSet) break;
  }
  return startSet && endSet ? range : null;
}

function activateFocusedReading(e) {
  if (e.target.closest("#rao-root, .rao-post-player, .rao-focused-play-btn, .rao-comment-player-host")) return;

  const textContainer = e.target.closest("[slot='text-body'], .RichTextJSON-root, [slot='comment'], .md");
  if (!textContainer) { clearFocusedReading(); return; }

  const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) { clearFocusedReading(); return; }

  const range = findSentenceRange(caret.startContainer, caret.startOffset);
  if (!range || range.collapsed) { clearFocusedReading(); return; }

  clearFocusedReading();

  if (CSS.highlights) CSS.highlights.set("rao-focused-sentence", new Highlight(range));
  textContainer.setAttribute("data-rao-dim", "true");

  const rect = range.getBoundingClientRect();
  const btn = document.createElement("button");
  btn.className = "rao-focused-play-btn";
  btn.type = "button";
  btn.textContent = "▶ Play";
  btn.style.top = `${rect.top + window.scrollY - 38}px`;
  btn.style.left = `${rect.left + window.scrollX}px`;
  document.body.appendChild(btn);

  const text = range.toString().trim();
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    startTTS(null, [{ label: "", el: null, staticText: text }], false);
  });

  focusSession = { dimEl: textContainer, playBtn: btn };
}
