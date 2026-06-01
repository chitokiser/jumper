// /assets/js/esc.js — HTML 이스케이프 유틸
const _MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => _MAP[c]);
