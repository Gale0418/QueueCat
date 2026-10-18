const paths: Record<string, string> = {
  cat: '<path d="M4 10 3.5 4.5q0-1 1-.5L10 7a16 16 0 0 1 4 0l5.5-3q1-.5 1 .5L20 10c3 8-1 11-8 11S1 18 4 10Z"/><path d="m7 13 1 1 1-1m6 0 1 1 1-1m-7 3q2 3 4 0M4 16H2m18 0h2"/><path d="M6 10h.01M18 10h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  retry: '<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>',
  folder: '<path d="M3 8V6q0-2 2-2h4l3 3h7q2 0 2 2v10q0 2-2 2H5q-2 0-2-2Z"/><path d="m9 13 1 1m4-1 1 1m-4 3q1 1 2 0"/>',
  link: '<path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4"/>',
};
export const icon = (name: string, cls = "") =>
  `<svg class="icon ${cls}" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.list}</svg>`;
