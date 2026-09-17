// Inline 24px line icons; labels remain the accessible names and tooltip text.
const icons = {
  'Play':'<path d="m8 5 11 7-11 7Z"/>',
  'Resume':'<path d="m8 5 11 7-11 7Z"/>',
  'Pause':'<path d="M8 5v14M16 5v14"/>',
  'Play again':'<path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/>',
  'Stop':'<rect x="6" y="6" width="12" height="12"/>',
  'Stop dictation':'<rect x="6" y="6" width="12" height="12"/>',
  'Dictate':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  'Dictate comment':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  'Comment on selection':'<path d="M21 15a3 3 0 0 1-3 3H7l-4 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3ZM9 10h6M12 7v6"/>',
  'Save comment':'<path d="m5 12 4 4L19 6"/>',
  'Back to notes':'<path d="m12 5-7 7 7 7M5 12h14"/>',
  'Discard draft':'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  'Resume comment':'<path d="M12 20h9M16 3l5 5L9 20l-6 1 1-6Z"/>',
  'Edit comment':'<path d="M12 20h9M16 3l5 5L9 20l-6 1 1-6Z"/>',
  'Delete comment':'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  'Show passage':'<path d="M4 3h16v18H4ZM8 7h8M8 11h8M8 15h4"/>',
  'Export sidecar':'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  'Cancel setup':'<path d="m6 6 12 12M6 18 18 6"/>'
};
// Unclear actions show a short visible word beside the icon; obvious ones (play, stop, mic, pencil, trash, download) stay icon-only.
const visibleText = { 'Comment on selection':'Comment', 'Save comment':'Save', 'Back to notes':'Back', 'Show passage':'Show passage', 'Resume comment':'Resume' };
let tooltip, owner, timer;
export function setButtonLabel(button, label) {
  if (!icons[label]) throw Error(`Missing button icon: ${label}`);
  const text = visibleText[label];
  button.classList.toggle('icon-button', !text); button.classList.toggle('text-button', !!text);
  button.setAttribute('aria-label', label);
  const svg = `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="${text ? 18 : 22}" height="${text ? 18 : 22}">${icons[label]}</svg>`;
  if (text) { button.innerHTML = `${svg}<span>${text}</span>`; delete button.dataset.tooltip; if (owner === button) hide(); return; }
  button.dataset.tooltip = label;
  button.innerHTML = svg;
  if (owner === button) show(button);
}
function hide() { clearTimeout(timer); if (tooltip) tooltip.hidden = true; owner = null; }
function show(button) {
  clearTimeout(timer); owner = button; tooltip.textContent = button.dataset.tooltip; tooltip.hidden = false;
  const rect = button.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2))}px`;
  tooltip.style.top = `${rect.bottom + box.height + 8 < innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6)}px`;
}
export function initializeIconButtons() {
  tooltip = document.createElement('div'); tooltip.className = 'button-tooltip'; tooltip.setAttribute('role','tooltip'); tooltip.hidden = true; document.body.append(tooltip);
  document.querySelectorAll('button').forEach(button => setButtonLabel(button, button.textContent.trim()));
  document.addEventListener('pointerover', event => {
    const button = event.target.closest('button.icon-button');
    if (button) show(button); else if (event.target === tooltip) clearTimeout(timer);
  });
  document.addEventListener('pointerout', event => {
    if (!owner || event.relatedTarget === tooltip || owner.contains(event.relatedTarget)) return;
    if (document.activeElement !== owner) timer = setTimeout(hide, 100);
  });
  document.addEventListener('focusin', event => { if (event.target.matches('button.icon-button')) show(event.target); });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
