import { initializeIconButtons, setButtonLabel } from './icon-buttons.mjs';
import { setupComments } from './comments-ui.mjs';
import { KokoroEngine } from './kokoro-engine.mjs';
import { GeneratedReader } from './generated-reader.mjs';
import { Dictation, appendTranscript } from './dictation.mjs';
const $ = id => document.getElementById(id);
initializeIconButtons();
export const PASSAGE = 'The Apothecary sank into his chair, the wood creaking beneath his weight. “They were to be bound to my will,” he admitted, the words bitter on his tongue. “The serum should have rendered them compliant, useful. Instead, they demonstrate independence and abilities I never anticipated.”';
const sentences = [...new Intl.Segmenter('en', { granularity:'sentence' }).segment(PASSAGE)].map(item => item.segment);
$('passage').replaceChildren(...sentences.map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
const evidence = { version:'simple-demo-1', startedAt:new Date().toISOString(), events:[] };
let storage;
try { storage = localStorage; $('notes').value = storage.getItem('tts-demo:notes') ?? ''; } catch {}
let savingFailed = false;
function saveNotes() {
  try { if (!storage) throw Error('Storage unavailable'); storage.setItem('tts-demo:notes', $('notes').value); savingFailed = false; }
  catch { savingFailed = true; $('dictation-status').textContent = 'Notes cannot be saved here. Copy them before closing this page.'; }
}
$('notes').oninput = saveNotes;
let reader, dictation, commentAudio, playable = null, voice = 'loading', voiceError = '';
const engine = new KokoroEngine(event => {
  if (event.type === 'initialized') evidence.events.push({ type:'model-ready', initializationMs:event.initializationMs });
});
engine.backend = 'webgpu';
function renderPlayback() {
  if (!reader) return;
  const state = reader.state;
  $('play').disabled = !playable || state === 'starting' || ['preparing','starting','stopping'].includes(dictation?.state);
  setButtonLabel($('play'), state === 'speaking' ? 'Pause' : state === 'paused' ? 'Resume' : state === 'finished' ? 'Play again' : 'Play');
  $('stop').disabled = !['starting','speaking','paused'].includes(state);
  const position = `Sentence ${Math.min(reader.index + 1, sentences.length)} of ${sentences.length}`;
  const idle = voice === 'loading' ? 'Loading voice (first time only)…' : voice === 'error' ? voiceError : 'Voice ready.';
  const messages = { idle, starting:'Preparing audio…', speaking:position, paused:`Paused · ${position}`, finished:'Finished.', error:reader.error };
  $('play-status').textContent = playable === null ? 'Checking playback support…' : playable ? messages[state] : 'Playback needs WebGPU. Try Chrome with hardware acceleration enabled.';
  $('play-status').classList.toggle('error', state === 'error' || playable === false || (state === 'idle' && voice === 'error'));
  [...$('passage').children].forEach((span, index) => span.classList.toggle('active', ['speaking','paused'].includes(state) && index === reader.index));
}
reader = new GeneratedReader({ engine, emit:event => { evidence.events.push({ ...event, at:performance.now() }); renderPlayback(); } });
reader.voiceURI = 'af_heart';
reader.load(sentences, 'fixed-demo'); // No saved playback position for this short fixed demo.
dictation = new Dictation({ Recognition:window.SpeechRecognition || window.webkitSpeechRecognition, append: text => {
  $('notes').value = appendTranscript($('notes').value, text); saveNotes();
  $('notes').scrollTop = $('notes').scrollHeight;
}, emit:event => {
  if (event.interim !== undefined) $('interim').textContent = event.interim;
  if (event.message !== undefined && !savingFailed) $('dictation-status').textContent = event.message || 'Type or dictate. Notes are saved on this device.';
  const active = event.state !== 'idle';
  setButtonLabel($('dictate'), event.state === 'preparing' ? 'Cancel setup' : active ? 'Stop dictation' : 'Dictate');
  $('dictate').setAttribute('aria-pressed', String(active));
  $('dictate').disabled = event.state === 'stopping';
  renderPlayback();
} });
$('play').onclick = () => {
  commentAudio?.cancel();
  if (reader.state === 'speaking') { reader.pause(); return; }
  dictation.cancel();
  if (reader.state === 'finished') reader.seek(0);
  reader.play();
};
$('stop').onclick = () => { reader.stop(); reader.seek(0); };
$('dictate').onclick = () => {
  commentAudio?.cancel();
  if (dictation.state !== 'idle') { dictation.stop(); return; }
  reader.stop(); reader.seek(0); dictation.start();
};
window.addEventListener('pagehide', () => { dictation.cancel(); reader.stop(); engine.dispose(); saveNotes(); });
window.ttsEvidence = () => ({ ...evidence, state:reader.state, dictationState:dictation.state, backend:'webgpu', voice:'af_heart' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
try { playable = !!await navigator.gpu?.requestAdapter(); } catch { playable = false; }
renderPlayback();
// Warm the model and the first sentence now, so the first Play starts at once instead of after a silent 5–13 s load.
if (playable) engine.initialize().then(() => { voice = 'ready'; if (reader.state === 'idle' && reader.index === 0) reader.prepare(0); }, error => { voice = 'error'; voiceError = `Voice could not load: ${error.message}`; }).finally(renderPlayback);

commentAudio = await setupComments({ text:PASSAGE, getGeneralNotes:() => $('notes').value, stopOtherAudio:() => { dictation.cancel(); reader.stop(); reader.seek(0); } });
