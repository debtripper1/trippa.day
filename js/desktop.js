(function () {
  'use strict';

  let zIndexCounter = 10;
  let windowCounter = 0;
  let windows = {};
  let selectedIcon = null;
  let startMenuOpen = false;
  let shutdownOverlay = null;
  let darkMode = (function () { try { return localStorage.getItem('trippa-dark') === 'true'; } catch (e) { return false; } })();
  if (darkMode) document.body.classList.add('dark-mode');
  let unlocked = new Set();

  const DESKTOP = document.getElementById('desktop');
  const WINDOW_MANAGER = document.getElementById('window-manager');
  const TASKBAR_ITEMS = document.getElementById('taskbar-items');
  const START_BUTTON = document.getElementById('start-button');
  const START_MENU = document.getElementById('start-menu');
  const ICON_GRID = document.getElementById('icon-grid');
  const CLOCK = document.getElementById('clock');

  /* ========== CLOCK ========== */
  function updateClock() {
    const now = new Date();
    CLOCK.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ========== DESKTOP ICONS ========== */
  ICON_GRID.addEventListener('click', function (e) {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    if (selectedIcon) selectedIcon.classList.remove('selected');
    icon.classList.add('selected');
    selectedIcon = icon;
  });

  ICON_GRID.addEventListener('dblclick', function (e) {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    const app = icon.dataset.app;
    if (app) openWindow(app);
  });

  ICON_GRID.addEventListener('contextmenu', function (e) {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    icon.classList.add('selected');
    selectedIcon = icon;
  });

  /* Keyboard nav for desktop icons */
  ICON_GRID.addEventListener('keydown', function (e) {
    var icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      var app = icon.dataset.app;
      if (app) openWindow(app);
      return;
    }
    var icons = Array.from(ICON_GRID.querySelectorAll('.desktop-icon'));
    var idx = icons.indexOf(icon);
    if (e.key === 'ArrowRight') { e.preventDefault(); idx = (idx + 1) % icons.length; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); idx = (idx - 1 + icons.length) % icons.length; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 3, icons.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 3, 0); }
    else return;
    icons[idx].focus();
    if (selectedIcon) selectedIcon.classList.remove('selected');
    icons[idx].classList.add('selected');
    selectedIcon = icons[idx];
  });

  /* Deselect on background click */
  DESKTOP.addEventListener('mousedown', function (e) {
    if (e.target === DESKTOP || e.target === ICON_GRID || e.target.id === 'window-manager') {
      if (selectedIcon) selectedIcon.classList.remove('selected');
      selectedIcon = null;
    }
  });

  /* ========== WINDOW SYSTEM ========== */
  function openWindow(appType) {
    closeStartMenu();
    const config = getAppConfig(appType);
    if (!config) return;

    var existingId = Object.keys(windows).find(function (id) { return windows[id].config && windows[id].config.title === config.title; });
    if (existingId) {
      if (windows[existingId].minimized) {
        windows[existingId].minimized = false;
        windows[existingId].el.style.display = '';
      }
      focusWindow(existingId);
      return;
    }

    const id = 'win-' + (++windowCounter);
    const win = document.createElement('div');
    win.className = 'window active';
    win.dataset.windowId = id;
    win.style.width = config.width + 'px';
    win.style.height = config.height + 'px';
    var left = 40 + (windowCounter % 5) * 30;
    var top = 40 + (windowCounter % 5) * 25;
    if (left + config.width > window.innerWidth) left = Math.max(0, window.innerWidth - config.width - 10);
    if (top + config.height > window.innerHeight - 36) top = Math.max(0, window.innerHeight - 36 - config.height - 10);
    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.zIndex = ++zIndexCounter;

    win.innerHTML = buildWindowHTML(config, id);
    WINDOW_MANAGER.appendChild(win);

    const contentEl = win.querySelector('.window-content');
    if (config.content) contentEl.innerHTML = config.content;

    windows[id] = { el: win, config: config, minimized: false, maximized: false, prevRect: null, currentPath: null, resizeObserver: null };

    bindWindowEvents(win, id);
    addTaskbarItem(id, config);
    focusWindow(id);

    /* Observe content area resizes for responsive layout */
    var ro = new ResizeObserver(function () {
      triggerContentResize(id);
    });
    ro.observe(contentEl);
    windows[id].resizeObserver = ro;
    if (config.miniAppInit) {
      setTimeout(function () { config.miniAppInit(id); }, 50);
    }
    if (appType === 'files') {
      windows[id].currentPath = 'root';
      setTimeout(function () { bindFileClicks(id); }, 50);
    }
    if (appType === 'recycle') {
      setTimeout(function () { bindRecycleToggle(id); }, 50);
    }
  }

  function buildWindowHTML(config, id) {
    return `
      <div class="window-titlebar">
        <span class="window-titlebar-icon">${config.icon}</span>
        <span class="window-titlebar-text">${config.title}</span>
        <div class="window-titlebar-buttons">
          <button class="btn-minimize" data-win="${id}">_</button>
          <button class="btn-maximize" data-win="${id}">□</button>
          <button class="btn-close" data-win="${id}">✕</button>
        </div>
      </div>
      <div class="window-menubar">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </div>
      <div class="window-content"></div>
      <div class="window-statusbar">
        <span style="flex:1;">${config.statusText || ''}</span>
        <span class="resize-grip">▤</span>
      </div>
    `;
  }

  function getAppConfig(appType) {
    const appConfigs = {
      files: {
        title: 'File Browser',
        icon: '<img src="assets/icons/computer.png" width="16" height="16">',
        width: 580,
        height: 420,
        statusText: 'C:\\',
        content: getFilesContent()
      },
      downloads: {
        title: 'Downloads',
        icon: '<img src="assets/icons/download.png" width="16" height="16">',
        width: 500,
        height: 360,
        statusText: '0 items',
        content: getDownloadsContent()
      },
      apps: {
        title: 'Web Apps',
        icon: '<img src="assets/icons/world.png" width="16" height="16">',
        width: 480,
        height: 360,
        statusText: 'Available',
        content: getAppsContent()
      },
      settings: {
        title: 'Settings',
        icon: '<img src="assets/icons/settings.png" width="16" height="16">',
        width: 440,
        height: 400,
        statusText: 'System settings',
        content: getSettingsContent()
      },
      recycle: {
        title: 'Recycle Bin',
        icon: '<img src="assets/icons/recycle_bin.png" width="16" height="16">',
        width: 460,
        height: 340,
        statusText: 'Empty',
        content: getRecycleContent()
      }
    };
    if (miniApps[appType]) {
      const ma = miniApps[appType];
      return {
        title: ma.title,
        icon: ma.icon,
        width: ma.width,
        height: ma.height,
        statusText: ma.statusText,
        content: ma.content ? ma.content() : '',
        isMiniApp: true,
        miniAppInit: ma.init || null
      };
    }
    return appConfigs[appType] || null;
  }

  /* ========== APP CONTENT ========== */
  function getFilesContent() {
    return `<div class="file-browser" data-path="root"><div class="file-browser-nav">C:\\</div><div class="file-grid">${renderDir('root')}</div></div>`;
  }

  const virtualFS = {
    'root': { 'Music': { type: 'folder', icon: '📁' }, 'Documents': { type: 'folder', icon: '📁' }, 'Downloads': { type: 'folder', icon: '📁' }, 'Apps': { type: 'folder', icon: '📁' }, 'Projects': { type: 'folder', icon: '📁' }, 'Desktop': { type: 'folder', icon: '📁' } },
    'Music': { 'track1.mp3': { type: 'file', icon: '🎵', size: '5.2 MB' }, 'track2.mp3': { type: 'file', icon: '🎵', size: '4.8 MB' }, 'album-cover.jpg': { type: 'file', icon: '🖼️', size: '124 KB' } },
    'Documents': { 'notes.txt': { type: 'file', icon: '📄', size: '2 KB' }, 'readme.md': { type: 'file', icon: '📄', size: '8 KB' }, 'budget.xlsx': { type: 'file', icon: '📊', size: '64 KB' } },
    'Downloads': { 'trippa-theme-v1.zip': { type: 'file', icon: '📄', size: '2.4 MB' }, 'wallpaper-dark.png': { type: 'file', icon: '🖼️', size: '856 KB' }, 'music-setup.msi': { type: 'file', icon: '💿', size: '14.2 MB' }, 'readme.txt': { type: 'file', icon: '📄', size: '2 KB' } },
    'Apps': { 'Snake': { type: 'app', icon: '<img src=\"assets/icons/program_manager.png\" width=\"28\" height=\"28\">', app: 'snake' }, 'Notepad': { type: 'app', icon: '<img src=\"assets/icons/notepad.png\" width=\"28\" height=\"28\">', app: 'notepad' }, 'Paint': { type: 'app', icon: '<img src=\"assets/icons/paint.png\" width=\"28\" height=\"28\">', app: 'paint' }, 'Calculator': { type: 'app', icon: '<img src=\"assets/icons/computer.png\" width=\"28\" height=\"28\">', app: 'calc' }, 'Music Player': { type: 'app', icon: '<img src=\"assets/icons/sound.png\" width=\"28\" height=\"28\">', app: 'music' } },
    'Projects': { 'index.html': { type: 'file', icon: '📄', size: '3 KB' }, 'style.css': { type: 'file', icon: '📄', size: '12 KB' }, 'desktop.js': { type: 'file', icon: '📄', size: '18 KB' }, 'build.bat': { type: 'file', icon: '⚙️', size: '1 KB' } },
    'Desktop': {
      'Snake Game': { type: 'app', icon: '<img src=\"assets/icons/program_manager.png\" width=\"28\" height=\"28\">', app: 'snake' },
      'Notepad': { type: 'app', icon: '<img src=\"assets/icons/notepad.png\" width=\"28\" height=\"28\">', app: 'notepad' },
      'Paint': { type: 'app', icon: '<img src=\"assets/icons/paint.png\" width=\"28\" height=\"28\">', app: 'paint' },
      'Calculator': { type: 'app', icon: '<img src=\"assets/icons/computer.png\" width=\"28\" height=\"28\">', app: 'calc' },
      'Minesweeper': { type: 'app', icon: '<img src=\"assets/icons/help.png\" width=\"28\" height=\"28\">', app: 'minesweeper' },
      'Music Player': { type: 'app', icon: '<img src=\"assets/icons/sound.png\" width=\"28\" height=\"28\">', app: 'music' }
    }
  };

  function esc(str) { return String(str).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function renderDir(dirName) {
    const dir = virtualFS[dirName];
    if (!dir) return '<div class="file-grid-item" style="color:var(--text-disabled);">(empty)</div>';
    const names = Object.keys(dir);
    let html = '';
    names.forEach(name => {
      const entry = dir[name];
      html += '<div class="file-grid-item" data-type="' + esc(entry.type) + '" data-name="' + esc(name) + '" data-app="' + esc(entry.app || '') + '"><span class="file-icon">' + (entry.icon || '📄') + '</span><span class="file-label">' + esc(name) + '</span></div>';
    });
    return html;
  }

  function navigateTo(winId, path) {
    const w = windows[winId];
    if (!w) return;
    const contentEl = w.el.querySelector('.window-content');
    const dir = virtualFS[path];
    if (!dir) return;
    let navHtml = `C:\\${path === 'root' ? '' : '\\' + path}`;
    let upBtn = path !== 'root' ? '<span class="nav-up" data-path="' + getParentPath(path) + '">[ .. ]</span> ' : '';
    contentEl.innerHTML = `<div class="file-browser"><div class="file-browser-nav">${upBtn}${navHtml}</div><div class="file-grid">${renderDir(path)}</div></div>`;
    w.currentPath = path;
    bindFileClicks(winId);
  }

  function getParentPath(path) {
    const parts = path.split('\\');
    parts.pop();
    return parts.join('\\') || 'root';
  }

  function bindFileClicks(winId) {
    const w = windows[winId];
    if (!w) return;
    const el = w.el;
    el.querySelectorAll('.file-grid-item[data-type="folder"]').forEach(item => {
      item.addEventListener('dblclick', function () {
        navigateTo(winId, this.dataset.name);
      });
    });
    el.querySelectorAll('.file-grid-item[data-type="app"]').forEach(item => {
      item.addEventListener('dblclick', function () {
        const app = this.dataset.app;
        if (app) openWindow(app);
      });
    });

    const upBtn = el.querySelector('.nav-up');
    if (upBtn) {
      upBtn.addEventListener('click', function () {
        navigateTo(winId, this.dataset.path);
      });
    }
  }

  function bindRecycleToggle(winId) {
    const w = windows[winId];
    if (!w) return;
    const btn = w.el.querySelector('#recycle-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        toggleDarkMode();
        const contentEl = w.el.querySelector('.window-content');
        contentEl.innerHTML = getRecycleContent();
        bindRecycleToggle(winId);
      });
    }
  }

  function getDownloadsContent() {
    const downloads = [
      { icon: '📄', name: 'trippa-theme-v1.zip', size: '2.4 MB' },
      { icon: '📄', name: 'wallpaper-dark.png', size: '856 KB' },
      { icon: '💿', name: 'music-player-setup.msi', size: '14.2 MB' },
      { icon: '📄', name: 'readme.txt', size: '2 KB' },
      { icon: '📄', name: 'webapp-template.zip', size: '1.1 MB' },
    ];
    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<tr style="border-bottom:1px solid var(--border-shadow);"><th style="text-align:left;padding:4px 8px;">Name</th><th style="text-align:right;padding:4px 8px;">Size</th></tr>';
    downloads.forEach(d => {
      html += `<tr style="border-bottom:1px solid var(--border-shadow);"><td style="padding:4px 8px;cursor:pointer;"><span style="margin-right:6px;">${d.icon}</span>${d.name}</td><td style="padding:4px 8px;text-align:right;color:var(--text-disabled);">${d.size}</td></tr>`;
    });
    html += '</table>';
    return html;
  }

  function getAppsContent() {
    const apps = [
      { icon: '🎵', name: 'Music Player', desc: 'Listen to your tracks' },
      { icon: '📁', name: 'File Browser', desc: 'Browse files' },
      { icon: '🎮', name: 'Snake Game', desc: 'Classic snake game' },
      { icon: '📝', name: 'Notepad', desc: 'Simple text editor' },
      { icon: '🖼️', name: 'Paint', desc: 'Draw something' },
      { icon: '🌐', name: 'Browser', desc: 'Browse the web' },
    ];
    let html = '<ul class="win-list">';
    apps.forEach(a => {
      html += `<li><span class="file-icon">${a.icon}</span><span>${a.name}</span><span style="color:var(--text-disabled);margin-left:8px;font-size:10px;">— ${a.desc}</span></li>`;
    });
    html += '</ul>';
    return html;
  }

  function getSettingsContent() {
    return `
      <div class="settings-group">
        <h3>Appearance</h3>
        <div class="settings-row">
          <label>Desktop Theme</label>
          <select><option selected>Windows 98 Classic</option><option disabled>Coming soon...</option></select>
        </div>
        <div class="settings-row">
          <label>Accent Color</label>
          <select><option selected>Steel Blue</option><option disabled>Coming soon...</option></select>
        </div>
        <div class="settings-row">
          <label>Icon Size</label>
          <input type="range" min="24" max="48" value="32">
        </div>
      </div>
      <div class="settings-group">
        <h3>Site Info</h3>
        <div class="settings-row"><label>Domain</label><span style="color:var(--accent);">trippa.day</span></div>
        <div class="settings-row"><label>Version</label><span>1.0.0</span></div>
        <div class="settings-row"><label>Status</label><span style="color:#4caf50;">● Online</span></div>
      </div>
      <div class="settings-group">
        <h3>Storage</h3>
        <div class="settings-row">
          <label>Cache Size</label>
          <span style="color:var(--text-disabled);">0 MB</span>
        </div>
        <div class="settings-row">
          <span class="btn-98" style="padding:2px 8px;font-size:10px;">Clear Cache</span>
        </div>
      </div>
    `;
  }

  function getRecycleContent() {
    return `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">🗑️</div>
        <div style="color:var(--text-disabled);font-size:11px;">Recycle Bin is empty</div>
        <div style="margin-top:16px;">
          <span class="btn-98" id="recycle-toggle">Empty Recycle Bin</span>
        </div>
      </div>
    `;
  }

  /* ========== MINI APPS ========== */
  const miniApps = {};

  const trackDB = [
    { album: 'MORTAL SVN', file: 'AGAINST THE FENCE.mp3', icon: '<img src="assets/icons/soundgrn-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'BURIED IN THE WELL.mp3', icon: '<img src="assets/icons/soundpu2-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'BURNED ALIVE.mp3', icon: '<img src="assets/icons/soundpur-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'MORTAL SUN.mp3', icon: '<img src="assets/icons/soundtel-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'OCCAM\'S SLUMBER.mp3', icon: '<img src="assets/icons/soundvor-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'TUNNEL TO NOWHERE.mp3', icon: '<img src="assets/icons/soundyel-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'VALLEY OF CHARCOAL.mp3', icon: '<img src="assets/icons/cd_audio_cd-0.png" width="16" height="16">' },
    { album: 'MORTAL SVN', file: 'SVNDRVNK YELLOW CORROSION.mp3', icon: '<img src="assets/icons/media_player-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'AGAINST THE FENCE.mp3', icon: '<img src="assets/icons/mixer_sound-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'BVRNING ALIVE IN THE SVN [SOMETHING IS AT THE DOOR].mp3', icon: '<img src="assets/icons/multimedia-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'MONOLITHIC TENSION.mp3', icon: '<img src="assets/icons/computer_sound-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'MORTAL SVN.mp3', icon: '<img src="assets/icons/executable_sound-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'OCCAM\'S SLUMBER.mp3', icon: '<img src="assets/icons/audio_compression-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'VALLEY OF CHARCOAL.mp3', icon: '<img src="assets/icons/wia_img_color_sound-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'VOIDBRIDGE [TUNNEL TO NOWHERE].mp3', icon: '<img src="assets/icons/mixer_cd_sound-0.png" width="16" height="16">' },
    { album: 'FROSTFIRE', file: 'AMBER GLASS.mp3', icon: '<img src="assets/icons/keyboard_musical.png" width="16" height="16">' },
  ];

  function getFilteredTracks() {
    return trackDB.filter(function (t, i) { return unlocked.has(i); });
  }

  const secretMap = [
    // Classic mode (MORTAL SVN)
    { mode: false, match: function(e) { var s = e.target.closest('.window-menubar span'); return s && s.textContent.trim() === 'File'; }, idx: 0 },
    { mode: false, match: function(e) { var s = e.target.closest('.window-menubar span'); return s && s.textContent.trim() === 'Edit'; }, idx: 1 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'budget.xlsx'; }, idx: 2 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'readme.txt'; }, idx: 3 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'album-cover.jpg'; }, idx: 4 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'build.bat'; }, idx: 5 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'track1.mp3'; }, idx: 6 },
    { mode: false, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'wallpaper-dark.png'; }, idx: 7 },
    // Dark mode (FROSTFIRE)
    { mode: true, match: function(e) { var s = e.target.closest('.window-menubar span'); return s && s.textContent.trim() === 'View'; }, idx: 8 },
    { mode: true, match: function(e) { var s = e.target.closest('.window-menubar span'); return s && s.textContent.trim() === 'Help'; }, idx: 9 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'notes.txt'; }, idx: 10 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'readme.md'; }, idx: 11 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'track2.mp3'; }, idx: 12 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'index.html'; }, idx: 13 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'style.css'; }, idx: 14 },
    { mode: true, match: function(e) { var f = e.target.closest('.file-grid-item'); return f && f.dataset.name === 'desktop.js'; }, idx: 15 },
  ];

  function tryUnlock(e) {
    for (var i = 0; i < secretMap.length; i++) {
      var entry = secretMap[i];
      if (entry.mode === darkMode && entry.match(e) && !unlocked.has(entry.idx)) {
        unlocked.add(entry.idx);
        refreshMusicPlayer();
        showUnlockToast(entry.idx);
        return true;
      }
    }
    return false;
  }

  function showUnlockToast(idx) {
    var existing = document.querySelector('.unlock-toast');
    if (existing) existing.remove();
    var t = trackDB[idx];
    var toast = document.createElement('div');
    toast.className = 'unlock-toast';
    toast.innerHTML = '<div class="unlock-toast-icon">' + t.icon + '</div><div class="unlock-toast-body"><div class="unlock-toast-title">Song Unlocked!</div><div class="unlock-toast-name">' + t.file.replace('.mp3', '') + '</div><div class="unlock-toast-album">' + t.album + '</div></div><span class="btn-98 unlock-toast-play" style="padding:2px 8px;font-size:10px;">Play</span>';
    function playTrackInWindow(el, filteredIdx) {
      el.querySelectorAll('.mp-track').forEach(function (t) { t.classList.remove('selected'); });
      var row = el.querySelector('.mp-track[data-index="' + filteredIdx + '"]');
      if (row) row.classList.add('selected');
      var t = getFilteredTracks()[filteredIdx];
      if (!t) return;
      var audioEl = el.querySelector('#mp-audio');
      var nowLabel = el.querySelector('#mp-now-label');
      var nowSub = el.querySelector('#mp-now-sub');
      audioEl.src = 'assets/music/' + encodeURIComponent(t.album) + '/' + encodeURIComponent(t.file);
      audioEl.load();
      if (nowLabel) nowLabel.textContent = t.file.replace('.mp3', '');
      if (nowSub) nowSub.textContent = t.album;
      var statusEl = el.querySelector('.window-statusbar');
      if (statusEl) statusEl.innerHTML = '<span style="flex:1;">Loading... <span class="mp-loading"></span></span><span class="resize-grip">▤</span>';
      if (audioEl.readyState >= 2) audioEl.play();
      else audioEl.addEventListener('canplay', function onReady() { audioEl.removeEventListener('canplay', onReady); audioEl.play(); }, { once: true });
    }

    toast.querySelector('.unlock-toast-play').addEventListener('click', function () {
      toast.remove();
      var existingId = Object.keys(windows).find(function (id) { return windows[id].config && windows[id].config.title === 'Music Player'; });
      if (existingId) {
        focusWindow(existingId);
        var filteredIdx = getFilteredTracks().indexOf(trackDB[idx]);
        if (filteredIdx === -1) return;
        playTrackInWindow(windows[existingId].el, filteredIdx);
      } else {
        openWindow('music');
        setTimeout(function () {
          var w = Object.keys(windows).find(function (id) { return windows[id].config && windows[id].config.title === 'Music Player'; });
          if (!w) return;
          var filteredIdx = getFilteredTracks().indexOf(trackDB[idx]);
          if (filteredIdx === -1) return;
          playTrackInWindow(windows[w].el, filteredIdx);
        }, 200);
      }
    });
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 6000);
  }

  function refreshMusicPlayer() {
    Object.keys(windows).forEach(function (id) {
      const w = windows[id];
      if (w.config && w.config.title === 'Music Player') {
        const contentEl = w.el.querySelector('.window-content');
        if (!contentEl) return;
        const tracks = getFilteredTracks();
        let albumHtml = '', currentAlbum = '';
        tracks.forEach(function (t, i) {
          if (t.album !== currentAlbum) {
            if (currentAlbum) albumHtml += '</div>';
            albumHtml += '<div class="mp-album-header">' + t.album + '</div><div class="mp-tracks">';
            currentAlbum = t.album;
          }
          const label = t.file.replace('.mp3', '');
          albumHtml += '<div class="mp-track" data-index="' + i + '"><span class="mp-track-icon">' + t.icon + '</span><span class="mp-track-label">' + label + '</span><span class="mp-track-dur" id="mp-dur-' + i + '">--:--</span></div>';
        });
        if (currentAlbum) albumHtml += '</div>';
        const listEl = contentEl.querySelector('.mp-playlist');
        if (listEl) listEl.innerHTML = albumHtml;
        w.el.querySelector('.window-statusbar').innerHTML = '<span style="flex:1;">' + tracks.length + ' / ' + trackDB.length + ' tracks unlocked <span class="unlock-progress"><span class="unlock-progress-fill" style="width:' + Math.round((tracks.length / trackDB.length) * 100) + '%;"></span></span></span><span class="resize-grip">▤</span>';
      }
    });
  }

  miniApps.music = {
    title: 'Music Player',
    icon: '<img src="assets/icons/sound.png" width="16" height="16">',
    width: 600,
    height: 440,
    statusText: 'Music Player',
    content: function () {
      const tracks = getFilteredTracks();
      let albumHtml = '', currentAlbum = '';
      tracks.forEach(function (t, i) {
        const albumName = t.album;
        if (albumName !== currentAlbum) {
          if (currentAlbum) albumHtml += '</div>';
          albumHtml += '<div class="mp-album-header">' + albumName + '</div><div class="mp-tracks">';
          currentAlbum = albumName;
        }
        const label = t.file.replace('.mp3', '');
        albumHtml += '<div class="mp-track" data-index="' + i + '"><span class="mp-track-icon">' + t.icon + '</span><span class="mp-track-label">' + label + '</span><span class="mp-track-dur" id="mp-dur-' + i + '">--:--</span></div>';
      });
      if (currentAlbum) albumHtml += '</div>';

      return `
        <div class="mp-container">
          <div class="mp-playlist">${albumHtml}</div>
          <div class="mp-player">
            <div class="mp-info">
              <div class="mp-cover">🎵</div>
              <div class="mp-now">
                <div class="mp-now-label" id="mp-now-label">No track selected</div>
                <div class="mp-now-sub" id="mp-now-sub">—</div>
              </div>
            </div>
            <div class="mp-progress">
              <span class="mp-time" id="mp-time-current">0:00</span>
              <div class="mp-bar" id="mp-bar"><div class="mp-bar-fill" id="mp-bar-fill"></div></div>
              <span class="mp-time" id="mp-time-total">0:00</span>
            </div>
            <div class="mp-controls">
              <span class="btn-98 mp-btn" id="mp-prev" style="padding:2px 10px;">⏮</span>
              <span class="btn-98 mp-btn mp-btn-play" id="mp-play" style="padding:2px 16px;">▶</span>
              <span class="btn-98 mp-btn" id="mp-next" style="padding:2px 10px;">⏭</span>
              <span style="flex:1;"></span>
              <span style="font-size:10px;color:var(--text-disabled);align-self:center;">Vol</span>
              <span class="btn-98 mp-btn mp-vol-arrow" id="mp-vol-down" style="padding:1px 6px;font-size:9px;">◀</span>
              <div class="mp-volume" id="mp-volume"><div class="mp-volume-fill" id="mp-volume-fill" style="width:100%"></div></div>
              <span class="btn-98 mp-btn mp-vol-arrow" id="mp-vol-up" style="padding:1px 6px;font-size:9px;">▶</span>
            </div>
            <audio id="mp-audio" style="display:none;"></audio>
          </div>
        </div>
      `;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const audio = el.querySelector('#mp-audio');
      const playBtn = el.querySelector('#mp-play');
      const prevBtn = el.querySelector('#mp-prev');
      const nextBtn = el.querySelector('#mp-next');
      const bar = el.querySelector('#mp-bar');
      const barFill = el.querySelector('#mp-bar-fill');
      const volBar = el.querySelector('#mp-volume');
      const volFill = el.querySelector('#mp-volume-fill');
      const volDown = el.querySelector('#mp-vol-down');
      const volUp = el.querySelector('#mp-vol-up');
      const timeCur = el.querySelector('#mp-time-current');
      const timeTot = el.querySelector('#mp-time-total');
      const nowLabel = el.querySelector('#mp-now-label');
      const nowSub = el.querySelector('#mp-now-sub');
      const statusbar = el.querySelector('.window-statusbar');

      let currentIndex = -1;
      let isPlaying = false;
      let tracks = getFilteredTracks();
      audio.volume = 1.0;

      function formatTime(s) {
        if (isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      var loadingTrack = false;

      function playWhenReady(audioEl) {
        if (audioEl.readyState >= 2) {
          audioEl.play();
          return;
        }
        function onCanPlay() {
          audioEl.removeEventListener('canplay', onCanPlay);
          audioEl.play();
        }
        audioEl.addEventListener('canplay', onCanPlay);
      }

      function setLoadingState(loading) {
        loadingTrack = loading;
        var statusEl = el.querySelector('.window-statusbar');
        if (!statusEl) return;
        if (loading) {
          statusEl.innerHTML = '<span style="flex:1;">Loading... <span class="mp-loading"></span></span><span class="resize-grip">▤</span>';
        }
      }

      function loadTrack(index) {
        tracks = getFilteredTracks();
        if (index < 0 || index >= tracks.length) return;
        el.querySelectorAll('.mp-track').forEach(function (t) { t.classList.remove('active'); });
        var row = el.querySelector('.mp-track[data-index="' + index + '"]');
        if (row) row.classList.add('active');
        var t = tracks[index];
        currentIndex = index;
        var filePath = 'assets/music/' + encodeURIComponent(t.album) + '/' + encodeURIComponent(t.file);
        audio.src = filePath;
        audio.load();
        nowLabel.textContent = t.file.replace('.mp3', '');
        nowSub.textContent = t.album;
        setLoadingState(true);
      }

      function togglePlay() {
        tracks = getFilteredTracks();
        if (!audio.src) { if (tracks.length) loadTrack(0); }
        if (audio.paused) {
          if (audio.readyState >= 2) audio.play();
          else playWhenReady(audio);
        } else {
          audio.pause();
        }
      }

      audio.addEventListener('play', function () {
        isPlaying = true;
        playBtn.textContent = '⏸';
        var statusEl = el.querySelector('.window-statusbar');
        if (statusEl && tracks[currentIndex]) {
          statusEl.innerHTML = '<span style="flex:1;">Playing — ' + tracks[currentIndex].file.replace('.mp3', '') + '</span><span class="resize-grip">▤</span>';
        }
      });

      audio.addEventListener('pause', function () {
        isPlaying = false;
        playBtn.textContent = '▶';
        var statusEl = el.querySelector('.window-statusbar');
        if (statusEl) {
          statusEl.innerHTML = '<span style="flex:1;">Paused</span><span class="resize-grip">▤</span>';
        }
      });

      audio.addEventListener('ended', function () {
        tracks = getFilteredTracks();
        if (currentIndex < tracks.length - 1) loadTrack(currentIndex + 1);
        else { isPlaying = false; playBtn.textContent = '▶'; }
      });

      audio.addEventListener('timeupdate', function () {
        if (!audio.duration) return;
        var pct = (audio.currentTime / audio.duration) * 100;
        barFill.style.width = pct + '%';
        timeCur.textContent = formatTime(audio.currentTime);
        var durRow = el.querySelector('#mp-dur-' + currentIndex);
        if (durRow && durRow.textContent === '--:--') durRow.textContent = formatTime(audio.duration);
      });

      audio.addEventListener('loadedmetadata', function () {
        timeTot.textContent = formatTime(audio.duration);
        var durRow = el.querySelector('#mp-dur-' + currentIndex);
        if (durRow) durRow.textContent = formatTime(audio.duration);
      });

      audio.addEventListener('canplay', function () {
        if (loadingTrack) {
          setLoadingState(false);
          if (isPlaying) audio.play();
        }
      });

      audio.addEventListener('waiting', function () { setLoadingState(true); });

      audio.addEventListener('error', function () {
        setLoadingState(false);
        var statusEl = el.querySelector('.window-statusbar');
        if (statusEl) {
          statusEl.innerHTML = '<span style="flex:1;color:#cc3333;">Error loading track</span><span class="resize-grip">▤</span>';
        }
      });

      playBtn.addEventListener('click', togglePlay);

      prevBtn.addEventListener('click', function () {
        if (currentIndex > 0) loadTrack(currentIndex - 1);
      });

      nextBtn.addEventListener('click', function () {
        tracks = getFilteredTracks();
        if (currentIndex < tracks.length - 1) loadTrack(currentIndex + 1);
      });

      var playlistEl = el.querySelector('.mp-playlist');
      playlistEl.addEventListener('dblclick', function (e) {
        var row = e.target.closest('.mp-track');
        if (!row) return;
        loadTrack(parseInt(row.dataset.index));
        isPlaying = true;
        if (audio.readyState >= 2) audio.play();
        else playWhenReady(audio);
      });
      playlistEl.addEventListener('click', function (e) {
        var row = e.target.closest('.mp-track');
        if (!row) return;
        el.querySelectorAll('.mp-track').forEach(function (t) { t.classList.remove('selected'); });
        row.classList.add('selected');
        loadTrack(parseInt(row.dataset.index));
        isPlaying = true;
        if (audio.readyState >= 2) audio.play();
        else playWhenReady(audio);
      });

      // seek-by-click removed — didn't work

      function setVolume(v) {
        var pct = Math.max(0, Math.min(1, v));
        audio.volume = pct;
        volFill.style.width = (pct * 100) + '%';
      }

      volBar.addEventListener('click', function (e) {
        const rect = this.getBoundingClientRect();
        setVolume((e.clientX - rect.left) / rect.width);
      });

      volDown.addEventListener('click', function () { setVolume(audio.volume - 0.1); });
      volUp.addEventListener('click', function () { setVolume(audio.volume + 0.1); });

      if (tracks.length) { loadTrack(0); }
    }
  };

  miniApps.snake = {
    title: 'Snake',
    icon: '<img src="assets/icons/program_manager.png" width="16" height="16">',
    width: 480,
    height: 440,
    statusText: 'Score: 0 | Use arrow keys',
    content: function () {
      return `
        <div id="snake-canvas-container" style="display:flex;flex-direction:column;align-items:center;padding:8px;">
          <canvas id="snake-canvas" width="400" height="360" style="border:1px solid var(--border-shadow);background:var(--bg-input);"></canvas>
          <div style="margin-top:6px;display:flex;gap:8px;align-items:center;">
            <span class="btn-98" id="snake-start" style="padding:2px 12px;">New Game</span>
            <span id="snake-score" style="color:var(--text-primary);font-size:11px;">Score: 0</span>
          </div>
        </div>
      `;
    },
    init: function (winId) {
      const w = windows[winId];
      if (!w) return;
      const el = w.el;

      const canvas = el.querySelector('#snake-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const scoreEl = el.querySelector('#snake-score');
      const startBtn = el.querySelector('#snake-start');

      let snake = [{ x: 10, y: 10 }];
      let dir = { x: 1, y: 0 };
      let nextDir = { x: 1, y: 0 };
      let food = { x: 15, y: 10 };
      let score = 0;
      let running = false;
      let gameLoop = null;
      const TILE = 20;
      const COLS = 20;
      const ROWS = 18;

      function placeFood() {
        while (true) {
          const fx = Math.floor(Math.random() * COLS);
          const fy = Math.floor(Math.random() * ROWS);
          if (!snake.some(s => s.x === fx && s.y === fy)) {
            food = { x: fx, y: fy };
            return;
          }
        }
      }

      function gameTick() {
        dir = { ...nextDir };
        const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
        if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || snake.some(s => s.x === head.x && s.y === head.y)) {
          running = false;
          clearInterval(gameLoop);
          gameLoop = null;
          draw();
          ctx.fillStyle = '#8a1a1a';
          ctx.font = '20px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('GAME OVER', 200, 160);
          return;
        }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
          score++;
          scoreEl.textContent = 'Score: ' + score;
          w.el.querySelector('.window-statusbar').innerHTML = '<span style="flex:1;">Score: ' + score + ' | Arrow keys to move</span><span class="resize-grip">▤</span>';
          placeFood();
        } else {
          snake.pop();
        }
        draw();
      }

      function draw() {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 400, 360);
        ctx.fillStyle = '#1a3a1a';
        snake.forEach(s => { ctx.fillRect(s.x * TILE + 1, s.y * TILE + 1, TILE - 2, TILE - 2); });
        ctx.fillStyle = '#4a6fa5';
        ctx.fillRect(food.x * TILE + 2, food.y * TILE + 2, TILE - 4, TILE - 4);
      }

      function startGame() {
        if (gameLoop) clearInterval(gameLoop);
        snake = [{ x: 10, y: 10 }];
        dir = { x: 1, y: 0 };
        nextDir = { x: 1, y: 0 };
        score = 0;
        scoreEl.textContent = 'Score: 0';
        if (w) {
          w.el.querySelector('.window-statusbar').innerHTML = '<span style="flex:1;">Score: 0 | Arrow keys to move</span><span class="resize-grip">▤</span>';
        }
        placeFood();
        running = true;
        gameLoop = setInterval(gameTick, 150);
        draw();
      }

      startBtn.addEventListener('click', startGame);

      el.addEventListener('keydown', function (e) {
        const keyMap = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };
        const nd = keyMap[e.key];
        if (nd && !(nd.x === -dir.x && nd.y === -dir.y)) nextDir = nd;
      });

      canvas.setAttribute('tabindex', '0');
      canvas.focus();
      startGame();

      windows[winId].cleanup = function () {
        if (gameLoop) { clearInterval(gameLoop); gameLoop = null; }
      };
    }
  };

  miniApps.notepad = {
    title: 'Notepad',
    icon: '<img src="assets/icons/notepad.png" width="16" height="16">',
    width: 520,
    height: 400,
    statusText: 'Untitled',
    content: function () {
      return `
        <textarea id="notepad-text" style="width:100%;height:100%;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-shadow);resize:none;padding:6px;font-family:'Courier New',monospace;font-size:12px;outline:none;" placeholder="Type something..."></textarea>
      `;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const textarea = el.querySelector('#notepad-text');
      if (!textarea) return;
      const menubar = el.querySelector('.window-menubar');

      const statusbar = el.querySelector('.window-statusbar');

      menubar.innerHTML = '<span id="np-new">File</span><span id="np-undo">Edit</span><span id="np-wrap">Format</span><span id="np-about">Help</span>';

      el.querySelector('#np-new').addEventListener('click', function () {
        if (textarea.value) {
          var blob = new Blob([textarea.value], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'untitled.txt';
          a.click();
          URL.revokeObjectURL(a.href);
        }
        textarea.value = '';
        statusbar.innerHTML = '<span style="flex:1;">Untitled</span><span class="resize-grip">▤</span>';
      });

      el.querySelector('#np-about').addEventListener('click', function () {
        statusbar.innerHTML = '<span style="flex:1;">Notepad v1.0 - trippa.day</span><span class="resize-grip">▤</span>';
      });

      textarea.addEventListener('input', function () {
        const lines = textarea.value.split('\n').length;
        statusbar.innerHTML = '<span style="flex:1;">Lines: ' + lines + '</span><span class="resize-grip">▤</span>';
      });
    }
  };

  miniApps.paint = {
    title: 'Paint',
    icon: '<img src="assets/icons/paint.png" width="16" height="16">',
    width: 800,
    height: 540,
    statusText: 'Ready',
    content: function () {
      const tools = [
        { id: 'pencil', label: '<img src="assets/icons/pt-pencil.png" width="22" height="22">' },
        { id: 'brush', label: '<img src="assets/icons/pt-brush.png" width="22" height="22">' },
        { id: 'eraser', label: '<img src="assets/icons/pt-eraser.png" width="22" height="22">' },
        { id: 'fill', label: '<img src="assets/icons/pt-fill.png" width="22" height="22">' },
        { id: 'line', label: '<img src="assets/icons/pt-line.png" width="22" height="22">' },
        { id: 'rect', label: '<img src="assets/icons/pt-rect.png" width="22" height="22">' },
        { id: 'ellipse', label: '<img src="assets/icons/pt-ellipse.png" width="22" height="22">' },
        { id: 'spray', label: '<img src="assets/icons/pt-spray.png" width="22" height="22">' },
      ];
      const widths = [1, 3, 5, 8];
      const colors = ['#ffffff','#c8c8c8','#888888','#000000','#8a1a1a','#cc3333','#ff6666','#cc8833','#ffcc33','#ffff66','#336633','#4caf50','#66cc66','#1a5276','#4a6fa5','#66aaff','#4a1a6e','#8833aa','#cc66ff','#cc6699'];

      let html = '<div class="paint-body" style="display:flex;flex-direction:column;height:100%;">';
      html += '<div class="paint-workspace" style="display:flex;flex:1;min-height:0;">';
      html += '<div class="paint-toolbox" style="display:grid;grid-template-columns:repeat(2,28px);gap:1px;padding:3px;border-right:1px solid var(--border-shadow);align-content:start;">';
      tools.forEach(function (t, i) {
        html += '<div class="paint-tool" data-tool="' + t.id + '" style="width:28px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid transparent;border-radius:2px;' + (i === 0 ? 'background:var(--accent);' : '') + '" title="' + t.id.charAt(0).toUpperCase() + t.id.slice(1) + '">' + t.label + '</div>';
      });
      html += '</div>';
      html += '<div class="paint-canvas-wrap" style="flex:1;position:relative;margin:3px;"><canvas id="paint-canvas" style="width:100%;height:100%;background:#fff;border:1px solid var(--border-shadow);cursor:crosshair;"></canvas></div>';
      html += '</div>';
      html += '<div class="paint-bottom" style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-top:1px solid var(--border-shadow);">';
      html += '<div class="paint-colors" style="display:flex;gap:1px;flex-wrap:wrap;flex:1;">';
      colors.forEach(function (c) {
        html += '<div class="paint-color" data-color="' + c + '" style="width:14px;height:14px;background:' + c + ';border:1px solid var(--border-shadow);cursor:pointer;' + (c === '#000000' ? 'outline:1px solid #555;' : '') + '"></div>';
      });
      html += '</div>';
      html += '<div class="paint-widths" style="display:flex;gap:2px;align-items:center;margin-left:6px;">';
      widths.forEach(function (w) {
        var sel = w === 3 ? 'background:var(--accent);' : '';
        html += '<div class="paint-width" data-width="' + w + '" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--border-shadow);border-radius:2px;' + sel + '" title="' + w + 'px"><div style="width:' + w + 'px;height:' + w + 'px;background:var(--text-primary);border-radius:50%;"></div></div>';
      });
      html += '</div></div></div>';
      return html;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const canvas = el.querySelector('#paint-canvas');
      if (!canvas) return;
      const container = canvas.parentElement;
      const ctx = canvas.getContext('2d');
      const menubar = el.querySelector('.window-menubar');
      const statusbar = el.querySelector('.window-statusbar');

      menubar.innerHTML = '<span id="pt-file">File</span><span id="pt-edit">Edit</span><span id="pt-view">View</span><span id="pt-help">Help</span>';

      function initSize() {
        canvas.width = container.clientWidth - 2;
        canvas.height = container.clientHeight - 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      initSize();

      var ro = new ResizeObserver(function () {
        var imgData = null;
        try { imgData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) {}
        var w = container.clientWidth - 2;
        var h = container.clientHeight - 2;
        if (w <= 0 || h <= 0) return;
        canvas.width = w;
        canvas.height = h;
        if (imgData) ctx.putImageData(imgData, 0, 0);
        else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
      });
      ro.observe(container);
      var prevCleanup = windows[winId].cleanup;
      windows[winId].cleanup = function () {
        if (prevCleanup) prevCleanup();
        ro.disconnect();
      };

      let tool = 'pencil';
      let color = '#000000';
      let lineWidth = 3;
      let drawing = false;
      let lastX, lastY;

      el.querySelectorAll('.paint-tool').forEach(function (btn) {
        btn.addEventListener('click', function () {
          tool = this.dataset.tool;
          el.querySelectorAll('.paint-tool').forEach(function (b) { b.style.background = ''; });
          this.style.background = 'var(--accent)';
          statusbar.innerHTML = '<span style="flex:1;">' + this.title + '</span><span class="resize-grip">▤</span>';
        });
      });

      el.querySelectorAll('.paint-color').forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          color = this.dataset.color;
          el.querySelectorAll('.paint-color').forEach(function (s) { s.style.outline = 'none'; });
          this.style.outline = '1px solid var(--accent)';
          this.style.outlineOffset = '1px';
        });
      });

      el.querySelectorAll('.paint-width').forEach(function (btn) {
        btn.addEventListener('click', function () {
          lineWidth = parseInt(this.dataset.width);
          el.querySelectorAll('.paint-width').forEach(function (b) { b.style.background = ''; });
          this.style.background = 'var(--accent)';
        });
      });

      function getPos(e) {
        var rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }

      function floodFill(sx, sy, fillColor) {
        var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var d = imgData.data, w = canvas.width, h = canvas.height;
        var si = (sy * w + sx) * 4;
        var sr = d[si], sg = d[si + 1], sb = d[si + 2];
        var fr = parseInt(fillColor.slice(1, 3), 16), fg = parseInt(fillColor.slice(3, 5), 16), fb = parseInt(fillColor.slice(5, 7), 16);
        if (sr === fr && sg === fg && sb === fb) return;
        var stack = [[sx, sy]], vis = new Uint8Array(w * h);
        while (stack.length) {
          var p = stack.pop(), px = p[0], py = p[1];
          if (px < 0 || px >= w || py < 0 || py >= h || vis[py * w + px]) continue;
          vis[py * w + px] = 1;
          var idx = (py * w + px) * 4;
          if (d[idx] !== sr || d[idx + 1] !== sg || d[idx + 2] !== sb) continue;
          d[idx] = fr; d[idx + 1] = fg; d[idx + 2] = fb; d[idx + 3] = 255;
          stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
        ctx.putImageData(imgData, 0, 0);
      }

      function strokeShape(x1, y1, x2, y2, type) {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        if (type === 'line') { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
        else if (type === 'rect') { ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
        else if (type === 'ellipse') { ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2); }
        ctx.stroke();
        ctx.restore();
      }

      var shapeStart = null;

      canvas.addEventListener('mousedown', function (e) {
        var p = getPos(e);
        if (tool === 'fill') { floodFill(Math.round(p.x), Math.round(p.y), color); return; }
        drawing = true;
        lastX = p.x; lastY = p.y;
        if (['line', 'rect', 'ellipse'].indexOf(tool) !== -1) {
          shapeStart = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      });

      canvas.addEventListener('mousemove', function (e) {
        if (!drawing) return;
        var p = getPos(e);
        if (['line', 'rect', 'ellipse'].indexOf(tool) !== -1) {
          if (shapeStart) ctx.putImageData(shapeStart, 0, 0);
          strokeShape(lastX, lastY, p.x, p.y, tool);
        } else if (tool === 'pencil' || tool === 'brush') {
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';
          ctx.stroke();
          lastX = p.x; lastY = p.y;
        } else if (tool === 'eraser') {
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = lineWidth * 3 + 2;
          ctx.lineCap = 'round';
          ctx.stroke();
          lastX = p.x; lastY = p.y;
        } else if (tool === 'spray') {
          for (var i = 0; i < 10; i++) {
            var ox = (Math.random() - 0.5) * lineWidth * 4;
            var oy = (Math.random() - 0.5) * lineWidth * 4;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x + ox, p.y + oy, lineWidth > 3 ? 1.5 : 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      canvas.addEventListener('mouseup', function (e) {
        if (!drawing) return;
        drawing = false;
        if (['line', 'rect', 'ellipse'].indexOf(tool) !== -1) {
          var p = getPos(e);
          if (shapeStart) ctx.putImageData(shapeStart, 0, 0);
          strokeShape(lastX, lastY, p.x, p.y, tool);
          shapeStart = null;
        }
      });

      canvas.addEventListener('mouseleave', function () {
        if (drawing && ['line', 'rect', 'ellipse'].indexOf(tool) !== -1 && shapeStart) {
          ctx.putImageData(shapeStart, 0, 0);
          shapeStart = null;
        }
        drawing = false;
      });

      el.querySelector('#pt-file').addEventListener('click', function () {
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'untitled.png';
        a.click();
        statusbar.innerHTML = '<span style="flex:1;">Saved as untitled.png</span><span class="resize-grip">▤</span>';
      });

      el.querySelector('#pt-edit').addEventListener('click', function () {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        statusbar.innerHTML = '<span style="flex:1;">Cleared</span><span class="resize-grip">▤</span>';
      });

      el.querySelector('#pt-help').addEventListener('click', function () {
        statusbar.innerHTML = '<span style="flex:1;">Paint v1.0 — trippa.day</span><span class="resize-grip">▤</span>';
      });
    }
  };

  miniApps.calc = {
    title: 'Calculator',
    icon: '<img src="assets/icons/computer.png" width="16" height="16">',
    width: 280,
    height: 340,
    statusText: 'Ready',
    content: function () {
      return `
        <div style="padding:8px;display:flex;flex-direction:column;gap:4px;height:100%;">
          <div id="calc-display" style="background:var(--bg-input);border:1px solid var(--border-shadow);padding:8px 6px;text-align:right;font-family:'Courier New',monospace;font-size:20px;color:var(--text-bright);min-height:36px;overflow:hidden;">0</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;flex:1;">
            <span class="btn-98 calc-btn" data-v="7">7</span><span class="btn-98 calc-btn" data-v="8">8</span><span class="btn-98 calc-btn" data-v="9">9</span><span class="btn-98 calc-btn" data-v="/" style="background:var(--bg-title);">÷</span>
            <span class="btn-98 calc-btn" data-v="4">4</span><span class="btn-98 calc-btn" data-v="5">5</span><span class="btn-98 calc-btn" data-v="6">6</span><span class="btn-98 calc-btn" data-v="*" style="background:var(--bg-title);">×</span>
            <span class="btn-98 calc-btn" data-v="1">1</span><span class="btn-98 calc-btn" data-v="2">2</span><span class="btn-98 calc-btn" data-v="3">3</span><span class="btn-98 calc-btn" data-v="-" style="background:var(--bg-title);">−</span>
            <span class="btn-98 calc-btn" data-v="0">0</span><span class="btn-98 calc-btn" data-v=".">.</span><span class="btn-98 calc-btn" data-v="C">C</span><span class="btn-98 calc-btn" data-v="+" style="background:var(--bg-title);">+</span>
            <span class="btn-98 calc-btn" data-v="=" style="grid-column:span 4;background:var(--accent);color:#fff;">=</span>
          </div>
        </div>
      `;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const display = el.querySelector('#calc-display');
      let current = '0', prev = '', op = null, clearNext = false;

      el.querySelectorAll('.calc-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          const v = this.dataset.v;
          if ('0123456789.'.includes(v)) {
            if (clearNext) { current = ''; clearNext = false; }
            if (v === '.' && current.includes('.')) return;
            current = current === '0' && v !== '.' ? v : current + v;
            display.textContent = current;
          } else if ('+-*/'.includes(v)) {
            if (op && !clearNext) compute();
            prev = current;
            op = v;
            clearNext = true;
          } else if (v === 'C') {
            current = '0'; prev = ''; op = null; clearNext = false;
            display.textContent = '0';
          } else if (v === '=') {
            if (op) compute();
            op = null;
            clearNext = true;
          }
        });
      });

      function compute() {
        const a = parseFloat(prev), b = parseFloat(current);
        if (isNaN(a) || isNaN(b)) return;
        let r = 0;
        if (op === '+') r = a + b;
        else if (op === '-') r = a - b;
        else if (op === '*') r = a * b;
        else if (op === '/') r = b !== 0 ? a / b : 'Error';
        current = typeof r === 'number' ? String(parseFloat(r.toFixed(10))) : 'Error';
        display.textContent = current;
      }
    }
  };

  miniApps.minesweeper = {
    title: 'Minesweeper',
    icon: '<img src="assets/icons/help.png" width="16" height="16">',
    width: 320,
    height: 380,
    statusText: 'Mines: 10',
    content: function () {
      return `
        <div id="ms-container" style="display:flex;flex-direction:column;align-items:center;padding:8px;gap:6px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="btn-98" id="ms-new" style="padding:2px 10px;">😀 New</span>
            <span id="ms-mines" style="font-family:'Courier New',monospace;font-size:14px;color:var(--text-bright);">💣 10</span>
          </div>
          <div id="ms-grid" style="display:grid;gap:1px;background:var(--border-shadow);border:1px solid var(--border-shadow);"></div>
        </div>
      `;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const container = el.querySelector('#ms-grid');
      const minesEl = el.querySelector('#ms-mines');
      const newBtn = el.querySelector('#ms-new');

      const ROWS = 9, COLS = 9, MINES = 10;
      let board = [], revealed = [], gameOver = false;

      function initGame() {
        board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        revealed = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
        gameOver = false;
        let placed = 0;
        while (placed < MINES) {
          const r = Math.floor(Math.random() * ROWS);
          const c = Math.floor(Math.random() * COLS);
          if (board[r][c] !== -1) { board[r][c] = -1; placed++; }
        }
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (board[r][c] === -1) continue;
            let count = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === -1) count++;
            }
            board[r][c] = count;
          }
        }
        render();
      }

      function render() {
        container.style.gridTemplateColumns = `repeat(${COLS},28px)`;
        container.innerHTML = '';
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            cell.style.width = '28px'; cell.style.height = '28px';
            cell.style.display = 'flex'; cell.style.alignItems = 'center'; cell.style.justifyContent = 'center';
            cell.style.cursor = 'pointer';
            cell.style.fontSize = '13px'; cell.style.fontWeight = 'bold';
            cell.dataset.r = r; cell.dataset.c = c;
            if (revealed[r][c]) {
              if (board[r][c] === -1) { cell.textContent = '💣'; cell.style.background = '#8a1a1a'; }
              else {
                cell.style.background = 'var(--bg-input)';
                cell.style.border = '1px solid var(--border-shadow)';
                if (board[r][c] > 0) {
                  const colors = ['','#4a6fa5','#4caf50','#cc3333','#8833aa','#cc8833','#66ccff','#888','#555'];
                  cell.textContent = board[r][c];
                  cell.style.color = colors[board[r][c]] || '#fff';
                }
              }
            } else {
              cell.style.background = 'var(--bg-button)';
              cell.style.border = '1px solid var(--border-light)';
              cell.style.borderTopColor = 'var(--border-highlight)';
              cell.style.borderLeftColor = 'var(--border-highlight)';
            }

            if (!gameOver && !revealed[r][c]) {
              cell.addEventListener('click', function () {
                const rr = parseInt(this.dataset.r), cc = parseInt(this.dataset.c);
                if (gameOver || revealed[rr][cc]) return;
                reveal(rr, cc);
                render();
                if (board[rr][cc] === -1) { gameOver = true; render(); }
                else { checkWin(); }
              });
            }

            container.appendChild(cell);
          }
        }
      }

      function reveal(r, c) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || revealed[r][c] || board[r][c] === -1) return;
        revealed[r][c] = true;
        if (board[r][c] === 0) {
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) reveal(r + dr, c + dc);
        }
      }

      function checkWin() {
        let count = 0;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (revealed[r][c]) count++;
        if (count === ROWS * COLS - MINES) {
          gameOver = true;
          render();
          setTimeout(() => { el.querySelector('.window-statusbar').innerHTML = '<span style="flex:1;color:#4caf50;">You Win! 🎉</span><span class="resize-grip">▤</span>'; }, 100);
        }
      }

      newBtn.addEventListener('click', initGame);
      initGame();
    }
  };

  miniApps.browser = {
    title: 'Web Browser',
    icon: '<img src="assets/icons/world.png" width="16" height="16">',
    width: 900,
    height: 600,
    statusText: 'Ready',
    content: function () {
      return `
        <div style="display:flex;flex-direction:column;height:100%;">
          <div style="display:flex;align-items:center;gap:4px;padding:3px;border-bottom:1px solid var(--border-shadow);background:var(--bg-window);">
            <span class="btn-98" id="wb-back" style="padding:2px 8px;font-size:11px;">◀</span>
            <span class="btn-98" id="wb-fwd" style="padding:2px 8px;font-size:11px;">▶</span>
            <span class="btn-98" id="wb-refresh" style="padding:2px 8px;font-size:12px;">↻</span>
            <span class="btn-98" id="wb-home" style="padding:2px 8px;font-size:11px;">🏠</span>
            <span style="font-size:10px;color:var(--text-disabled);margin:0 2px;">Address</span>
            <input id="wb-url" style="flex:1;background:var(--bg-input);border:1px solid var(--border-shadow);color:var(--text-primary);padding:2px 4px;font-size:11px;outline:none;font-family:'Courier New',monospace;" value="goodhope/index.html">
            <span class="btn-98" id="wb-go" style="padding:2px 10px;font-size:11px;">Go</span>
          </div>
          <iframe id="wb-frame" style="flex:1;border:none;background:#fff;" src="about:blank"></iframe>
        </div>
      `;
    },
    init: function (winId) {
      const el = windows[winId].el;
      const frame = el.querySelector('#wb-frame');
      const urlInput = el.querySelector('#wb-url');
      const backBtn = el.querySelector('#wb-back');
      const fwdBtn = el.querySelector('#wb-fwd');
      const refreshBtn = el.querySelector('#wb-refresh');
      const homeBtn = el.querySelector('#wb-home');
      const goBtn = el.querySelector('#wb-go');
      const statusbar = el.querySelector('.window-statusbar');

      var history = ['goodhope/index.html'];
      var historyIdx = 0;

      function navigate(url) {
        frame.src = url;
        urlInput.value = url;
        if (historyIdx < history.length - 1) history = history.slice(0, historyIdx + 1);
        history.push(url);
        historyIdx = history.length - 1;
        statusbar.innerHTML = '<span style="flex:1;">Opening ' + url + '...</span><span class="resize-grip">▤</span>';
      }

      goBtn.addEventListener('click', function () { navigate(urlInput.value); });
      urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') navigate(urlInput.value); });

      backBtn.addEventListener('click', function () {
        if (historyIdx > 0) { historyIdx--; frame.src = history[historyIdx]; urlInput.value = history[historyIdx]; }
      });
      fwdBtn.addEventListener('click', function () {
        if (historyIdx < history.length - 1) { historyIdx++; frame.src = history[historyIdx]; urlInput.value = history[historyIdx]; }
      });
      refreshBtn.addEventListener('click', function () { frame.src = frame.src; });
      homeBtn.addEventListener('click', function () { navigate('goodhope/index.html'); });

      frame.addEventListener('load', function () {
        statusbar.innerHTML = '<span style="flex:1;">Done</span><span class="resize-grip">▤</span>';
      });

      navigate('goodhope/index.html');
    }
  };

  /* ========== WINDOW EVENTS ========== */
  function bindWindowEvents(win, id) {
    const titlebar = win.querySelector('.window-titlebar');

    /* Focus */
    win.addEventListener('mousedown', function () { focusWindow(id); });

    /* Drag */
    let dragging = false, dragOffX, dragOffY;
    function onMouseMove(e) {
      if (!dragging) return;
      const newX = e.clientX - dragOffX;
      const newY = e.clientY - dragOffY;
      const maxX = window.innerWidth - 40;
      const maxY = window.innerHeight - 40;
      win.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
      win.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
    }
    function onMouseUp() { dragging = false; }

    titlebar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.window-titlebar-buttons')) return;
      if (windows[id].maximized) return;
      dragging = true;
      const rect = win.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;
      win.style.left = rect.left + 'px';
      win.style.top = rect.top + 'px';
      win.style.width = rect.width + 'px';
      win.style.height = rect.height + 'px';
      focusWindow(id);
    });

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    /* Edge / corner resize */
    var dirs = ['n','s','e','w','nw','ne','sw','se'];
    var resizing = null, resizeStart = {};
    var MIN_W = 220, MIN_H = 140;

    function createHandle(dir) {
      var h = document.createElement('div');
      h.className = 'window-resize-handle window-resize-handle-' + dir;
      win.appendChild(h);
      h.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        focusWindow(id);
        if (windows[id].maximized) return;
        var rect = win.getBoundingClientRect();
        resizing = dir;
        resizeStart = {
          x: e.clientX, y: e.clientY,
          left: rect.left, top: rect.top,
          width: rect.width, height: rect.height
        };
        win.style.left = rect.left + 'px';
        win.style.top = rect.top + 'px';
        win.style.width = rect.width + 'px';
        win.style.height = rect.height + 'px';
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeUp);
      });
    }
    dirs.forEach(createHandle);

    function onResizeMove(e) {
      if (!resizing) return;
      var dx = e.clientX - resizeStart.x;
      var dy = e.clientY - resizeStart.y;
      var s = resizing, r = resizeStart;
      var newL = r.left, newT = r.top, newW = r.width, newH = r.height;

      if (s.indexOf('e') >= 0) newW = Math.max(MIN_W, r.width + dx);
      if (s.indexOf('w') >= 0) {
        newW = Math.max(MIN_W, r.width - dx);
        newL = r.left + r.width - newW;
      }
      if (s.indexOf('s') >= 0) newH = Math.max(MIN_H, r.height + dy);
      if (s.indexOf('n') >= 0) {
        newH = Math.max(MIN_H, r.height - dy);
        newT = r.top + r.height - newH;
      }

      win.style.left = newL + 'px';
      win.style.top = newT + 'px';
      win.style.width = newW + 'px';
      win.style.height = newH + 'px';
    }
    function onResizeUp() {
      resizing = null;
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeUp);
      triggerContentResize(id);
    }

    windows[id].dragHandlers = { mousemove: onMouseMove, mouseup: onMouseUp, resizeMove: onResizeMove, resizeUp: onResizeUp };

    /* Minimize */
    win.querySelector('.btn-minimize').addEventListener('click', function () { minimizeWindow(id); });

    /* Maximize */
    win.querySelector('.btn-maximize').addEventListener('click', function () { maximizeWindow(id); });

    /* Close */
    win.querySelector('.btn-close').addEventListener('click', function () { closeWindow(id); });
  }

  function focusWindow(id) {
    const w = windows[id];
    if (!w) return;
    w.el.style.zIndex = ++zIndexCounter;
    Object.keys(windows).forEach(k => {
      windows[k].el.classList.remove('active');
    });
    w.el.classList.add('active');
    updateTaskbarActive(id);
  }

  function minimizeWindow(id) {
    const w = windows[id];
    if (!w) return;
    if (w.maximized) toggleMaximize(id);
    w.minimized = true;
    w.el.style.display = 'none';
    const tb = document.querySelector(`.taskbar-item[data-win="${id}"]`);
    if (tb) tb.classList.remove('active');
  }

  function maximizeWindow(id) {
    const w = windows[id];
    if (!w) return;
    toggleMaximize(id);
  }

  function toggleMaximize(id) {
    const w = windows[id];
    if (!w) return;
    const el = w.el;
    if (!w.maximized) {
      w.prevRect = el.getBoundingClientRect();
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = window.innerWidth + 'px';
      el.style.height = (window.innerHeight - 36) + 'px';
      w.maximized = true;
      el.querySelector('.btn-maximize').textContent = '❐';
    } else {
      const pr = w.prevRect;
      el.style.left = pr.left + 'px';
      el.style.top = pr.top + 'px';
      el.style.width = pr.width + 'px';
      el.style.height = pr.height + 'px';
      w.maximized = false;
      el.querySelector('.btn-maximize').textContent = '□';
    }
    el.style.zIndex = ++zIndexCounter;
    triggerContentResize(id);
  }

  function triggerContentResize(id) {
    var w = windows[id];
    if (!w) return;
    var content = w.el.querySelector('.window-content');
    if (!content) return;
    var cw = content.clientWidth;

    /* Music player — narrow playlist / stack when cramped */
    var container = w.el.querySelector('.mp-container');
    if (container) {
      container.classList.toggle('mp-stack', cw < 280);
    }
    var pl = w.el.querySelector('.mp-playlist');
    if (pl) {
      pl.classList.toggle('mp-playlist-narrow', cw < 420);
    }

    /* Narrow content padding */
    content.classList.toggle('win-content-narrow', cw < 350);

    /* Fire a custom event so apps can react */
    content.dispatchEvent(new CustomEvent('winresize'));
  }

  function closeWindow(id) {
    const w = windows[id];
    if (!w) return;
    if (w.dragHandlers) {
      document.removeEventListener('mousemove', w.dragHandlers.mousemove);
      document.removeEventListener('mouseup', w.dragHandlers.mouseup);
      document.removeEventListener('mousemove', w.dragHandlers.resizeMove);
      document.removeEventListener('mouseup', w.dragHandlers.resizeUp);
    }
    if (w.resizeObserver) w.resizeObserver.disconnect();
    if (w.cleanup) w.cleanup();
    w.el.remove();
    delete windows[id];
    const tb = document.querySelector(`.taskbar-item[data-win="${id}"]`);
    if (tb) tb.remove();
  }

  /* ========== TASKBAR ========== */
  function addTaskbarItem(id, config) {
    const item = document.createElement('div');
    item.className = 'taskbar-item';
    item.dataset.win = id;
    item.innerHTML = `<span class="taskbar-item-icon">${config.icon}</span><span>${config.title}</span>`;
    item.addEventListener('click', function () {
      const w = windows[id];
      if (!w) return;
      if (w.minimized) {
        w.minimized = false;
        w.el.style.display = 'flex';
        focusWindow(id);
      } else {
        minimizeWindow(id);
      }
    });
    item.addEventListener('dblclick', function () { closeWindow(id); });
    TASKBAR_ITEMS.appendChild(item);
  }

  function updateTaskbarActive(id) {
    document.querySelectorAll('.taskbar-item').forEach(el => el.classList.remove('active'));
    const tb = document.querySelector(`.taskbar-item[data-win="${id}"]`);
    if (tb) tb.classList.add('active');
  }

  /* ========== START MENU ========== */
  START_BUTTON.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleStartMenu();
  });

  function toggleStartMenu() {
    startMenuOpen = !startMenuOpen;
    START_MENU.classList.toggle('visible', startMenuOpen);
    START_BUTTON.classList.toggle('active', startMenuOpen);
  }

  function closeStartMenu() {
    startMenuOpen = false;
    START_MENU.classList.remove('visible');
    START_BUTTON.classList.remove('active');
  }

  document.addEventListener('click', function (e) {
    if (startMenuOpen && !START_MENU.contains(e.target) && e.target !== START_BUTTON && !START_BUTTON.contains(e.target)) {
      closeStartMenu();
    }
  });

  /* Start menu items */
  document.querySelectorAll('.start-item').forEach(item => {
    item.addEventListener('click', function () {
      const app = this.dataset.app;
      if (app) {
        openWindow(app);
        closeStartMenu();
      }
    });
  });

  /* Shutdown */
  document.getElementById('start-shutdown').addEventListener('click', function () {
    closeStartMenu();
    showShutdownDialog();
  });

  function showShutdownDialog() {
    if (shutdownOverlay) return;
    shutdownOverlay = document.createElement('div');
    shutdownOverlay.className = 'shutdown-overlay';
    shutdownOverlay.innerHTML = `
      <div class="shutdown-dialog">
        <p>🖥️ Shut down trippa.day?</p>
        <div style="display:flex;gap:8px;justify-content:center;">
          <span class="btn-98" id="shutdown-yes">Yes</span>
          <span class="btn-98" id="shutdown-no">No</span>
        </div>
      </div>
    `;
    document.body.appendChild(shutdownOverlay);

    document.getElementById('shutdown-yes').addEventListener('click', function () {
      animateShutdown();
    });

    document.getElementById('shutdown-no').addEventListener('click', function () {
      shutdownOverlay.remove();
      shutdownOverlay = null;
    });
  }

  function animateShutdown() {
    if (shutdownOverlay) shutdownOverlay.remove();
    document.querySelectorAll('.window').forEach(w => w.remove());
    document.querySelectorAll('.taskbar-item').forEach(t => t.remove());
    document.getElementById('taskbar').style.display = 'none';
    START_MENU.style.display = 'none';
    ICON_GRID.style.display = 'none';

    const screen = document.createElement('div');
    screen.className = 'shutdown-screen';
    screen.innerHTML = `
      <div class="logo">🖥️</div>
      <div class="msg">Windows 98 is shutting down...</div>
      <div class="submsg">trippa.day</div>
    `;
    document.body.appendChild(screen);
  }

  /* ========== SECRET DARK MODE ========== */
  function toggleDarkMode() {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode', darkMode);
    try { localStorage.setItem('trippa-dark', darkMode); } catch (e) {}
  }

  /* ========== SECRET UNLOCK TRIGGERS ========== */
  document.addEventListener('click', function (e) { tryUnlock(e); });

  /* ========== BROWSER RESIZE — reflow maximized windows ========== */
  window.addEventListener('resize', function () {
    Object.keys(windows).forEach(function (id) {
      var w = windows[id];
      if (w && w.maximized) {
        w.el.style.width = window.innerWidth + 'px';
        w.el.style.height = (window.innerHeight - 36) + 'px';
      }
    });
  });

  /* ========== KEYBOARD SHORTCUTS ========== */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && shutdownOverlay) {
      shutdownOverlay.remove();
      shutdownOverlay = null;
    }
    if (e.key === 'Escape' && startMenuOpen) {
      closeStartMenu();
    }
    if ((e.ctrlKey && e.key === 'Escape') || e.key === 'Meta') {
      e.preventDefault();
      toggleStartMenu();
    }

  });

})();
