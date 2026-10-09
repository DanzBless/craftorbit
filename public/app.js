// CraftOrbit Pro Client Application
let ws = null;
let currentTab = 'dashboard';
let currentFilePath = '';
let editingFilePath = '';
let commandHistory = [];
let historyIndex = -1;
let serverStatus = 'offline';
let configuredMaxRamBytes = 6 * 1024 * 1024 * 1024; // Default 6GB
let audioEnabled = localStorage.getItem('craftorbit_audio') !== 'false';
let aiConversationHistory = [];
let cachedMods = [];
let cachedLocalIp = '127.0.0.1';
let serverTps = 20.0;

// Performance Chart & Storage Doughnut instances
let perfChart = null;
let storageChart = null;
const perfData = {
  labels: [],
  ram: [],
  cpu: []
};

// ================= AUDIO SYNTHESIZER =================
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;

function playSound(type) {
  if (!audioEnabled || !audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'start') {
      // Ascending chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'stop') {
      // Descending tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (type === 'cmd') {
      // Short click
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'alert') {
      // High ping
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  } catch (e) {}
}

function toggleAudio() {
  audioEnabled = !audioEnabled;
  localStorage.setItem('craftorbit_audio', audioEnabled);
  const icon = document.getElementById('soundIcon');
  if (icon) {
    icon.setAttribute('data-lucide', audioEnabled ? 'volume-2' : 'volume-x');
    lucide.createIcons();
  }
  showToast(audioEnabled ? 'UI sound effects enabled' : 'UI sound effects muted', 'info');
}

// Format bytes helper
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Toast notification helper
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const colorClasses = {
    info: 'bg-[#121212] border-[#2e2e2e] text-neutral-200',
    success: 'bg-white text-black border-white font-medium',
    warning: 'bg-[#181818] border-[#3e3e3e] text-white',
    error: 'bg-[#1c1c1c] border-white text-white'
  }[type] || 'bg-[#121212] border-[#2e2e2e] text-neutral-200';

  toast.className = `pointer-events-auto px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-medium flex items-center gap-2 transition-all transform duration-300 translate-y-2 opacity-0 ${colorClasses}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['dashboard', 'ai', 'mods', 'players', 'storage', 'playit', 'console', 'files', 'settings'];

  tabs.forEach(t => {
    const view = document.getElementById(`view-${t}`);
    const btn = document.getElementById(`tab-${t}`);
    const sideBtn = document.getElementById(`side-tab-${t}`);

    if (view) {
      if (t === tabId) {
        view.classList.remove('hidden');
      } else {
        view.classList.add('hidden');
      }
    }
    if (btn) {
      if (t === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (sideBtn) {
      if (t === tabId) {
        sideBtn.classList.add('active');
      } else {
        sideBtn.classList.remove('active');
      }
    }
  });

  // Update Breadcrumb Title in Sidebar Mode
  const breadcrumbEl = document.getElementById('breadcrumbActiveTitle');
  const titleMap = {
    dashboard: 'Workspace Overview',
    console: 'Live Console',
    settings: 'Server Settings',
    ai: 'AI Server Sage',
    files: 'File Manager',
    mods: 'Mod Manager',
    storage: 'Backups & Storage',
    playit: 'Global Network',
    players: 'Players & Roster'
  };
  if (breadcrumbEl && titleMap[tabId]) {
    breadcrumbEl.textContent = titleMap[tabId];
  }

  if (tabId === 'storage') {
    loadStorageOverview();
    loadBackups();
  } else if (tabId === 'playit') {
    loadPlayitStatus();
  } else if (tabId === 'mods') {
    loadModsList();
  } else if (tabId === 'players') {
    loadPlayersData();
  } else if (tabId === 'files') {
    loadFiles(currentFilePath);
  } else if (tabId === 'settings') {
    loadSettings();
  }
}

// ================= CHART.JS INITIALIZATION =================
function initTelemetryCharts() {
  // 1. Performance Chart (RAM & CPU Line Chart) - Monochrome
  const perfCtx = document.getElementById('perfChartCanvas');
  if (perfCtx) {
    perfChart = new Chart(perfCtx, {
      type: 'line',
      data: {
        labels: perfData.labels,
        datasets: [
          {
            label: 'RAM (MB)',
            data: perfData.ram,
            borderColor: '#ffffff',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: 'yRam'
          },
          {
            label: 'CPU (%)',
            data: perfData.cpu,
            borderColor: '#71717a',
            backgroundColor: 'rgba(113, 113, 122, 0.04)',
            fill: true,
            tension: 0.3,
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            yAxisID: 'yCpu'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            display: false
          },
          yRam: {
            type: 'linear',
            position: 'left',
            min: 0,
            suggestedMax: 6144, // 6GB
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#a1a1aa',
              font: { size: 10, family: 'monospace' },
              callback: (v) => v + ' MB'
            }
          },
          yCpu: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#71717a',
              font: { size: 10, family: 'monospace' },
              callback: (v) => v + '%'
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#0a0a0a',
            borderColor: '#262626',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#e4e4e7'
          }
        }
      }
    });
  }

  // 2. Storage Doughnut Chart - Monochrome Grayscale
  const storageCtx = document.getElementById('storageDoughnutCanvas');
  if (storageCtx) {
    storageChart = new Chart(storageCtx, {
      type: 'doughnut',
      data: {
        labels: ['World Data', 'Mods', 'Setup Zip', 'Libraries', 'Logs', 'Other'],
        datasets: [{
          data: [2790, 848, 782, 117, 30, 61],
          backgroundColor: [
            '#ffffff', // Pure White (World)
            '#d4d4d8', // Off White (Mods)
            '#a1a1aa', // Silver (Zip)
            '#71717a', // Neutral Grey (Libraries)
            '#52525b', // Darker Grey (Logs)
            '#27272a'  // Charcoal (Configs)
          ],
          borderColor: '#0a0a0a',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0a0a0a',
            borderColor: '#262626',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw} MB`
            }
          }
        }
      }
    });
  }
}

// Push live telemetry data point to Chart
function recordTelemetryPoint(ramMB, cpuPercent) {
  const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  perfData.labels.push(timeLabel);
  perfData.ram.push(ramMB);
  perfData.cpu.push(cpuPercent);

  // Keep last 25 points
  if (perfData.labels.length > 25) {
    perfData.labels.shift();
    perfData.ram.shift();
    perfData.cpu.shift();
  }

  if (perfChart) {
    perfChart.update();
  }
}

// ================= WEBSOCKET CONNECTION =================
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to dashboard server');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'log') {
        renderLogLine(msg.data);
      } else if (msg.type === 'logs_history') {
        const miniScreen = document.getElementById('dashMiniConsole');
        const fullScreen = document.getElementById('fullConsoleScreen');
        miniScreen.innerHTML = '';
        fullScreen.innerHTML = '';
        msg.data.forEach(renderLogLine);
      } else if (msg.type === 'status') {
        updateServerStatusUI(msg.data);
      } else if (msg.type === 'playit_status') {
        updatePlayitUI(msg.data);
      } else if (msg.type === 'playit_log') {
        renderPlayitLog(msg.data);
      } else if (msg.type === 'provision_progress') {
        updateProvisionProgress(msg.data);
      } else if (msg.type === 'telemetry') {
        updateTelemetryUI(msg.data);
      }
    } catch (e) {
      console.error('Error handling WS message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Render log lines with syntax coloring
function renderLogLine(logEntry) {
  const text = logEntry.text || '';
  const miniScreen = document.getElementById('dashMiniConsole');
  const fullScreen = document.getElementById('fullConsoleScreen');

  let logClass = 'log-info';
  if (text.includes('[Dashboard ERROR]') || text.includes('/ERROR]') || text.includes('Exception:') || text.includes('Crash')) {
    logClass = 'log-error';
    playSound('alert');
  } else if (text.includes('/WARN]')) {
    logClass = 'log-warn';
  } else if (text.includes('<') && text.includes('>')) {
    logClass = 'log-chat';
  } else if (text.startsWith('[Dashboard]')) {
    logClass = 'log-dash';
  }

  // Mini console
  const miniLine = document.createElement('div');
  miniLine.className = `log-line ${logClass} truncate`;
  miniLine.textContent = text;
  miniScreen.appendChild(miniLine);
  if (miniScreen.children.length > 60) {
    miniScreen.removeChild(miniScreen.firstChild);
  }
  miniScreen.scrollTop = miniScreen.scrollHeight;

  // Full console
  const fullLine = document.createElement('div');
  fullLine.className = `log-line ${logClass}`;
  fullLine.textContent = text;

  // Filter check
  const filterVal = document.getElementById('consoleFilter').value.toLowerCase();
  if (filterVal && !text.toLowerCase().includes(filterVal)) {
    fullLine.style.display = 'none';
  }

  fullScreen.appendChild(fullLine);
  if (fullScreen.children.length > 2000) {
    fullScreen.removeChild(fullScreen.firstChild);
  }

  const autoScroll = document.getElementById('autoScrollCheck').checked;
  if (autoScroll) {
    fullScreen.scrollTop = fullScreen.scrollHeight;
  }
}

function filterConsoleLogs() {
  const filter = document.getElementById('consoleFilter').value.toLowerCase();
  const lines = document.getElementById('fullConsoleScreen').children;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].textContent.toLowerCase();
    lines[i].style.display = text.includes(filter) ? '' : 'none';
  }
}

function clearConsoleView() {
  document.getElementById('fullConsoleScreen').innerHTML = '';
}

// Update Status Badge & Controls
function updateServerStatusUI(data) {
  const prevStatus = serverStatus;
  serverStatus = data.status || 'offline';
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const heroStatusText = document.getElementById('heroStatusText');
  const heroStatusDot = document.getElementById('heroStatusDot');
  const heroBtnStart = document.getElementById('heroBtnStart');
  const heroBtnStop = document.getElementById('heroBtnStop');

  if (serverStatus === 'online') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-black border border-white text-xs font-mono font-semibold';
    statusDot.className = 'w-2 h-2 rounded-full bg-black pulse-active';
    statusText.textContent = 'ONLINE';
    if (heroStatusText) heroStatusText.textContent = 'ONLINE';
    if (heroStatusDot) heroStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 pulse-active';
    btnStart.disabled = true;
    btnStart.classList.add('opacity-40', 'cursor-not-allowed');
    btnStop.disabled = false;
    btnStop.classList.remove('opacity-50', 'cursor-not-allowed');
    if (heroBtnStart) { heroBtnStart.disabled = true; heroBtnStart.classList.add('opacity-40', 'cursor-not-allowed'); }
    if (heroBtnStop) { heroBtnStop.disabled = false; heroBtnStop.classList.remove('opacity-50', 'cursor-not-allowed'); }
    if (prevStatus === 'starting') playSound('start');
  } else if (serverStatus === 'starting') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#181818] border border-[#333] text-xs font-mono text-white';
    statusDot.className = 'w-2 h-2 rounded-full bg-white animate-ping';
    statusText.textContent = 'STARTING...';
    if (heroStatusText) heroStatusText.textContent = 'STARTING...';
    if (heroStatusDot) heroStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    btnStart.disabled = true;
    btnStart.classList.add('opacity-40', 'cursor-not-allowed');
    btnStop.disabled = false;
    btnStop.classList.remove('opacity-50', 'cursor-not-allowed');
    if (heroBtnStart) { heroBtnStart.disabled = true; heroBtnStart.classList.add('opacity-40', 'cursor-not-allowed'); }
    if (heroBtnStop) { heroBtnStop.disabled = false; heroBtnStop.classList.remove('opacity-50', 'cursor-not-allowed'); }
  } else if (serverStatus === 'stopping') {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141414] border border-[#333] text-xs font-mono text-neutral-400';
    statusDot.className = 'w-2 h-2 rounded-full bg-neutral-400';
    statusText.textContent = 'STOPPING...';
    if (heroStatusText) heroStatusText.textContent = 'STOPPING...';
    if (heroStatusDot) heroStatusDot.className = 'w-2 h-2 rounded-full bg-neutral-400';
    btnStart.disabled = true;
    btnStop.disabled = true;
    btnStop.classList.add('opacity-50', 'cursor-not-allowed');
    if (heroBtnStart) { heroBtnStart.disabled = true; heroBtnStart.classList.add('opacity-40', 'cursor-not-allowed'); }
    if (heroBtnStop) { heroBtnStop.disabled = true; heroBtnStop.classList.add('opacity-50', 'cursor-not-allowed'); }
  } else {
    statusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0a0a0a] border border-[#262626] text-xs font-mono text-neutral-400';
    statusDot.className = 'w-2 h-2 rounded-full bg-neutral-600';
    statusText.textContent = 'OFFLINE';
    if (heroStatusText) heroStatusText.textContent = 'OFFLINE';
    if (heroStatusDot) heroStatusDot.className = 'w-2 h-2 rounded-full bg-neutral-600';
    btnStart.disabled = false;
    btnStart.classList.remove('opacity-40', 'cursor-not-allowed');
    btnStop.disabled = true;
    btnStop.classList.add('opacity-50', 'cursor-not-allowed');
    if (heroBtnStart) { heroBtnStart.disabled = false; heroBtnStart.classList.remove('opacity-40', 'cursor-not-allowed'); }
    if (heroBtnStop) { heroBtnStop.disabled = true; heroBtnStop.classList.add('opacity-50', 'cursor-not-allowed'); }
    if (prevStatus === 'stopping' || prevStatus === 'online') playSound('stop');
  }

  // Uptime
  if (data.uptime && data.uptime > 0) {
    const hrs = Math.floor(data.uptime / 3600);
    const mins = Math.floor((data.uptime % 3600) / 60);
    const secs = data.uptime % 60;
    document.getElementById('uptimeBadge').textContent = `Uptime: ${hrs}h ${mins}m ${secs}s`;
  } else {
    document.getElementById('uptimeBadge').textContent = 'Uptime: --';
  }

  // Players
  if (data.players) {
    document.getElementById('onlinePlayersCount').innerHTML = `${data.players.length} <span class="text-xs font-normal text-slate-500">/ 5 max</span>`;
    document.getElementById('onlinePlayersList').textContent = data.players.length > 0 ? data.players.join(', ') : 'No players connected';
  }

  // RAM configuration max
  if (data.config && data.config.maxRam) {
    document.getElementById('serverRamMax').textContent = `Allocated: -Xmx${data.config.maxRam}`;
    const ramNum = parseFloat(data.config.maxRam);
    if (data.config.maxRam.toUpperCase().includes('G')) {
      configuredMaxRamBytes = ramNum * 1024 * 1024 * 1024;
    } else if (data.config.maxRam.toUpperCase().includes('M')) {
      configuredMaxRamBytes = ramNum * 1024 * 1024;
    }
  }

  // Welcome Hero vs Server Controls
  const welcomeHero = document.getElementById('welcomeHeroCard');
  const isDummy = !activeInstanceData || activeInstanceData.id === 'none';

  if (welcomeHero) {
    if (isDummy) {
      welcomeHero.classList.remove('hidden');
    } else {
      welcomeHero.classList.add('hidden');
    }
  }

  updateShareInviteUI();
}

// Update Telemetry UI
function updateTelemetryUI(telemetry) {
  if (telemetry.server) {
    updateServerStatusUI(telemetry.server);
  }
  if (telemetry.playit) {
    updatePlayitUI(telemetry.playit);
  }

  let curRamMB = 0;
  if (telemetry.process && telemetry.process.memoryBytes) {
    const memBytes = telemetry.process.memoryBytes;
    curRamMB = telemetry.process.memoryMB || Math.round(memBytes / (1024 * 1024));
    document.getElementById('serverRamUsage').textContent = formatBytes(memBytes);
    const percent = Math.min(100, Math.round((memBytes / configuredMaxRamBytes) * 100));
    document.getElementById('ramPercentText').textContent = `${percent}%`;
    document.getElementById('ramBar').style.width = `${percent}%`;
  } else if (serverStatus === 'offline') {
    document.getElementById('serverRamUsage').textContent = '0 MB';
    document.getElementById('ramPercentText').textContent = '0%';
    document.getElementById('ramBar').style.width = '0%';
  }

  let curCpu = 0;
  if (telemetry.system) {
    curCpu = telemetry.system.cpuPercent || 0;
    document.getElementById('cpuUsageVal').textContent = `${curCpu}%`;
    document.getElementById('cpuPercentText').textContent = `${curCpu}%`;
    document.getElementById('cpuBar').style.width = `${curCpu}%`;
  }

    recordTelemetryPoint(curRamMB, curCpu);

    // Sync Server Hero Workspace Card
    const heroCpu = document.getElementById('heroCpuPercent');
    const heroCpuBar = document.getElementById('heroCpuBar');
    if (heroCpu) heroCpu.textContent = `${curCpu}%`;
    if (heroCpuBar) heroCpuBar.style.width = `${Math.min(100, curCpu)}%`;

    const heroRam = document.getElementById('heroRamUsage');
    const heroRamBar = document.getElementById('heroRamBar');
    const ramUsageEl = document.getElementById('serverRamUsage');
    const ramBarEl = document.getElementById('ramBar');
    if (heroRam && ramUsageEl) heroRam.textContent = ramUsageEl.textContent;
    if (heroRamBar && ramBarEl) heroRamBar.style.width = ramBarEl.style.width;

    if (telemetry.serverPing) {
      const badge = document.getElementById('slpPingBadge');
      if (badge) {
        if (telemetry.serverPing.online) {
          badge.textContent = `Ping: ${telemetry.serverPing.latencyMs} ms`;
          badge.className = 'font-mono text-white text-[10px] font-bold';
        } else if (serverStatus === 'online') {
          badge.textContent = 'Server starting...';
          badge.className = 'font-mono text-neutral-400 text-[10px]';
        } else {
          badge.textContent = 'Ping: -- ms';
          badge.className = 'font-mono text-neutral-500 text-[10px]';
        }
      }
    }

    if (telemetry.drive && telemetry.drive.total) {
    const freeGb = (telemetry.drive.free / (1024 * 1024 * 1024)).toFixed(1);
    const totalGb = (telemetry.drive.total / (1024 * 1024 * 1024)).toFixed(1);
    document.getElementById('diskFreeVal').textContent = `${freeGb} GB Available`;
    document.getElementById('diskTotalVal').textContent = `Total: ${totalGb} GB (${telemetry.drive.usedPercent}% used)`;
    document.getElementById('diskPercentText').textContent = `${telemetry.drive.usedPercent}%`;
    document.getElementById('diskBar').style.width = `${telemetry.drive.usedPercent}%`;
    document.getElementById('driveFreeLabel').textContent = `${freeGb} GB`;

    const heroDisk = document.getElementById('heroDiskUsage');
    const heroDiskBar = document.getElementById('heroDiskBar');
    if (heroDisk) heroDisk.textContent = `${freeGb} GB`;
    if (heroDiskBar) heroDiskBar.style.width = `${telemetry.drive.usedPercent}%`;
  }
}

// Copy Server IP
function copyServerIp() {
  const ipText = document.getElementById('headerServerIp').textContent;
  navigator.clipboard.writeText(ipText).then(() => {
    playSound('cmd');
    showToast('Server IP copied to clipboard! (localhost:25402)', 'success');
  });
}

// Server Control Actions
async function startServer() {
  try {
    playSound('cmd');
    showToast('Starting Forge Minecraft Server with 6GB RAM...', 'info');
    const res = await fetch('/api/server/start', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Server launch command issued!', 'success');
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function stopServer() {
  if (!confirm('Are you sure you want to stop the Minecraft server?')) return;
  try {
    playSound('cmd');
    showToast('Gracefully stopping server (/stop)...', 'warning');
    const res = await fetch('/api/server/stop', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function restartServer() {
  if (!confirm('Restart Minecraft server now?')) return;
  try {
    playSound('cmd');
    showToast('Restarting server...', 'info');
    const res = await fetch('/api/server/restart', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function killServer() {
  if (!confirm('Force kill the server process immediately?')) return;
  try {
    playSound('stop');
    const res = await fetch('/api/server/kill', { method: 'POST' });
    const data = await res.json();
    showToast('Server process terminated.', 'warning');
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

// Command execution
async function sendCommand(cmd) {
  if (!cmd || !cmd.trim()) return;
  try {
    playSound('cmd');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command: cmd }));
    } else {
      await fetch('/api/server/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });
    }
  } catch (e) {
    showToast(`Failed to send command: ${e.message}`, 'error');
  }
}

function handleQuickCommand(e) {
  e.preventDefault();
  const input = document.getElementById('dashCommandInput');
  const cmd = input.value.trim();
  if (cmd) {
    sendCommand(cmd);
    input.value = '';
  }
}

function handleFullConsoleCommand(e) {
  e.preventDefault();
  const input = document.getElementById('fullConsoleInput');
  const cmd = input.value.trim();
  if (cmd) {
    commandHistory.push(cmd);
    historyIndex = commandHistory.length;
    sendCommand(cmd);
    input.value = '';
  }
}

function sendQuickCommand(cmd) {
  sendCommand(cmd);
  showToast(`Executed: /${cmd}`, 'info');
}

// ================= AI COPILOT & DIAGNOSTICS =================
function formatAiResponse(raw) {
  // Replace Minecraft commands like `/command` or `/cmd args` into clickable buttons
  let formatted = raw.replace(/`(\/[a-zA-Z0-9_\-:]+(?:\s+[^`\n]+)?)`/g, (match, cmd) => {
    return `<button class="cmd-chip" onclick="executeFromAi('${cmd}')" title="Click to run on server">▶ ${cmd}</button>`;
  });

  // Basic markdown bullet points & linebreaks
  formatted = formatted.replace(/\n\n/g, '<br><br>');
  formatted = formatted.replace(/\n- /g, '<br>&bull; ');
  formatted = formatted.replace(/\n(\d+)\. /g, '<br><strong>$1.</strong> ');
  return formatted;
}

function executeFromAi(cmd) {
  sendCommand(cmd);
  showToast(`Command sent: ${cmd}`, 'success');
}

function appendAiMessage(role, text) {
  const windowEl = document.getElementById('aiChatWindow');
  const wrapper = document.createElement('div');
  wrapper.className = `flex gap-3 items-start ${role === 'user' ? 'justify-end' : ''}`;

  if (role === 'user') {
    wrapper.innerHTML = `
      <div class="bg-white text-black font-medium border border-white rounded-xl p-3 text-xs max-w-xl shadow">
        ${text}
      </div>
      <div class="w-8 h-8 rounded-lg bg-neutral-900 border border-[#333] text-white flex items-center justify-center shrink-0 mt-0.5">
        <i data-lucide="user" class="w-4 h-4"></i>
      </div>
    `;
  } else {
    wrapper.innerHTML = `
      <div class="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center shrink-0 mt-0.5">
        <i data-lucide="bot" class="w-4 h-4"></i>
      </div>
      <div class="bg-[#0e0e0e] border border-[#222] rounded-xl p-4 text-xs leading-relaxed max-w-3xl text-neutral-200 space-y-2">
        ${formatAiResponse(text)}
      </div>
    `;
  }

  windowEl.appendChild(wrapper);
  windowEl.scrollTop = windowEl.scrollHeight;
  lucide.createIcons();
}

async function handleAiSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('aiUserInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendAiMessage('user', message);
  aiConversationHistory.push({ role: 'user', content: message });

  // Add loading placeholder
  const loadingPlaceholder = document.createElement('div');
  loadingPlaceholder.id = 'aiLoadingIndicator';
  loadingPlaceholder.className = 'flex gap-3 items-center text-xs text-neutral-400 font-mono italic';
  loadingPlaceholder.innerHTML = `<span class="w-2 h-2 rounded-full bg-white animate-ping"></span> AI Copilot is thinking...`;
  document.getElementById('aiChatWindow').appendChild(loadingPlaceholder);

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: aiConversationHistory })
    });
    const data = await res.json();
    loadingPlaceholder.remove();

    if (data.error) throw new Error(data.error);
    appendAiMessage('assistant', data.reply);
    aiConversationHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    if (loadingPlaceholder) loadingPlaceholder.remove();
    appendAiMessage('assistant', `⚠️ Error connecting to 9Router AI: ${err.message}`);
  }
}

function sendAiPreset(prompt) {
  switchTab('ai');
  document.getElementById('aiUserInput').value = prompt;
  handleAiSubmit();
}

async function runQuickDiagnosis() {
  switchTab('ai');
  appendAiMessage('user', 'Running full server diagnostics (Logs, stack traces & crash reports)...');
  showToast('Analyzing server logs with AI Doctor...', 'info');

  const loadingPlaceholder = document.createElement('div');
  loadingPlaceholder.id = 'aiLoadingIndicator';
  loadingPlaceholder.className = 'flex gap-3 items-center text-xs text-neutral-400 font-mono italic';
  loadingPlaceholder.innerHTML = `<span class="w-2 h-2 rounded-full bg-white animate-ping"></span> Reading logs and generating diagnosis...`;
  document.getElementById('aiChatWindow').appendChild(loadingPlaceholder);

  try {
    const res = await fetch('/api/ai/diagnose', { method: 'POST' });
    const data = await res.json();
    loadingPlaceholder.remove();

    if (data.error) throw new Error(data.error);

    appendAiMessage('assistant', data.diagnosis);
    document.getElementById('quickAiStatus').textContent = `Last Diagnosis: ${new Date().toLocaleTimeString()} - Analyzed ${data.rawErrorCount || 0} log events.`;
  } catch (e) {
    if (loadingPlaceholder) loadingPlaceholder.remove();
    appendAiMessage('assistant', `Diagnosis failed: ${e.message}`);
  }
}

function clearAiChat() {
  aiConversationHistory = [];
  document.getElementById('aiChatWindow').innerHTML = `
    <div class="flex gap-3 items-start">
      <div class="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center shrink-0 mt-0.5">
        <i data-lucide="bot" class="w-4 h-4"></i>
      </div>
      <div class="bg-[#0e0e0e] border border-[#222] rounded-xl p-4 text-xs leading-relaxed max-w-3xl text-neutral-200">
        <p class="font-semibold text-white">Chat cleared.</p>
        <p class="text-neutral-400 text-[11px] mt-1">Ready for your next question or diagnosis.</p>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// ================= MOD MANAGER & MODRINTH STORE =================
let currentModSubtab = 'installed';
let modStoreHits = [];

function switchModSubtab(tab) {
  currentModSubtab = tab;
  const btnInstalled = document.getElementById('subtab-installed');
  const btnStore = document.getElementById('subtab-store');
  const viewInstalled = document.getElementById('modSubviewInstalled');
  const viewStore = document.getElementById('modSubviewStore');

  if (tab === 'installed') {
    btnInstalled.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black transition flex items-center gap-1.5';
    btnStore.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#141414] hover:bg-[#202020] text-neutral-300 border border-[#333] transition flex items-center gap-1.5';
    viewInstalled.classList.remove('hidden');
    viewStore.classList.add('hidden');
    loadModsList();
  } else {
    btnStore.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-black transition flex items-center gap-1.5';
    btnInstalled.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#141414] hover:bg-[#202020] text-neutral-300 border border-[#333] transition flex items-center gap-1.5';
    viewStore.classList.remove('hidden');
    viewInstalled.classList.add('hidden');
    if (modStoreHits.length === 0) {
      searchModrinthStore();
    }
  }
}

async function searchModrinthStore(e) {
  if (e) e.preventDefault();
  const query = document.getElementById('modStoreQuery')?.value.trim() || '';
  const catalogType = document.getElementById('modStoreCatalogType')?.value || 'mod';
  const grid = document.getElementById('modStoreResultsGrid');
  if (grid) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center text-neutral-500 text-xs font-mono"><span class="w-2 h-2 rounded-full bg-white animate-ping inline-block mr-2"></span>Searching Modrinth ${catalogType}s...</div>`;
  }

  try {
    const version = activeInstanceData?.mcVersion || '';
    const loader = activeInstanceData?.type || '';
    const res = await fetch(`/api/modrinth/search?query=${encodeURIComponent(query)}&version=${encodeURIComponent(version)}&loader=${encodeURIComponent(loader)}&type=${encodeURIComponent(catalogType)}&limit=15`);
    const data = await res.json();
    modStoreHits = data.hits || [];
    renderModStoreGrid(modStoreHits, catalogType);
  } catch (err) {
    if (grid) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-neutral-500 text-xs font-mono">Failed to load Modrinth catalog: ${err.message}</div>`;
    }
  }
}

function quickStoreSearch(term, catalogType = 'mod') {
  const input = document.getElementById('modStoreQuery');
  const typeSelect = document.getElementById('modStoreCatalogType');
  if (input) input.value = term;
  if (typeSelect && catalogType) typeSelect.value = catalogType;
  searchModrinthStore();
}

function renderModStoreGrid(hits, catalogType = 'mod') {
  const grid = document.getElementById('modStoreResultsGrid');
  if (!grid) return;

  if (!hits || hits.length === 0) {
    grid.innerHTML = '<div class="col-span-full py-12 text-center text-neutral-500 text-xs font-mono">No items found matching your query.</div>';
    return;
  }

  const isModpack = catalogType === 'modpack';

  grid.innerHTML = hits.map(h => `
    <div class="bg-[#0e0e0e] border border-[#222] hover:border-[#3a3a3a] rounded-xl p-3.5 flex flex-col justify-between transition">
      <div class="flex items-start gap-3">
        <img src="${h.iconUrl || 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f9e9.png'}" class="w-10 h-10 rounded-lg object-cover bg-black border border-[#222] shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f9e9.png'">
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-1">
            <h4 class="font-bold text-xs text-white truncate" title="${h.title}">${h.title}</h4>
            ${isModpack ? '<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-neutral-900 border border-[#333] text-neutral-300">PACK</span>' : ''}
          </div>
          <p class="text-[11px] text-neutral-400 line-clamp-2 mt-1 leading-snug">${h.description || 'No description provided'}</p>
        </div>
      </div>
      <div class="mt-3 pt-2.5 border-t border-[#1a1a1a] flex items-center justify-between">
        <span class="text-[10px] text-neutral-500 font-mono">📥 ${(h.downloads || 0).toLocaleString()}</span>
        ${isModpack ? `
          <a href="https://modrinth.com/modpack/${h.slug || h.id}" target="_blank" class="px-3 py-1 rounded-lg bg-[#141414] hover:bg-[#202020] text-neutral-200 border border-[#333] text-xs transition flex items-center gap-1">
            <i data-lucide="external-link" class="w-3 h-3"></i> View Pack
          </a>
        ` : `
          <button onclick="installModrinthMod('${h.id}', '${h.title.replace(/'/g, "\\'")}')" id="btnInstall-${h.id}" class="px-3 py-1 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition flex items-center gap-1">
            <i data-lucide="download" class="w-3 h-3"></i> Install
          </button>
        `}
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

async function installModrinthMod(projectId, title) {
  const btn = document.getElementById(`btnInstall-${projectId}`);
  if (btn) {
    btn.disabled = true;
    btn.className = 'px-3 py-1 rounded-lg bg-[#222] text-neutral-400 text-xs font-mono';
    btn.textContent = 'Installing...';
  }

  try {
    playSound('cmd');
    showToast(`Downloading and installing ${title}...`, 'info');
    const res = await fetch('/api/modrinth/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast(`Installed: ${data.fileName}! (Restart server to load)`, 'success');
    if (btn) {
      btn.className = 'px-3 py-1 rounded-lg bg-black text-white border border-[#333] text-xs font-mono';
      btn.textContent = 'Installed ✓';
    }
  } catch (e) {
    showToast(`Install failed: ${e.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.className = 'px-3 py-1 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold text-xs';
      btn.textContent = 'Install';
    }
  }
}

async function loadModsList() {
  try {
    const res = await fetch('/api/mods');
    const data = await res.json();
    cachedMods = data.mods || [];

    document.getElementById('modStatTotal').textContent = data.totalCount;
    document.getElementById('modStatEnabled').textContent = data.enabledCount;
    document.getElementById('modStatDisabled').textContent = data.disabledCount;
    document.getElementById('modStatSize').textContent = formatBytes(data.totalBytes);
    document.getElementById('badgeModCount').textContent = data.totalCount;
    const sideModBadge = document.getElementById('sidebarBadgeModCount');
    if (sideModBadge) sideModBadge.textContent = data.totalCount;

    const countSubtab = document.getElementById('modSubtabCount');
    if (countSubtab) countSubtab.textContent = data.totalCount;

    renderModsTable(cachedMods);
  } catch (e) {
    showToast(`Failed to load mods: ${e.message}`, 'error');
  }
}

function renderModsTable(mods) {
  const tbody = document.getElementById('modsTableBody');
  if (!mods || mods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-neutral-500">No matching mods found.</td></tr>`;
    return;
  }

  tbody.innerHTML = mods.map(m => `
    <tr class="hover:bg-[#121212] transition">
      <td class="py-2 px-4">
        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium ${m.enabled ? 'bg-white/10 text-white border border-white/20' : 'bg-neutral-900 text-neutral-500 border border-neutral-800'}">
          <span class="w-1.5 h-1.5 rounded-full ${m.enabled ? 'bg-white' : 'bg-neutral-600'}"></span>
          ${m.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </td>
      <td class="py-2 px-4 font-mono text-neutral-200">
        ${m.name}
      </td>
      <td class="py-2 px-4 font-mono text-neutral-400">${formatBytes(m.size)}</td>
      <td class="py-2 px-4 text-right">
        <button onclick="toggleMod('${m.fileName}')" class="px-3 py-1 rounded-lg text-xs font-medium transition ${m.enabled ? 'bg-[#141414] hover:bg-[#222] text-neutral-300 border border-[#333]' : 'bg-white hover:bg-neutral-200 text-black font-semibold'}">
          ${m.enabled ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  `).join('');
}

function filterModsList() {
  const q = document.getElementById('modSearchInput').value.toLowerCase();
  const filtered = cachedMods.filter(m => m.name.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q));
  renderModsTable(filtered);
}

async function toggleMod(fileName) {
  try {
    playSound('cmd');
    const res = await fetch('/api/mods/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Mod ${data.enabled ? 'enabled' : 'disabled'}: ${data.newName}`, 'success');
    loadModsList();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

// ================= PLAYER ROSTER & ACTIONS =================
async function loadPlayersData() {
  try {
    const res = await fetch('/api/players/data');
    const data = await res.json();
    const container = document.getElementById('playerCardsGrid');

    if (!data.players || data.players.length === 0) {
      container.innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">No known players recorded in server yet.</div>`;
      return;
    }

    container.innerHTML = data.players.map(p => `
      <div class="bg-black border ${p.isOnline ? 'border-white/50' : 'border-[#222]'} rounded-xl p-4 flex flex-col justify-between">
        <div class="flex items-center gap-3">
          <img src="https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/56" alt="${p.name}" class="w-11 h-11 rounded-lg border border-[#333] bg-[#141414]" onerror="this.src='https://mc-heads.net/avatar/Steve/56'">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-sm text-white truncate">${p.name}</h4>
              ${p.isOp ? '<span class="text-xs text-white font-bold" title="Server Operator">OP</span>' : ''}
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              <span class="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.2 rounded-full ${p.isOnline ? 'bg-white text-black font-semibold' : 'bg-[#141414] text-neutral-400 border border-[#262626]'}">
                <span class="w-1.5 h-1.5 rounded-full ${p.isOnline ? 'bg-black' : 'bg-neutral-600'}"></span>
                ${p.isOnline ? 'Online' : 'Offline'}
              </span>
              ${p.isBanned ? '<span class="text-[10px] font-mono bg-neutral-900 border border-[#333] text-neutral-400 px-1.5 rounded">Banned</span>' : ''}
              ${p.isWhitelisted ? '<span class="text-[10px] font-mono bg-white/10 text-white border border-white/20 px-1.5 rounded">WL</span>' : ''}
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-[#1e1e1e] flex items-center justify-between gap-1 text-xs">
          <button onclick="playerAction('${p.name}', '${p.isOp ? 'deop' : 'op'}')" class="px-2 py-1 rounded bg-[#141414] hover:bg-[#222] text-neutral-300 border border-[#262626] transition text-[11px]">
            ${p.isOp ? 'De-OP' : 'OP'}
          </button>
          <button onclick="playerAction('${p.name}', '${p.isWhitelisted ? 'whitelist_remove' : 'whitelist_add'}')" class="px-2 py-1 rounded bg-[#141414] hover:bg-[#222] text-neutral-300 border border-[#262626] transition text-[11px]">
            ${p.isWhitelisted ? '- WL' : '+ WL'}
          </button>
          <button onclick="playerAction('${p.name}', 'kick')" class="px-2 py-1 rounded bg-[#141414] hover:bg-[#222] text-neutral-300 border border-[#262626] transition text-[11px]">
            Kick
          </button>
          <button onclick="playerAction('${p.name}', '${p.isBanned ? 'pardon' : 'ban'}')" class="px-2 py-1 rounded bg-[#141414] hover:bg-neutral-900 text-neutral-400 hover:text-white border border-[#262626] transition text-[11px]">
            ${p.isBanned ? 'Unban' : 'Ban'}
          </button>
        </div>

        <!-- In-Game Powers Row -->
        <div class="mt-2 pt-2 border-t border-[#141414] flex flex-wrap items-center justify-between gap-1 text-[10px]">
          <span class="text-neutral-500 font-mono">Powers:</span>
          <button onclick="playerAction('${p.name}', 'give_diamonds')" class="px-1.5 py-0.5 rounded bg-[#111] hover:bg-white hover:text-black border border-[#262626] text-neutral-300 transition" title="Give 64x Diamonds">💎 64x</button>
          <button onclick="playerAction('${p.name}', 'heal')" class="px-1.5 py-0.5 rounded bg-[#111] hover:bg-white hover:text-black border border-[#262626] text-neutral-300 transition" title="Instant Health & Feed">💖 Heal</button>
          <button onclick="playerAction('${p.name}', 'gm_creative')" class="px-1.5 py-0.5 rounded bg-[#111] hover:bg-white hover:text-black border border-[#262626] text-neutral-300 transition" title="Set Gamemode: Creative">⚡ Creative</button>
          <button onclick="playerAction('${p.name}', 'gm_survival')" class="px-1.5 py-0.5 rounded bg-[#111] hover:bg-white hover:text-black border border-[#262626] text-neutral-300 transition" title="Set Gamemode: Survival">🏹 Survival</button>
        </div>
      </div>
    `).join('');

    lucide.createIcons();
  } catch (e) {
    showToast(`Error loading players: ${e.message}`, 'error');
  }
}

async function playerAction(player, action) {
  try {
    playSound('cmd');
    const res = await fetch('/api/players/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, player })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Action executed: ${data.command}`, 'success');
    loadPlayersData();
  } catch (e) {
    showToast(`Action failed: ${e.message}`, 'error');
  }
}

function handleQuickPlayerAction(e) {
  e.preventDefault();
  const input = document.getElementById('quickPlayerNameInput');
  const action = document.getElementById('quickPlayerActionSelect').value;
  const player = input.value.trim();
  if (!player) return;

  playerAction(player, action);
  input.value = '';
}

// ================= STORAGE MANAGEMENT =================
async function loadStorageOverview() {
  try {
    const res = await fetch('/api/storage/overview');
    const data = await res.json();

    document.getElementById('dashTotalServerVal').textContent = formatBytes(data.totalServerSize);
    document.getElementById('totalServerSize').textContent = formatBytes(data.totalServerSize);

    const total = Math.max(data.totalServerSize, 1);
    const pWorld = Math.max(1, Math.round((data.categories.world.size / total) * 100));
    const pMods = Math.max(1, Math.round((data.categories.mods.size / total) * 100));
    const pArch = Math.round((data.categories.archives.size / total) * 100);
    const pLib = Math.round((data.categories.libraries.size / total) * 100);
    const pLogs = Math.round((data.categories.logs.size / total) * 100);
    const pOther = Math.max(0, 100 - (pWorld + pMods + pArch + pLib + pLogs));

    document.getElementById('barWorld').style.width = `${pWorld}%`;
    document.getElementById('barMods').style.width = `${pMods}%`;
    document.getElementById('barArchives').style.width = `${pArch}%`;
    document.getElementById('barLibraries').style.width = `${pLib}%`;
    document.getElementById('barLogs').style.width = `${pLogs}%`;
    document.getElementById('barOther').style.width = `${pOther}%`;

    // Cleaner card values
    document.getElementById('logCleanSize').textContent = `${formatBytes(data.categories.logs.oldLogsSize)} (${data.categories.logs.oldLogsCount} files)`;
    document.getElementById('archiveZipSize').textContent = formatBytes(data.categories.archives.size);

    const btnDelZip = document.getElementById('btnDeleteZip');
    if (data.categories.archives.size === 0) {
      btnDelZip.disabled = true;
      btnDelZip.classList.add('opacity-40', 'cursor-not-allowed');
      btnDelZip.textContent = 'Archive Already Deleted';
    } else {
      btnDelZip.disabled = false;
      btnDelZip.classList.remove('opacity-40', 'cursor-not-allowed');
      btnDelZip.innerHTML = `<i data-lucide="trash" class="w-3.5 h-3.5"></i> Delete Setup Zip (${formatBytes(data.categories.archives.size)})`;
    }

    // World breakdown
    const wb = data.categories.world.breakdown;
    document.getElementById('dimOverworld').textContent = formatBytes(wb.overworld);
    document.getElementById('dimNether').textContent = formatBytes(wb.nether);
    document.getElementById('dimEnd').textContent = formatBytes(wb.theEnd);
    document.getElementById('dimPlayerdata').textContent = formatBytes(wb.playerdata);
    document.getElementById('dimEntities').textContent = formatBytes(wb.entities);

    // Update Storage Doughnut Chart
    if (storageChart) {
      const toMB = (bytes) => Math.round((bytes || 0) / (1024 * 1024));
      storageChart.data.datasets[0].data = [
        toMB(data.categories.world.size),
        toMB(data.categories.mods.size),
        toMB(data.categories.archives.size),
        toMB(data.categories.libraries.size),
        toMB(data.categories.logs.size),
        toMB(data.categories.configs.size)
      ];
      storageChart.update();
    }

    lucide.createIcons();
  } catch (e) {
    console.error('Error loading storage overview:', e);
  }
}

async function quickCleanLogs() {
  await cleanOldLogs();
}

async function cleanOldLogs() {
  try {
    playSound('cmd');
    showToast('Purging old compressed logs...', 'info');
    const res = await fetch('/api/storage/clean-logs', { method: 'POST' });
    const data = await res.json();
    showToast(`Cleaned ${data.deletedCount} old logs, freed ${formatBytes(data.freedBytes)}!`, 'success');
    loadStorageOverview();
  } catch (e) {
    showToast(`Failed to clean logs: ${e.message}`, 'error');
  }
}

async function cleanCache() {
  try {
    playSound('cmd');
    showToast('Cleaning cache files and old crash logs...', 'info');
    const res = await fetch('/api/storage/clean-cache', { method: 'POST' });
    const data = await res.json();
    showToast(`Cleaned ${data.deletedCount} temp items, freed ${formatBytes(data.freedBytes)}!`, 'success');
    loadStorageOverview();
  } catch (e) {
    showToast(`Failed to clean cache: ${e.message}`, 'error');
  }
}

async function deleteSetupArchive() {
  if (!confirm('Are you sure you want to delete the initial server pack ZIP? This will free ~782 MB of disk space. Only proceed if your server is already installed.')) {
    return;
  }
  try {
    playSound('cmd');
    showToast('Deleting setup zip file...', 'info');
    const res = await fetch('/api/storage/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath: 'CARPG Ultimate V7b Serv.zip' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`Successfully deleted setup archive! Freed ${formatBytes(data.freedBytes)}!`, 'success');
    loadStorageOverview();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function triggerWorldBackup() {
  try {
    playSound('cmd');
    showToast('Creating world backup (.zip)... This may take 30-60 seconds for large worlds.', 'info');
    const res = await fetch('/api/storage/backup', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    playSound('alert');
    showToast(`Backup created: ${data.fileName} (${formatBytes(data.size)})`, 'success');
    loadBackups();
    loadStorageOverview();
  } catch (e) {
    showToast(`Backup failed: ${e.message}`, 'error');
  }
}

async function loadBackups() {
  try {
    const res = await fetch('/api/storage/backups');
    const backups = await res.json();
    const tbody = document.getElementById('backupTableBody');

    if (!backups || backups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-neutral-500">No backups created yet. Click "New Backup" above to create one.</td></tr>`;
      return;
    }

    tbody.innerHTML = backups.map(b => `
      <tr class="hover:bg-[#121212] transition">
        <td class="py-2.5 px-4 font-mono font-medium text-white flex items-center gap-2">
          <i data-lucide="archive" class="w-4 h-4 text-white"></i> ${b.name}
        </td>
        <td class="py-2.5 px-4 font-mono text-neutral-400">${formatBytes(b.size)}</td>
        <td class="py-2.5 px-4 text-neutral-400 font-mono text-[11px]">${new Date(b.mtime).toLocaleString()}</td>
        <td class="py-2.5 px-4 text-right space-x-1.5">
          <button onclick="restoreBackupFile('${b.name}')" class="px-2.5 py-1 rounded bg-white hover:bg-neutral-200 text-black font-semibold inline-flex items-center gap-1 transition" title="Restore world from this backup">
            <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Restore
          </button>
          <a href="/api/storage/download-backup/${encodeURIComponent(b.name)}" class="px-2.5 py-1 rounded bg-[#141414] hover:bg-[#202020] text-neutral-200 border border-[#333] font-medium inline-flex items-center gap-1 transition">
            <i data-lucide="download" class="w-3 h-3"></i> Download
          </a>
          <button onclick="deleteBackupFile('${b.name}')" class="px-2.5 py-1 rounded bg-[#141414] hover:bg-neutral-900 text-neutral-400 hover:text-white border border-[#262626] font-medium inline-flex items-center gap-1 transition">
            <i data-lucide="trash-2" class="w-3 h-3"></i> Delete
          </button>
        </td>
      </tr>
    `).join('');

    lucide.createIcons();
  } catch (e) {
    console.error('Error loading backups:', e);
  }
}

async function restoreBackupFile(name) {
  if (serverStatus !== 'offline') {
    showToast('Please stop the server before restoring a backup!', 'warning');
    return;
  }
  if (!confirm(`Restore world from "${name}"? Current world state will be safely archived beforehand.`)) {
    return;
  }

  try {
    playSound('cmd');
    showToast(`Restoring backup "${name}"...`, 'info');
    const res = await fetch('/api/storage/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: name })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast(`World successfully restored from ${name}! (${formatBytes(data.restoredSize)})`, 'success');
    loadStorageOverview();
  } catch (err) {
    showToast(`Restore failed: ${err.message}`, 'error');
  }
}

async function deleteBackupFile(name) {
  if (!confirm(`Delete backup "${name}"?`)) return;
  try {
    playSound('cmd');
    const res = await fetch('/api/storage/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath: `backups/${name}` })
    });
    const data = await res.json();
    showToast(`Deleted backup: ${name}`, 'success');
    loadBackups();
    loadStorageOverview();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, 'error');
  }
}

// ================= FILE EXPLORER =================
async function loadFiles(relPath) {
  currentFilePath = relPath;
  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();

    const crumbs = relPath.split('/').filter(Boolean);
    let breadcrumbHtml = `<button onclick="loadFiles('')" class="hover:text-emerald-400">root</button>`;
    let accumulated = '';
    crumbs.forEach(c => {
      accumulated += (accumulated ? '/' : '') + c;
      const target = accumulated;
      breadcrumbHtml += ` <span class="text-slate-600">/</span> <button onclick="loadFiles('${target}')" class="hover:text-emerald-400">${c}</button>`;
    });
    document.getElementById('filePathBreadcrumbs').innerHTML = breadcrumbHtml;

    const tbody = document.getElementById('fileExplorerBody');
    let rows = '';

    if (relPath) {
      const parent = crumbs.slice(0, -1).join('/');
      rows += `
        <tr class="hover:bg-[#121212] cursor-pointer transition" onclick="loadFiles('${parent}')">
          <td class="py-2.5 px-4 font-mono font-medium text-white flex items-center gap-2">
            <i data-lucide="corner-left-up" class="w-4 h-4 text-white"></i> .. (Parent Directory)
          </td>
          <td class="py-2.5 px-4 text-neutral-500">--</td>
          <td class="py-2.5 px-4 text-neutral-500">--</td>
          <td class="py-2.5 px-4 text-right"></td>
        </tr>
      `;
    }

    if (data.items.length === 0) {
      rows += `<tr><td colspan="4" class="py-6 text-center text-neutral-500">Folder is empty</td></tr>`;
    } else {
      data.items.forEach(item => {
        const itemRelPath = (relPath ? relPath + '/' : '') + item.name;
        if (item.isDirectory) {
          rows += `
            <tr class="hover:bg-[#121212] cursor-pointer transition" onclick="loadFiles('${itemRelPath}')">
              <td class="py-2.5 px-4 font-medium text-white flex items-center gap-2">
                <i data-lucide="folder" class="w-4 h-4 text-white"></i> ${item.name}
              </td>
              <td class="py-2.5 px-4 text-neutral-500">--</td>
              <td class="py-2.5 px-4 text-neutral-400 font-mono text-[11px]">${new Date(item.mtime).toLocaleDateString()}</td>
              <td class="py-2.5 px-4 text-right">
                <span class="text-neutral-500 text-xs">Folder</span>
              </td>
            </tr>
          `;
        } else {
          const isEditable = item.name.endsWith('.txt') || item.name.endsWith('.properties') || item.name.endsWith('.json') || item.name.endsWith('.toml') || item.name.endsWith('.cfg') || item.name.endsWith('.log') || item.name.endsWith('.sh') || item.name.endsWith('.ps1');
          rows += `
            <tr class="hover:bg-[#121212] transition">
              <td class="py-2.5 px-4 font-mono text-neutral-300 flex items-center gap-2">
                <i data-lucide="file-text" class="w-4 h-4 text-neutral-400"></i> ${item.name}
              </td>
              <td class="py-2.5 px-4 font-mono text-neutral-400">${formatBytes(item.size)}</td>
              <td class="py-2.5 px-4 text-neutral-400 font-mono text-[11px]">${new Date(item.mtime).toLocaleDateString()}</td>
              <td class="py-2.5 px-4 text-right">
                ${isEditable ? `
                  <button onclick="openFileEditor('${itemRelPath}')" class="px-2.5 py-1 rounded bg-[#141414] hover:bg-[#222] text-white border border-[#333] text-xs transition">
                    Edit
                  </button>
                ` : `<span class="text-neutral-600 text-xs">Binary</span>`}
              </td>
            </tr>
          `;
        }
      });
    }

    tbody.innerHTML = rows;
    lucide.createIcons();
  } catch (e) {
    showToast(`Error loading files: ${e.message}`, 'error');
  }
}

function refreshCurrentFolder() {
  loadFiles(currentFilePath);
}

// In-Browser File Editor
async function openFileEditor(filePath) {
  editingFilePath = filePath;
  try {
    playSound('cmd');
    const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('editorFileName').textContent = filePath;
    document.getElementById('editorContent').value = data.content;
    document.getElementById('fileEditorModal').classList.remove('hidden');
  } catch (e) {
    showToast(`Cannot open file: ${e.message}`, 'error');
  }
}

function closeFileEditor() {
  document.getElementById('fileEditorModal').classList.add('hidden');
  editingFilePath = '';
}

async function saveFileEditor() {
  if (!editingFilePath) return;
  const content = document.getElementById('editorContent').value;
  try {
    playSound('cmd');
    const res = await fetch('/api/file-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: editingFilePath, content })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`Saved changes to ${editingFilePath}`, 'success');
    closeFileEditor();
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 'error');
  }
}

// ================= SETTINGS & PROPERTIES =================
async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    if (data.launch) {
      document.getElementById('cfgMaxRam').value = data.launch.maxRam || '6G';
      document.getElementById('cfgMinRam').value = data.launch.minRam || '4G';
      document.getElementById('cfgJavaPath').value = data.launch.javaPath || 'java';
      document.getElementById('cfgAutoRestart').checked = !!data.launch.autoRestart;
    }

    if (data.properties) {
      document.getElementById('propPort').value = data.properties['server-port'] || '25402';
      document.getElementById('propMaxPlayers').value = data.properties['max-players'] || '5';
      document.getElementById('propMotd').value = data.properties['motd'] || 'Minecraft Server';
      document.getElementById('propGamemode').value = data.properties['gamemode'] || 'survival';
      document.getElementById('propDifficulty').value = data.properties['difficulty'] || 'easy';
      document.getElementById('propOnlineMode').value = data.properties['online-mode'] || 'false';
      document.getElementById('propPvp').value = data.properties['pvp'] || 'true';
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

function setRam(ram) {
  document.getElementById('cfgMaxRam').value = ram;
}

async function saveLaunchSettings(e) {
  e.preventDefault();
  const maxRam = document.getElementById('cfgMaxRam').value.trim();
  const minRam = document.getElementById('cfgMinRam').value.trim();
  const javaPath = document.getElementById('cfgJavaPath').value.trim();
  const autoRestart = document.getElementById('cfgAutoRestart').checked;

  try {
    playSound('cmd');
    const res = await fetch('/api/config/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxRam, minRam, javaPath, autoRestart })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Launch settings & JVM arguments saved!', 'success');
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function savePropertiesSettings(e) {
  e.preventDefault();
  const port = document.getElementById('propPort').value.trim();
  const maxPlayers = document.getElementById('propMaxPlayers').value.trim();
  const motd = document.getElementById('propMotd').value.trim();
  const gamemode = document.getElementById('propGamemode').value;
  const difficulty = document.getElementById('propDifficulty').value;
  const onlineMode = document.getElementById('propOnlineMode').value;
  const pvp = document.getElementById('propPvp').value;

  try {
    playSound('cmd');
    const res = await fetch('/api/config/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'server-port': port,
        'query.port': port,
        'max-players': maxPlayers,
        'motd': motd,
        'gamemode': gamemode,
        'difficulty': difficulty,
        'online-mode': onlineMode,
        'pvp': pvp
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast('Server properties saved! (Restart server to apply)', 'success');
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

// ================= LANGUAGE & LOCALIZATION (i18n) =================
let currentLang = localStorage.getItem('craftorbit_lang') || 'en';

const i18nDictionary = {
  en: {
    layout_pref_title: "Dashboard Layout & Navigation Preference",
    layout_pref_desc: "Choose your preferred dashboard navigation style. Your preference is automatically remembered across sessions.",
    layout_sidebar_title: "Left Sidebar (Argonara / Pterodactyl)",
    layout_sidebar_desc: "Full-height vertical sidebar on the left with General, Management, and Palette categories. Gives your workspace maximum horizontal breathing room.",
    layout_topbar_title: "Top Horizontal Tabs",
    layout_topbar_desc: "Compact horizontal tab strip across the top header. Best for compact displays or classic minimalist view.",
    lang_pref_title: "Language & Localization",
    lang_pref_desc: "Select your preferred interface display language. Changes take effect instantly across all panels.",
    toast_invite_copied: "Copied full multiplayer invite message!",
    toast_lang_changed: "Language changed to English (US)",
    invite_header: "🎮 Join our Minecraft Server!",
    invite_server: "🏷️ Server",
    invite_how_to: "👉 How to Connect:\n1. Open Minecraft -> Multiplayer / Servers\n2. Direct Connection / Add Server\n3. Enter the server address -> Connect & Play!"
  },
  id: {
    layout_pref_title: "Tata Letak Dashboard & Pilihan Navigasi",
    layout_pref_desc: "Pilih gaya navigasi dashboard sesuai kenyamanan Anda. Pilihan disimpan otomatis di browser.",
    layout_sidebar_title: "Sidebar Kiri (Gaya Argonara / Pterodactyl)",
    layout_sidebar_desc: "Menu vertikal lengkap di sisi kiri dengan kategori General, Management, dan Quick Palette. Area workspace lebih leluasa.",
    layout_topbar_title: "Tab Horizontal Atas",
    layout_topbar_desc: "Menu horizontal ringkas di bagian atas header. Cocok untuk layar kompak atau tampilan minimalis klasik.",
    lang_pref_title: "Bahasa & Lokalisasi",
    lang_pref_desc: "Pilih bahasa tampilan antarmuka. Perubahan langsung aktif seketika tanpa perlu restart.",
    toast_invite_copied: "Berhasil menyalin pesan mabar lengkap!",
    toast_lang_changed: "Bahasa diubah ke Bahasa Indonesia",
    invite_header: "🎮 Ayo Mabar Minecraft!",
    invite_server: "🏷️ Server",
    invite_how_to: "👉 Cara Connect:\n1. Buka Minecraft -> Multiplayer / Servers\n2. Direct Connection / Add Server\n3. Masukkan address sesuai koneksimu -> Join!"
  }
};

function initLanguage() {
  setLanguage(currentLang, false);
}

function toggleLangDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('langDropdown');
  if (menu) menu.classList.toggle('hidden');
}

function setLanguage(lang, showNotification = true) {
  currentLang = lang;
  localStorage.setItem('craftorbit_lang', lang);

  // Close dropdown
  const menu = document.getElementById('langDropdown');
  if (menu) menu.classList.add('hidden');

  // Update badges
  const headerBadge = document.getElementById('headerLangBadge');
  const sidebarBadge = document.getElementById('sidebarLangCode');
  if (headerBadge) headerBadge.textContent = lang.toUpperCase();
  if (sidebarBadge) sidebarBadge.textContent = lang.toUpperCase();

  // Update Dropdown Checks
  const checkEn = document.getElementById('langCheck-en');
  const checkId = document.getElementById('langCheck-id');
  if (checkEn) {
    checkEn.textContent = lang === 'en' ? '✓' : '';
    checkEn.className = lang === 'en' ? 'text-emerald-400 font-bold text-[11px]' : 'text-neutral-600 text-[11px]';
  }
  if (checkId) {
    checkId.textContent = lang === 'id' ? '✓' : '';
    checkId.className = lang === 'id' ? 'text-emerald-400 font-bold text-[11px]' : 'text-neutral-600 text-[11px]';
  }

  // Update Settings Tab Cards
  const cardEn = document.getElementById('langCardEn');
  const cardId = document.getElementById('langCardId');
  const checkSettingEn = document.getElementById('langSettingCheck-en');
  const checkSettingId = document.getElementById('langSettingCheck-id');

  if (cardEn && cardId) {
    if (lang === 'en') {
      cardEn.classList.add('border-emerald-500', 'bg-[#0f181f]');
      cardEn.classList.remove('border-[#2e2e2e]', 'bg-black');
      if (checkSettingEn) {
        checkSettingEn.textContent = 'ACTIVE';
        checkSettingEn.className = 'text-emerald-400 text-xs font-mono font-bold';
      }
      cardId.classList.remove('border-emerald-500', 'bg-[#0f181f]');
      cardId.classList.add('border-[#2e2e2e]', 'bg-black');
      if (checkSettingId) {
        checkSettingId.textContent = 'SELECT';
        checkSettingId.className = 'text-neutral-500 text-xs font-mono';
      }
    } else {
      cardId.classList.add('border-emerald-500', 'bg-[#0f181f]');
      cardId.classList.remove('border-[#2e2e2e]', 'bg-black');
      if (checkSettingId) {
        checkSettingId.textContent = 'ACTIVE';
        checkSettingId.className = 'text-emerald-400 text-xs font-mono font-bold';
      }
      cardEn.classList.remove('border-emerald-500', 'bg-[#0f181f]');
      cardEn.classList.add('border-[#2e2e2e]', 'bg-black');
      if (checkSettingEn) {
        checkSettingEn.textContent = 'SELECT';
        checkSettingEn.className = 'text-neutral-500 text-xs font-mono';
      }
    }
  }

  // Update DOM elements with data-i18n
  const dict = i18nDictionary[lang] || i18nDictionary['en'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });

  if (showNotification) {
    showToast(dict.toast_lang_changed || 'Language updated', 'info');
  }
}

// Global click outside listener to close dropdowns
window.addEventListener('click', (e) => {
  const langMenu = document.getElementById('langDropdown');
  if (langMenu && !langMenu.contains(e.target) && !e.target.closest('button[onclick*="toggleLangDropdown"]')) {
    langMenu.classList.add('hidden');
  }
});

// ================= LAYOUT MODE SWITCHER (SIDEBAR vs TOPBAR) =================
let currentLayoutMode = localStorage.getItem('craftorbit_layout_mode') || 'sidebar';

function initLayoutMode() {
  setLayoutMode(currentLayoutMode, false);
}

function toggleLayoutMode() {
  const newMode = currentLayoutMode === 'sidebar' ? 'topbar' : 'sidebar';
  setLayoutMode(newMode, true);
}

function setLayoutMode(mode, showNotification = true) {
  currentLayoutMode = mode;
  localStorage.setItem('craftorbit_layout_mode', mode);

  const appShell = document.getElementById('appShell');
  const headerLayoutLabel = document.getElementById('headerLayoutLabel');
  const layoutModeLabel = document.getElementById('layoutModeLabel');
  const cardSidebar = document.getElementById('layoutCardSidebar');
  const cardTopbar = document.getElementById('layoutCardTopbar');
  const checkSidebar = document.getElementById('layoutCheckSidebar');
  const checkTopbar = document.getElementById('layoutCheckTopbar');

  if (appShell) {
    if (mode === 'sidebar') {
      appShell.classList.add('mode-sidebar');
      appShell.classList.remove('mode-topbar');
    } else {
      appShell.classList.add('mode-topbar');
      appShell.classList.remove('mode-sidebar');
    }
  }

  if (headerLayoutLabel) {
    headerLayoutLabel.textContent = mode === 'sidebar' ? 'Sidebar Mode' : 'Top Bar Mode';
  }
  if (layoutModeLabel) {
    layoutModeLabel.textContent = mode === 'sidebar' ? 'Sidebar' : 'Top Bar';
  }

  if (cardSidebar && cardTopbar) {
    if (mode === 'sidebar') {
      cardSidebar.classList.add('border-emerald-500', 'bg-[#0f181f]');
      cardSidebar.classList.remove('border-[#2e2e2e]', 'bg-black');
      if (checkSidebar) {
        checkSidebar.textContent = 'ACTIVE';
        checkSidebar.className = 'text-emerald-400 text-xs font-mono font-bold';
      }
      cardTopbar.classList.remove('border-emerald-500', 'bg-[#0f181f]');
      cardTopbar.classList.add('border-[#2e2e2e]', 'bg-black');
      if (checkTopbar) {
        checkTopbar.textContent = 'SELECT';
        checkTopbar.className = 'text-neutral-500 text-xs font-mono';
      }
    } else {
      cardTopbar.classList.add('border-emerald-500', 'bg-[#0f181f]');
      cardTopbar.classList.remove('border-[#2e2e2e]', 'bg-black');
      if (checkTopbar) {
        checkTopbar.textContent = 'ACTIVE';
        checkTopbar.className = 'text-emerald-400 text-xs font-mono font-bold';
      }
      cardSidebar.classList.remove('border-emerald-500', 'bg-[#0f181f]');
      cardSidebar.classList.add('border-[#2e2e2e]', 'bg-black');
      if (checkSidebar) {
        checkSidebar.textContent = 'SELECT';
        checkSidebar.className = 'text-neutral-500 text-xs font-mono';
      }
    }
  }

  if (window.lucide) lucide.createIcons();

  if (showNotification) {
    showToast(mode === 'sidebar' ? 'Switched to Left Sidebar Navigation' : 'Switched to Top Navigation Bar', 'info');
  }
}

// Initial Load
window.addEventListener('DOMContentLoaded', () => {
  initLanguage();
  initLayoutMode();
  initTelemetryCharts();
  connectWebSocket();
  loadInstances();
  loadStorageOverview();
  loadModsList();
  lucide.createIcons();

  const icon = document.getElementById('soundIcon');
  if (icon) {
    icon.setAttribute('data-lucide', audioEnabled ? 'volume-2' : 'volume-x');
    lucide.createIcons();
  }
});

// ================= MULTI-INSTANCE UNIVERSAL MANAGEMENT =================
let allInstances = [];
let activeInstanceData = null;

async function loadInstances() {
  try {
    const res = await fetch('/api/instances');
    const data = await res.json();
    allInstances = data.instances || [];
    activeInstanceData = data.activeInstance;

    // Update Header, Sidebar & Workspace Hero Card
    const sideName = document.getElementById('sidebarInstanceName');
    const sideBadge = document.getElementById('sidebarInstanceTypeBadge');
    const heroName = document.getElementById('heroServerName');
    const heroBadge = document.getElementById('heroEngineBadge');
    const heroIp = document.getElementById('heroServerIpDisplay');

    if (activeInstanceData && activeInstanceData.id !== 'none') {
      document.getElementById('headerInstanceName').textContent = activeInstanceData.name;
      const typeBadge = document.getElementById('headerInstanceTypeBadge');
      typeBadge.textContent = activeInstanceData.detectedEngine || activeInstanceData.type.toUpperCase();
      
      if (sideName) sideName.textContent = activeInstanceData.name;
      if (sideBadge) sideBadge.textContent = activeInstanceData.detectedEngine || activeInstanceData.type.toUpperCase();
      if (heroName) heroName.textContent = activeInstanceData.name;
      if (heroBadge) heroBadge.textContent = activeInstanceData.detectedEngine || activeInstanceData.type.toUpperCase();

      const folderName = activeInstanceData.path.split(/[/\\]/).pop();
      document.getElementById('headerServerFolder').textContent = folderName;
      document.getElementById('headerServerFolder').title = activeInstanceData.path;

      // Update port in header if known
      const port = activeInstanceData.port || (activeInstanceData.type === 'bedrock' ? 19132 : 25402);
      document.getElementById('headerServerIp').textContent = `localhost:${port}`;
      if (heroIp) heroIp.textContent = `localhost:${port}`;
    } else {
      document.getElementById('headerInstanceName').textContent = 'No Server Selected';
      document.getElementById('headerInstanceTypeBadge').textContent = 'START';
      if (sideName) sideName.textContent = 'No Server Selected';
      if (sideBadge) sideBadge.textContent = 'START';
      if (heroName) heroName.textContent = 'No Server Selected';
      if (heroBadge) heroBadge.textContent = 'STANDBY';
      document.getElementById('headerServerFolder').textContent = 'Click Host World to begin';
      document.getElementById('headerServerIp').textContent = 'localhost:25565';
      if (heroIp) heroIp.textContent = 'localhost:25565';
    }

    // Render Dropdown List
    const listEl = document.getElementById('instanceMenuList');
    if (listEl) {
      if (allInstances.length === 0) {
        listEl.innerHTML = '<div class="p-3 text-center text-xs text-neutral-500">No servers registered yet.<br>Click below to host a world!</div>';
      } else {
        listEl.innerHTML = allInstances.map(inst => `
          <div onclick="switchInstance('${inst.id}')" class="p-2 rounded-lg cursor-pointer transition flex items-center justify-between ${inst.isActive ? 'bg-[#1a1a1a] border border-[#333]' : 'hover:bg-[#141414] border border-transparent'}">
            <div class="min-w-0 flex-1 pr-2">
              <div class="flex items-center gap-1.5">
                <strong class="text-xs text-white truncate">${inst.name}</strong>
                ${inst.isActive ? '<span class="text-[9px] uppercase px-1 py-0.2 bg-white text-black font-bold rounded">active</span>' : ''}
              </div>
              <div class="text-[10px] text-neutral-400 font-mono truncate mt-0.5">${inst.detectedEngine || inst.type} &bull; ${inst.path}</div>
            </div>
            ${!inst.isActive && !inst.isRunning ? `
              <button onclick="event.stopPropagation(); deleteInstance('${inst.id}', '${inst.name}')" class="p-1 text-neutral-500 hover:text-white rounded transition" title="Remove from list">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        `).join('');
      }
    }

    lucide.createIcons();
  } catch (e) {
    console.error('Error loading instances:', e);
  }
}

function toggleInstanceMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('instanceMenu');
  if (menu) menu.classList.toggle('hidden');
}

// Click outside to close instance menu
document.addEventListener('click', (e) => {
  const menu = document.getElementById('instanceMenu');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !e.target.closest('button[onclick*="toggleInstanceMenu"]')) {
    menu.classList.add('hidden');
  }
});

async function switchInstance(id) {
  try {
    playSound('cmd');
    showToast('Switching server instance...', 'info');
    const res = await fetch('/api/instances/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const menu = document.getElementById('instanceMenu');
    if (menu) menu.classList.add('hidden');

    showToast(`Switched active server to: ${data.activeInstance.name}`, 'success');

    // Reload all components for the new server
    await loadInstances();
    loadStorageOverview();
    loadBackups();
    loadModsList();
    loadPlayersData();
    loadFiles('');
    loadSettings();
  } catch (e) {
    showToast(`Switch failed: ${e.message}`, 'error');
  }
}

function openAddInstanceModal() {
  const menu = document.getElementById('instanceMenu');
  if (menu) menu.classList.add('hidden');
  document.getElementById('addInstanceModal').classList.remove('hidden');
}

function closeAddInstanceModal() {
  document.getElementById('addInstanceModal').classList.add('hidden');
  document.getElementById('detectResultText').textContent = 'Enter folder path to auto-detect engine type.';
}

async function detectInstPath() {
  const inputPath = document.getElementById('addInstPath').value.trim();
  if (!inputPath) {
    showToast('Please enter a directory path first', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/instances/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: inputPath })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('addInstName').value = data.suggestedName;
    document.getElementById('addInstType').value = data.type;
    document.getElementById('detectResultText').innerHTML = `<span class="text-white font-semibold">Detected: ${data.engineName} (Port ${data.port})</span>`;
    showToast(`Detected: ${data.engineName}`, 'success');
  } catch (e) {
    document.getElementById('detectResultText').textContent = `Detection failed: ${e.message}`;
    showToast(e.message, 'error');
  }
}

async function submitAddInstance(e) {
  e.preventDefault();
  const folderPath = document.getElementById('addInstPath').value.trim();
  const name = document.getElementById('addInstName').value.trim();
  const type = document.getElementById('addInstType').value;
  const maxRam = document.getElementById('addInstMaxRam').value.trim() || '4G';

  try {
    playSound('cmd');
    const res = await fetch('/api/instances/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, name, type, maxRam })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Added server: ${data.instance.name}`, 'success');
    closeAddInstanceModal();
    await loadInstances();

    if (confirm(`Server "${data.instance.name}" registered! Switch to it now?`)) {
      switchInstance(data.instance.id);
    }
  } catch (err) {
    showToast(`Failed to add server: ${err.message}`, 'error');
  }
}

async function deleteInstance(id, name) {
  if (!confirm(`Remove server profile "${name}" from dashboard? (No files on disk will be deleted).`)) return;
  try {
    playSound('cmd');
    const res = await fetch('/api/instances/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    showToast(`Removed server profile: ${name}`, 'info');
    loadInstances();
  } catch (e) {
    showToast(`Failed to remove: ${e.message}`, 'error');
  }
}

// ================= AUTO-HOST WORLD (EGG DEPLOYER) =================
let currentInspectedData = null;
let currentSelectedEgg = 'paper';
let currentAutoEggMode = 'existing'; // 'existing' | 'fresh'

const defaultFreshEggs = [
  {
    id: 'forge',
    name: 'Forge',
    tag: 'Classic Modded',
    desc: 'Minecraft Forge engine for 1.12 - 1.20 modpacks.'
  },
  {
    id: 'neoforge',
    name: 'NeoForge',
    tag: 'Modern Modded',
    desc: 'Official NeoForge engine for 1.20.4+ and 26.x modpacks.'
  },
  {
    id: 'fabric',
    name: 'Fabric',
    tag: 'Fast Modded',
    desc: 'Lightweight modern modded server with auto-installed Fabric-API.'
  },
  {
    id: 'paper',
    name: 'Paper',
    tag: 'Fast & Plugins',
    desc: 'High-performance Java server with Bukkit/Spigot plugins.'
  },
  {
    id: 'vanilla',
    name: 'Vanilla',
    tag: 'Official Mojang',
    desc: 'Clean official Minecraft server without mods.'
  }
];

function switchAutoEggMode(mode) {
  currentAutoEggMode = mode;
  const tabExisting = document.getElementById('tabAutoEggExisting');
  const tabFresh = document.getElementById('tabAutoEggFresh');
  const existingContainer = document.getElementById('autoEggExistingContainer');
  const freshContainer = document.getElementById('autoEggFreshContainer');
  const engineSection = document.getElementById('autoEggEngineSection');
  const configSection = document.getElementById('autoEggConfigSection');
  const btn = document.getElementById('btnAutoEggDeploy');

  if (mode === 'existing') {
    tabExisting.className = 'px-3.5 py-2 text-xs font-semibold rounded-t-lg bg-white text-black transition flex items-center gap-1.5';
    tabFresh.className = 'px-3.5 py-2 text-xs font-semibold rounded-t-lg bg-transparent text-neutral-400 hover:text-white transition flex items-center gap-1.5';
    existingContainer.classList.remove('hidden');
    freshContainer.classList.add('hidden');

    if (!currentInspectedData) {
      engineSection.classList.add('hidden');
      configSection.classList.add('hidden');
      btn.disabled = true;
      btn.classList.add('opacity-40', 'cursor-not-allowed');
    } else {
      engineSection.classList.remove('hidden');
      configSection.classList.remove('hidden');
      btn.disabled = false;
      btn.classList.remove('opacity-40', 'cursor-not-allowed');
    }
    btn.innerHTML = `<i data-lucide="zap" class="w-3.5 h-3.5 fill-current"></i> Deploy & Host World`;
  } else {
    tabFresh.className = 'px-3.5 py-2 text-xs font-semibold rounded-t-lg bg-white text-black transition flex items-center gap-1.5';
    tabExisting.className = 'px-3.5 py-2 text-xs font-semibold rounded-t-lg bg-transparent text-neutral-400 hover:text-white transition flex items-center gap-1.5';
    existingContainer.classList.add('hidden');
    freshContainer.classList.remove('hidden');
    engineSection.classList.remove('hidden');
    configSection.classList.remove('hidden');

    // Render default eggs
    renderEggCards(defaultFreshEggs);

    // Setup fresh server defaults
    const selVer = getFreshSelectedVersion();
    const nameInput = document.getElementById('autoEggServerName');
    if (nameInput && (!nameInput.value || nameInput.value.includes('Server'))) {
      nameInput.value = `Server-${selVer}`;
    }

    btn.disabled = false;
    btn.classList.remove('opacity-40', 'cursor-not-allowed');
    btn.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5 fill-current"></i> Create & Generate Server`;
  }
  lucide.createIcons();
}

function onFreshVersionSelect(e) {
  const val = e.target.value;
  const customBox = document.getElementById('autoEggCustomVersionBox');
  if (val === 'custom') {
    customBox.classList.remove('hidden');
  } else {
    customBox.classList.add('hidden');
  }
  const selVer = getFreshSelectedVersion();
  const nameInput = document.getElementById('autoEggServerName');
  if (nameInput) {
    nameInput.value = `Server-${selVer}`;
  }
}

function getFreshSelectedVersion() {
  const sel = document.getElementById('autoEggFreshVersionSelect')?.value || '26.2';
  if (sel === 'custom') {
    return document.getElementById('autoEggCustomVersionInput')?.value.trim() || '26.2';
  }
  return sel;
}

function updateGeyserVisibility() {
  const geyserBox = document.getElementById('autoEggGeyserToggleContainer');
  if (geyserBox) {
    if (currentSelectedEgg === 'paper') {
      geyserBox.classList.remove('hidden');
      geyserBox.classList.add('flex');
    } else {
      geyserBox.classList.add('hidden');
      geyserBox.classList.remove('flex');
    }
  }
}

function renderEggCards(eggs) {
  const container = document.getElementById('autoEggOptionsContainer');
  if (!container) return;
  container.innerHTML = eggs.map(egg => `
    <div onclick="selectEgg('${egg.id}')" id="eggCard-${egg.id}" class="egg-card p-3 rounded-xl cursor-pointer border transition ${egg.id === currentSelectedEgg ? 'bg-white text-black border-white' : 'bg-black text-neutral-300 border-[#262626] hover:border-neutral-500'}">
      <div class="flex items-center justify-between">
        <strong class="text-xs ${egg.id === currentSelectedEgg ? 'text-black' : 'text-white'}">${egg.name}</strong>
        <span class="text-[9px] font-mono px-1.5 py-0.2 rounded ${egg.id === currentSelectedEgg ? 'bg-black text-white' : 'bg-[#181818] border border-[#333] text-neutral-400'}">${egg.tag}</span>
      </div>
      <p class="text-[11px] mt-1 ${egg.id === currentSelectedEgg ? 'text-neutral-700' : 'text-neutral-400'} leading-snug">${egg.desc}</p>
    </div>
  `).join('');
  updateGeyserVisibility();
}

async function openAutoEggModal() {
  const menu = document.getElementById('instanceMenu');
  if (menu) menu.classList.add('hidden');
  document.getElementById('autoEggModal').classList.remove('hidden');
  switchAutoEggMode(currentAutoEggMode || 'existing');
  await refreshScannedWorlds();
}

function closeAutoEggModal() {
  document.getElementById('autoEggModal').classList.add('hidden');
  document.getElementById('autoEggSpecsCard').classList.add('hidden');
  document.getElementById('autoEggEngineSection').classList.add('hidden');
  document.getElementById('autoEggConfigSection').classList.add('hidden');
  document.getElementById('autoEggProgressBox').classList.add('hidden');
  const btn = document.getElementById('btnAutoEggDeploy');
  btn.disabled = true;
  btn.classList.add('opacity-40', 'cursor-not-allowed');
}

async function refreshScannedWorlds() {
  try {
    const select = document.getElementById('autoEggScannedSelect');
    select.innerHTML = '<option value="">Scanning local singleplayer saves...</option>';
    const res = await fetch('/api/provision/scan-worlds');
    const data = await res.json();
    const worlds = data.worlds || [];

    if (worlds.length === 0) {
      select.innerHTML = '<option value="">No singleplayer worlds found automatically (paste path below)</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Choose from your Singleplayer / Modpack Worlds --</option>' +
      worlds.map(w => `<option value="${w.path}">[${w.source}] ${w.name}</option>`).join('');
  } catch (e) {
    console.error('Error scanning worlds:', e);
  }
}

function onSelectScannedWorld(e) {
  const selectedPath = e.target.value;
  if (selectedPath) {
    document.getElementById('autoEggWorldPath').value = selectedPath;
    inspectSelectedWorld();
  }
}

function onManualWorldPathInput() {
  const pathVal = document.getElementById('autoEggWorldPath').value.trim();
  if (pathVal.length > 5 && (pathVal.includes('saves') || pathVal.includes('world') || pathVal.includes('\\'))) {
    inspectSelectedWorld();
  }
}

async function inspectSelectedWorld() {
  const worldPath = document.getElementById('autoEggWorldPath').value.trim();
  if (!worldPath) {
    showToast('Enter or select a world directory path first', 'warning');
    return;
  }

  try {
    showToast('Inspecting world version and structure...', 'info');
    const res = await fetch('/api/provision/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldPath })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    currentInspectedData = data;
    currentSelectedEgg = data.recommendedEgg || 'paper';

    // Show Specs Card
    document.getElementById('autoEggDetectedName').textContent = data.levelName || 'Minecraft World';
    document.getElementById('autoEggDetectedVersion').textContent = data.mcVersion;
    document.getElementById('autoEggDetectedType').textContent = data.isModded 
      ? `Modded (${data.detectedModloader.toUpperCase()}) - ${data.modCount} mods found` 
      : 'Vanilla / Clean Map';
    document.getElementById('autoEggSpecsCard').classList.remove('hidden');

    // Render Egg Template Cards
    renderEggCards(data.availableEggs);
    document.getElementById('autoEggEngineSection').classList.remove('hidden');

    // Default configuration inputs
    document.getElementById('autoEggServerName').value = `${data.levelName}-Server`;
    document.getElementById('autoEggMaxRam').value = data.isModded ? '6G' : '4G';
    document.getElementById('autoEggConfigSection').classList.remove('hidden');

    // Enable Deploy Button
    const btn = document.getElementById('btnAutoEggDeploy');
    btn.disabled = false;
    btn.classList.remove('opacity-40', 'cursor-not-allowed');

    playSound('cmd');
    showToast(`Detected Minecraft ${data.mcVersion}! Recommended Egg: ${currentSelectedEgg.toUpperCase()}`, 'success');
  } catch (e) {
    showToast(`Inspection error: ${e.message}`, 'error');
  }
}

function selectEgg(eggId) {
  currentSelectedEgg = eggId;
  updateGeyserVisibility();
  const cards = document.querySelectorAll('.egg-card');
  cards.forEach(card => {
    const isSelected = card.id === `eggCard-${eggId}`;
    if (isSelected) {
      card.className = 'egg-card p-3 rounded-xl cursor-pointer border transition bg-white text-black border-white';
      card.querySelector('strong').className = 'text-xs text-black';
      card.querySelector('p').className = 'text-[11px] mt-1 text-neutral-700 leading-snug';
    } else {
      card.className = 'egg-card p-3 rounded-xl cursor-pointer border transition bg-black text-neutral-300 border-[#262626] hover:border-neutral-500';
      card.querySelector('strong').className = 'text-xs text-white';
      card.querySelector('p').className = 'text-[11px] mt-1 text-neutral-400 leading-snug';
    }
  });
}

function updateProvisionProgress(data) {
  const box = document.getElementById('autoEggProgressBox');
  const text = document.getElementById('autoEggProgressText');
  const percentText = document.getElementById('autoEggProgressPercent');
  const bar = document.getElementById('autoEggProgressBar');

  if (box && text) {
    box.classList.remove('hidden');
    text.textContent = data.text || 'Preparing dependencies...';
    if (data.percent >= 0) {
      if (percentText) percentText.textContent = `${data.percent}%`;
      if (bar) bar.style.width = `${data.percent}%`;
    }
  }
}

async function deployAutoEggServer() {
  const isFresh = currentAutoEggMode === 'fresh';
  let mcVersion = '';
  let worldPath = '';
  let serverName = '';
  let seed = '';

  if (isFresh) {
    mcVersion = getFreshSelectedVersion();
    worldPath = '';
    seed = document.getElementById('autoEggFreshSeed')?.value.trim() || '';
    serverName = document.getElementById('autoEggServerName')?.value.trim() || `Server-${mcVersion}`;
  } else {
    if (!currentInspectedData) return;
    mcVersion = currentInspectedData.mcVersion;
    worldPath = document.getElementById('autoEggWorldPath').value.trim();
    serverName = document.getElementById('autoEggServerName')?.value.trim() || `${currentInspectedData.levelName}-Server`;
  }

  const port = parseInt(document.getElementById('autoEggPort').value, 10) || 25565;
  const maxRam = document.getElementById('autoEggMaxRam').value.trim() || '4G';

  const btn = document.getElementById('btnAutoEggDeploy');
  btn.disabled = true;
  btn.classList.add('opacity-40', 'cursor-not-allowed');

  const progressBox = document.getElementById('autoEggProgressBox');
  const progressText = document.getElementById('autoEggProgressText');
  const progressPercent = document.getElementById('autoEggProgressPercent');
  const progressBar = document.getElementById('autoEggProgressBar');

  if (progressBox) progressBox.classList.remove('hidden');
  if (progressText) progressText.textContent = `Connecting to ${currentSelectedEgg.toUpperCase()} (${mcVersion}) repository...`;
  if (progressPercent) progressPercent.textContent = '0%';
  if (progressBar) progressBar.style.width = '5%';

  try {
    playSound('cmd');
    const enableGeyser = currentSelectedEgg === 'paper' && document.getElementById('autoEggEnableGeyser')?.checked !== false;
    const res = await fetch('/api/provision/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worldPath,
        serverName,
        egg: currentSelectedEgg,
        mcVersion,
        port,
        maxRam,
        enableGeyser,
        seed
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast(`Server "${data.instance.name}" (${mcVersion}) created! Click START to play.`, 'success');
    closeAutoEggModal();

    // Reload components with new server active
    await loadInstances();
    loadStorageOverview();
    loadBackups();
    loadModsList();
    loadPlayersData();
    loadFiles('');
    loadSettings();
  } catch (err) {
    progressText.textContent = `Deployment failed: ${err.message}`;
    btn.disabled = false;
    btn.classList.remove('opacity-40', 'cursor-not-allowed');
    showToast(`Deploy error: ${err.message}`, 'error');
  }
}

// ================= PLAYIT.GG GLOBAL HOSTING =================
let playitState = {
  status: 'offline',
  claimUrl: null,
  tunnelsCount: 0,
  publicAddress: '',
  running: false
};

async function loadPlayitStatus() {
  try {
    const res = await fetch('/api/playit/status');
    const data = await res.json();
    updatePlayitUI(data);
    checkGeyserStatus();

    if (data.logs && data.logs.length > 0) {
      const screen = document.getElementById('playitLogsScreen');
      if (screen) {
        screen.innerHTML = '';
        data.logs.forEach(l => renderPlayitLog(l.text || l));
      }
    }
  } catch (e) {
    console.error('Error loading playit status:', e);
  }
}

async function checkGeyserStatus() {
  const geyserStatusEl = document.getElementById('playitGeyserStatus');
  const installRow = document.getElementById('playitGeyserInstallRow');
  if (!geyserStatusEl) return;

  try {
    const res = await fetch('/api/plugins/geyser-status');
    const data = await res.json();

    if (data.installed) {
      geyserStatusEl.textContent = '✓ Installed (Cross-play Ready)';
      geyserStatusEl.className = 'text-white font-bold text-[11px]';
      if (installRow) installRow.classList.add('hidden');
    } else if (data.isCompatible) {
      geyserStatusEl.textContent = 'Not Installed';
      geyserStatusEl.className = 'text-neutral-400 font-mono text-[10px]';
      if (installRow) installRow.classList.remove('hidden');
    } else {
      geyserStatusEl.textContent = 'Engine Native / N/A';
      geyserStatusEl.className = 'text-neutral-500 font-mono text-[10px]';
      if (installRow) installRow.classList.add('hidden');
    }
  } catch (e) {}
}

async function installGeyserToActiveServer() {
  try {
    playSound('cmd');
    showToast('Installing Geyser & Floodgate cross-play plugins...', 'info');
    const res = await fetch('/api/plugins/install-geyser', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast('Geyser & Floodgate installed! Restart server to activate Bedrock cross-play.', 'success');
    checkGeyserStatus();
    loadModsList();
  } catch (err) {
    showToast(`Failed to install Geyser: ${err.message}`, 'error');
  }
}

function updatePlayitUI(data) {
  playitState = { ...playitState, ...data };

  // Header Pill & Sidebar Dot
  const dot = document.getElementById('playitStatusDot');
  const sideDot = document.getElementById('sidebarPlayitDot');
  const headerStatus = document.getElementById('playitHeaderStatus');
  if (dot && headerStatus) {
    if (playitState.status === 'running') {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400 pulse-active';
      if (sideDot) sideDot.className = 'w-2 h-2 rounded-full bg-emerald-400 pulse-active';
      headerStatus.textContent = playitState.publicAddress ? `Global: ${playitState.publicAddress}` : 'Tunnel: Online';
    } else if (playitState.status === 'claiming') {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
      if (sideDot) sideDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
      headerStatus.textContent = 'Link Account';
    } else if (playitState.status === 'starting') {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
      if (sideDot) sideDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
      headerStatus.textContent = 'Tunnel: Starting';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-neutral-600';
      if (sideDot) sideDot.className = 'w-2 h-2 rounded-full bg-neutral-600';
      headerStatus.textContent = 'Tunnel: Off';
    }
  }

  // Playit Tab Elements
  const pill = document.getElementById('playitStatusPill');
  const toggleBtn = document.getElementById('btnPlayitToggle');
  const claimBanner = document.getElementById('playitClaimBanner');
  const claimLink = document.getElementById('btnPlayitClaimLink');
  const tunnelsCount = document.getElementById('playitTunnelsCount');
  const javaAddrInput = document.getElementById('playitJavaAddressInput');
  const bedrockAddrInput = document.getElementById('playitBedrockAddressInput');
  const bedrockPortInput = document.getElementById('playitBedrockPortInput');
  const javaLocalPort = document.getElementById('playitJavaLocalPort');
  const bedrockLocalPort = document.getElementById('playitBedrockLocalPort');

  if (pill) pill.textContent = playitState.status.toUpperCase();
  if (tunnelsCount) tunnelsCount.textContent = playitState.tunnelsCount || '0';

  // Update active profile name indicator in Tunnel Tab
  const profileNameEl = document.getElementById('playitActiveProfileName');
  if (profileNameEl && activeInstanceData) {
    profileNameEl.textContent = activeInstanceData.name;
  }

  const javaAddr = playitState.javaAddress || playitState.publicAddress || '';
  if (javaAddrInput && document.activeElement !== javaAddrInput) {
    javaAddrInput.value = javaAddr;
  }
  if (bedrockAddrInput && document.activeElement !== bedrockAddrInput) {
    bedrockAddrInput.value = playitState.bedrockAddress || '';
  }
  if (bedrockPortInput && document.activeElement !== bedrockPortInput) {
    bedrockPortInput.value = playitState.bedrockPort || '19132';
  }

  // Update local target port based on active server
  const p = activeInstanceData?.port || 25565;
  if (javaLocalPort) javaLocalPort.textContent = `Local Target: 127.0.0.1:${p}`;
  if (bedrockLocalPort) bedrockLocalPort.textContent = `Local Target: 127.0.0.1:19132`;

  // Toggle button
  if (toggleBtn) {
    if (playitState.running) {
      toggleBtn.className = 'px-4 py-1.5 rounded-lg bg-[#141414] hover:bg-[#202020] text-neutral-200 border border-[#333] font-medium text-xs flex items-center gap-1.5 transition';
      toggleBtn.innerHTML = `<i data-lucide="square" class="w-3.5 h-3.5 fill-current"></i> Stop Tunnel`;
    } else {
      toggleBtn.className = 'px-4 py-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black font-semibold text-xs flex items-center gap-1.5 transition';
      toggleBtn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i> Start Tunnel`;
    }
  }

  // Claim banner
  if (claimBanner && claimLink) {
    if (playitState.status === 'claiming' && playitState.claimUrl) {
      claimBanner.classList.remove('hidden');
      claimLink.href = playitState.claimUrl;
    } else {
      claimBanner.classList.add('hidden');
    }
  }

  updateShareInviteUI();
  lucide.createIcons();
}

function renderPlayitLog(line) {
  const screen = document.getElementById('playitLogsScreen');
  if (!screen) return;
  const div = document.createElement('div');
  div.className = 'text-neutral-300 truncate';
  div.textContent = line;
  screen.appendChild(div);
  if (screen.children.length > 200) screen.removeChild(screen.firstChild);
  screen.scrollTop = screen.scrollHeight;
}

async function togglePlayitTunnel() {
  try {
    playSound('cmd');
    if (playitState.running) {
      showToast('Stopping playit tunnel...', 'info');
      await fetch('/api/playit/stop', { method: 'POST' });
    } else {
      showToast('Starting playit tunnel agent...', 'info');
      await fetch('/api/playit/start', { method: 'POST' });
    }
    loadPlayitStatus();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

async function resetPlayitAgent() {
  if (!confirm('Re-link playit.gg account? This will reset the agent key and create a new claim URL.')) return;
  try {
    playSound('cmd');
    showToast('Resetting agent & generating new claim link...', 'info');
    const res = await fetch('/api/playit/reset', { method: 'POST' });
    const data = await res.json();
    loadPlayitStatus();
    if (data.claimUrl) {
      window.open(data.claimUrl, '_blank');
    }
  } catch (e) {
    showToast(`Reset error: ${e.message}`, 'error');
  }
}

async function savePlayitAddresses() {
  const javaAddress = document.getElementById('playitJavaAddressInput')?.value.trim() || '';
  const bedrockAddress = document.getElementById('playitBedrockAddressInput')?.value.trim() || '';
  const bedrockPort = document.getElementById('playitBedrockPortInput')?.value.trim() || '19132';
  const instanceId = activeInstanceData?.id;

  try {
    playSound('cmd');
    const res = await fetch('/api/playit/address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ javaAddress, bedrockAddress, bedrockPort, instanceId })
    });
    const data = await res.json();
    if (activeInstanceData) {
      activeInstanceData.tunnel = { javaAddress, bedrockAddress, bedrockPort };
    }
    showToast(`Tunnel saved for "${data.instanceName || activeInstanceData?.name}"!`, 'success');
    loadPlayitStatus();
    loadInstances();
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}

function copySpecificAddress(type) {
  const port = activeInstanceData?.port || 25565;
  const isTunnelActive = Boolean(playitState && playitState.running);
  let textToCopy = '';

  if (type === 'global' || type === 'java') {
    textToCopy = (isTunnelActive && playitState.javaAddress) ? playitState.javaAddress : `localhost:${port}`;
  } else if (type === 'lan') {
    textToCopy = `${cachedLocalIp}:${port}`;
  } else if (type === 'bedrock') {
    const bPort = playitState.bedrockPort || '19132';
    textToCopy = (isTunnelActive && playitState.bedrockAddress)
      ? `${playitState.bedrockAddress}:${bPort}`
      : `${cachedLocalIp}:19132`;
  }

  navigator.clipboard.writeText(textToCopy).then(() => {
    playSound('cmd');
    showToast(`Copied ${type.toUpperCase()} Address: ${textToCopy}`, 'success');
  });
}

function refreshPlayitStatus() {
  loadPlayitStatus();
  showToast('Refreshed playit status', 'info');
}

// ================= SYSTEM SHUTDOWN =================
async function shutdownDashboard() {
  if (!confirm('Are you sure you want to shut down the CraftOrbit Web Dashboard? This will gracefully save and stop any running Minecraft server, stop the tunnel, and close the command prompt.')) {
    return;
  }

  try {
    playSound('stop');
    showToast('Shutting down CraftOrbit & stopping server...', 'warning');
    await fetch('/api/system/shutdown', { method: 'POST' });

    // Display clean offline screen
    document.body.innerHTML = `
      <div class="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div class="w-16 h-16 rounded-2xl bg-[#111] border border-[#333] flex items-center justify-center mb-5">
          <i data-lucide="power" class="w-8 h-8 text-neutral-400"></i>
        </div>
        <h1 class="text-xl font-bold text-white tracking-tight">CraftOrbit Offline</h1>
        <p class="text-sm text-neutral-400 mt-2 max-w-md">The web dashboard, servers, and background process have been safely terminated.</p>
        <div class="mt-6 p-4 rounded-xl bg-[#0a0a0a] border border-[#222] text-xs font-mono text-neutral-500">
          Command prompt process closed. You may now close this browser tab.
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    showToast(`Shutdown failed: ${e.message}`, 'error');
  }
}

// ================= FRIEND SHARE & QUICK ACTIONS =================
function updateShareInviteUI() {
  const shareBanner = document.getElementById('shareInviteBanner');
  const globalAddrEl = document.getElementById('shareGlobalAddressText');
  const lanAddrEl = document.getElementById('shareLanAddressText');
  const bedrockAddrEl = document.getElementById('shareBedrockAddressText');
  const scopeBadge = document.getElementById('shareInviteScopeBadge');
  const tunnelHint = document.getElementById('shareInviteTunnelHint');
  const isDummy = !activeInstanceData || activeInstanceData.id === 'none';

  if (!shareBanner) return;

  if (serverStatus !== 'online' || isDummy) {
    shareBanner.classList.add('hidden');
    return;
  }

  shareBanner.classList.remove('hidden');
  const port = activeInstanceData?.port || 25565;
  const isTunnelActive = Boolean(playitState && playitState.running);
  const javaAddr = playitState?.javaAddress || playitState?.publicAddress || '';
  const bedrockAddr = playitState?.bedrockAddress || '';
  const bedrockPort = playitState?.bedrockPort || '19132';

  if (globalAddrEl) {
    globalAddrEl.textContent = (isTunnelActive && javaAddr) ? javaAddr : 'Not Configured (playit off)';
  }

  if (lanAddrEl) {
    lanAddrEl.textContent = `${cachedLocalIp}:${port}`;
  }

  if (bedrockAddrEl) {
    if (isTunnelActive && bedrockAddr) {
      bedrockAddrEl.textContent = `${bedrockAddr}:${bedrockPort}`;
    } else {
      bedrockAddrEl.textContent = `${cachedLocalIp}:19132`;
    }
  }

  // Update Scope Badge & Hint
  if (isTunnelActive && javaAddr) {
    if (scopeBadge) {
      scopeBadge.textContent = 'ONLINE WORLDWIDE (playit.gg)';
      scopeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-black text-white uppercase font-bold tracking-wider';
    }
    if (tunnelHint) {
      tunnelHint.innerHTML = '🌍 <span class="text-neutral-700">Outside players connect via <strong>Internet (playit.gg)</strong>. Same Wi-Fi players connect via <strong>Home Wi-Fi (LAN)</strong>.</span>';
    }
  } else {
    if (scopeBadge) {
      scopeBadge.textContent = 'LOCAL / LAN ONLY';
      scopeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-200 text-black border border-neutral-300 uppercase font-semibold';
    }
    if (tunnelHint) {
      tunnelHint.innerHTML = '<span class="text-neutral-600">LAN only. <a href="#" onclick="switchTab(\'playit\'); return false;" class="underline text-black font-semibold">Turn on Global Tunnel</a> to play with friends worldwide!</span>';
    }
  }
}

function copyShareInvite() {
  const isDummy = !activeInstanceData || activeInstanceData.id === 'none';
  if (isDummy) return;

  const port = activeInstanceData?.port || 25565;
  const isTunnelActive = Boolean(playitState && playitState.running);
  const javaAddr = playitState?.javaAddress || playitState?.publicAddress || '';
  const bedrockAddr = playitState?.bedrockAddress || '';
  const bedrockPort = playitState?.bedrockPort || '19132';
  const serverName = activeInstanceData?.name || 'Minecraft Server';
  const engine = activeInstanceData?.detectedEngine || 'Minecraft';

  const globalSec = (isTunnelActive && javaAddr) ? `🌐 Internet (playit.gg):\n👉 PC: ${javaAddr}\n👉 Mobile Bedrock: ${bedrockAddr}:${bedrockPort}\n\n` : '';
  const lanSec = `🏠 Same Wi-Fi (LAN):\n👉 PC: ${cachedLocalIp}:${port}\n👉 Mobile Bedrock: ${cachedLocalIp}:19132\n\n`;

  const dict = (i18nDictionary && i18nDictionary[currentLang]) ? i18nDictionary[currentLang] : i18nDictionary['en'];
  const inviteHeader = dict.invite_header || '🎮 Join our Minecraft Server!';
  const inviteServerLabel = dict.invite_server || '🏷️ Server';
  const inviteHowTo = dict.invite_how_to || '👉 How to Connect:\n1. Open Minecraft -> Multiplayer / Servers\n2. Direct Connection / Add Server\n3. Enter the server address -> Connect & Play!';

  const inviteText = `${inviteHeader}\n${inviteServerLabel}: ${serverName} (${engine})\n\n${globalSec}${lanSec}${inviteHowTo}`;

  navigator.clipboard.writeText(inviteText).then(() => {
    playSound('cmd');
    showToast(dict.toast_invite_copied || 'Copied multiplayer invite message!', 'success');
  });
}

async function broadcastServerAnnouncement(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('serverBroadcastInput');
  const msg = input?.value.trim();
  if (!msg) return;

  if (serverStatus !== 'online') {
    showToast('Server must be online to send broadcast announcements!', 'warning');
    return;
  }

  try {
    playSound('cmd');
    const res = await fetch('/api/players/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', reason: msg })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`Broadcast sent: "${msg}"`, 'success');
    input.value = '';
  } catch (err) {
    showToast(`Broadcast failed: ${err.message}`, 'error');
  }
}

async function sendQuickAction(action) {
  if (serverStatus !== 'online') {
    showToast('Server must be online to execute world shortcuts!', 'warning');
    return;
  }
  try {
    playSound('cmd');
    const res = await fetch('/api/server/quick-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    showToast(`Executed shortcut: /${data.command}`, 'success');
  } catch (e) {
    showToast(`Shortcut error: ${e.message}`, 'error');
  }
}

async function handleModFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.jar')) {
    showToast('Only .jar files can be installed into the mods folder!', 'warning');
    return;
  }

  try {
    playSound('cmd');
    showToast(`Uploading ${file.name}...`, 'info');
    const arrayBuf = await file.arrayBuffer();

    const res = await fetch(`/api/mods/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: arrayBuf
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast(`Installed mod: ${data.fileName}!`, 'success');
    loadModsList();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    e.target.value = '';
  }
}

// ================= COMMAND PALETTE (Ctrl+K) =================
const paletteActions = [
  { id: 'start', title: 'Start Minecraft Server', cat: 'Server Controls', icon: 'play', run: () => startServer() },
  { id: 'stop', title: 'Stop Minecraft Server (Graceful Save)', cat: 'Server Controls', icon: 'square', run: () => stopServer() },
  { id: 'restart', title: 'Restart Server', cat: 'Server Controls', icon: 'rotate-cw', run: () => restartServer() },
  { id: 'kill', title: 'Force Kill Process', cat: 'Server Controls', icon: 'zap-off', run: () => killServer() },
  { id: 'host-world', title: 'Host World (Auto-Egg Deployer)', cat: 'Instance', icon: 'sparkles', run: () => openAutoEggModal() },
  { id: 'add-folder', title: 'Add Existing Server Folder', cat: 'Instance', icon: 'folder-plus', run: () => openAddInstanceModal() },
  { id: 'tunnel', title: 'Toggle playit.gg Global Tunnel', cat: 'Network', icon: 'globe', run: () => togglePlayitTunnel() },
  { id: 'day', title: 'Set World Time: Day', cat: 'World Shortcut', icon: 'sun', run: () => sendQuickAction('day') },
  { id: 'night', title: 'Set World Time: Night', cat: 'World Shortcut', icon: 'moon', run: () => sendQuickAction('night') },
  { id: 'clear-weather', title: 'Clear Weather', cat: 'World Shortcut', icon: 'cloud-sun', run: () => sendQuickAction('weather_clear') },
  { id: 'clearlag', title: 'Clear Ground Clutter (Fix Lag)', cat: 'World Shortcut', icon: 'trash', run: () => sendQuickAction('clearlag') },
  { id: 'save', title: 'Save World Chunks to Disk', cat: 'World Shortcut', icon: 'save', run: () => sendQuickAction('save') },
  { id: 'backup', title: 'Create World Backup (.zip)', cat: 'Storage', icon: 'archive', run: () => triggerWorldBackup() },
  { id: 'purge-logs', title: 'Clear Old Compressed Logs', cat: 'Storage', icon: 'trash-2', run: () => cleanOldLogs() },
  { id: 'clean-cache', title: 'Clean Cache & Crash Reports', cat: 'Storage', icon: 'refresh-cw', run: () => cleanCache() },
  { id: 'diagnose', title: 'Run AI Server Diagnosis', cat: 'AI Copilot', icon: 'stethoscope', run: () => runQuickDiagnosis() },
  { id: 'import-pack', title: 'Import Modpack (.zip)', cat: 'Mods', icon: 'archive', run: () => openImportModpackModal() },
  { id: 'mod-store', title: 'Browse Mod Store (Modrinth)', cat: 'Mods', icon: 'store', run: () => { switchTab('mods'); switchModSubtab('store'); } },
  { id: 'toggle-layout', title: 'Toggle Layout (Sidebar / Topbar)', cat: 'Interface', icon: 'layout', run: () => toggleLayoutMode() },
  { id: 'nav-dashboard', title: 'Go to Overview Dashboard', cat: 'Navigation', icon: 'layout-dashboard', run: () => switchTab('dashboard') },
  { id: 'nav-console', title: 'Go to Live Console', cat: 'Navigation', icon: 'terminal', run: () => switchTab('console') },
  { id: 'nav-files', title: 'Go to File Manager', cat: 'Navigation', icon: 'folder', run: () => switchTab('files') },
  { id: 'nav-mods', title: 'Go to Mod Manager', cat: 'Navigation', icon: 'package', run: () => switchTab('mods') },
  { id: 'nav-storage', title: 'Go to Backups & Storage', cat: 'Navigation', icon: 'database', run: () => switchTab('storage') },
  { id: 'nav-settings', title: 'Go to Server Settings', cat: 'Navigation', icon: 'sliders', run: () => switchTab('settings') },
  { id: 'shutdown', title: 'Shutdown Dashboard & Exit', cat: 'System', icon: 'power', run: () => shutdownDashboard() }
];

function openImportModpackModal() {
  document.getElementById('importModpackModal')?.classList.remove('hidden');
}

function closeImportModpackModal() {
  document.getElementById('importModpackModal')?.classList.add('hidden');
  document.getElementById('importModpackProgress')?.classList.add('hidden');
}

async function submitImportModpack(e) {
  e.preventDefault();
  const zipPath = document.getElementById('importModpackPath')?.value.trim();
  if (!zipPath) return;

  const progress = document.getElementById('importModpackProgress');
  const btn = document.getElementById('btnSubmitImportModpack');
  if (progress) progress.classList.remove('hidden');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-40');
  }

  try {
    playSound('cmd');
    showToast('Unpacking modpack archive into server...', 'info');
    const res = await fetch('/api/modpack/import-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipPath })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    playSound('alert');
    showToast(`Modpack imported successfully! ${data.modCount} mods loaded.`, 'success');
    closeImportModpackModal();
    loadModsList();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    if (progress) progress.classList.add('hidden');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-40');
    }
  }
}

function openCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const input = document.getElementById('paletteSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  filterPaletteItems();
}

function closeCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (modal) modal.classList.add('hidden');
}

function onCommandPaletteBackdrop(e) {
  closeCommandPalette();
}

function filterPaletteItems() {
  const q = document.getElementById('paletteSearchInput')?.value.toLowerCase() || '';
  const container = document.getElementById('paletteItemsList');
  if (!container) return;

  const filtered = paletteActions.filter(a => a.title.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q) || a.id.includes(q));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="p-4 text-center text-neutral-500 font-mono text-xs">No matching actions found</div>';
    return;
  }

  container.innerHTML = filtered.map(a => `
    <div onclick="runPaletteAction('${a.id}')" class="p-2.5 rounded-lg cursor-pointer flex items-center justify-between hover:bg-[#181818] border border-transparent hover:border-[#333] transition group">
      <div class="flex items-center gap-2.5">
        <div class="w-6 h-6 rounded bg-black border border-[#222] text-white flex items-center justify-center shrink-0">
          <i data-lucide="${a.icon}" class="w-3.5 h-3.5"></i>
        </div>
        <span class="font-medium text-white group-hover:underline">${a.title}</span>
      </div>
      <span class="text-[10px] font-mono text-neutral-500">${a.cat}</span>
    </div>
  `).join('');

  lucide.createIcons();
}

function runPaletteAction(id) {
  closeCommandPalette();
  const action = paletteActions.find(a => a.id === id);
  if (action && typeof action.run === 'function') {
    action.run();
  }
}

// Global Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleLayoutMode();
  } else if (e.altKey && !isNaN(e.key) && Number(e.key) >= 1 && Number(e.key) <= 9) {
    e.preventDefault();
    const tabList = ['dashboard', 'console', 'settings', 'ai', 'files', 'mods', 'storage', 'playit', 'players'];
    const targetTab = tabList[Number(e.key) - 1];
    if (targetTab) switchTab(targetTab);
  } else if (e.key === '/' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (currentTab === 'dashboard') {
      const input = document.getElementById('dashCommandInput');
      if (input) { input.focus(); input.select(); }
    } else {
      switchTab('console');
      setTimeout(() => {
        const input = document.getElementById('fullConsoleInput');
        if (input) { input.focus(); input.select(); }
      }, 50);
    }
  } else if (e.key === 'Escape') {
    closeCommandPalette();
    closeAutoEggModal();
    closeAddInstanceModal();
    closeImportModpackModal();
    closeFileEditor();
  }
});
