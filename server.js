const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const MinecraftServer = require('./mc-server');
const StorageManager = require('./storage-manager');
const WorldProvisioner = require('./world-provisioner');
const PlayitManager = require('./playit-manager');
const { pingMinecraft } = require('./server-ping');
const DesktopWindow = require('./desktop-window');
const { ensurePublicAssets } = require('./embedded-assets');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const appRoot = (process.execPath && !process.execPath.endsWith('node.exe') && !process.execPath.endsWith('node'))
  ? path.dirname(process.execPath)
  : __dirname;
const CONFIG_FILE = path.join(appRoot, 'dashboard-config.json');

// Helper to load registry
function loadRegistry() {
  const defaultDir = path.resolve('C:\\Users\\msi_9\\OneDrive\\Desktop\\Antigravity IDE\\Dekstop\\server world');
  const bedrockDir = path.resolve('C:\\Users\\msi_9\\OneDrive\\Desktop\\Antigravity IDE\\Dekstop\\bedrock server');

  let defaultRegistry = {
    activeInstanceId: 'cisco-carpg',
    instances: [
      {
        id: 'cisco-carpg',
        name: 'Cisco CARPG Ultimate',
        path: defaultDir,
        type: 'forge',
        minRam: '4G',
        maxRam: '6G',
        javaPath: 'C:\\Users\\msi_9\\.gradle\\jdks\\eclipse_adoptium-17-amd64-windows.2\\bin\\java.exe',
        autoRestart: false
      },
      {
        id: 'bedrock-server',
        name: 'Aether Legends (Bedrock)',
        path: bedrockDir,
        type: 'bedrock',
        minRam: '2G',
        maxRam: '4G',
        javaPath: '',
        autoRestart: false
      }
    ]
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (data.instances && Array.isArray(data.instances)) {
        return data;
      }
    } catch (e) {}
  }

  saveRegistry(defaultRegistry);
  return defaultRegistry;
}

function saveRegistry(reg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(reg, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving registry:', e);
  }
}

const DUMMY_INSTANCE = {
  id: 'none',
  name: 'No Server Selected',
  path: path.join(__dirname, 'servers'),
  type: 'none',
  minRam: '2G',
  maxRam: '4G',
  javaPath: 'java',
  autoRestart: false
};

let registry = loadRegistry();
let activeInstance = (registry.instances && registry.instances.length > 0)
  ? (registry.instances.find(i => i.id === registry.activeInstanceId) || registry.instances[0])
  : DUMMY_INSTANCE;

console.log(`[CraftOrbit Universal] Initializing with active server: "${activeInstance.name}" (${activeInstance.path})`);

// Instantiate modules
const storage = new StorageManager(activeInstance.path);
const mc = new MinecraftServer(
  activeInstance.path,
  (logEntry) => broadcast({ type: 'log', data: logEntry }),
  (status) => broadcast({ type: 'status', data: { ...status, instanceName: activeInstance.name } }),
  activeInstance
);

const playit = new PlayitManager(
  { activeInstanceId: activeInstance.id },
  (log) => broadcast({ type: 'playit_log', data: log }),
  (status) => broadcast({ type: 'playit_status', data: status })
);
if (activeInstance.tunnel) {
  playit.setInstance(activeInstance.id, activeInstance.tunnel);
}

// Helper to verify directory traversal boundaries safely
function isSafeSubpath(baseDir, targetPath) {
  if (!baseDir || !targetPath) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

app.use(express.json());

// Security: Headers & Cross-Site Protection
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host && !['localhost', '127.0.0.1'].includes(originUrl.hostname)) {
          return res.status(403).json({ error: 'Cross-site request forgery blocked' });
        }
      } catch (e) {
        return res.status(403).json({ error: 'Invalid Origin header' });
      }
    }
  }
  next();
});

ensurePublicAssets(appRoot);
const publicFolder = fs.existsSync(path.join(appRoot, 'public')) 
  ? path.join(appRoot, 'public') 
  : path.join(__dirname, 'public');

app.use(express.static(publicFolder));

function getLocalIpAddress() {
  const ifaces = os.networkInterfaces();
  for (const dev in ifaces) {
    for (const details of ifaces[dev]) {
      if (details.family === 'IPv4' && !details.internal && !details.address.startsWith('169.254')) {
        if (details.address.startsWith('192.168.')) {
          return details.address;
        }
      }
    }
  }
  for (const dev in ifaces) {
    for (const details of ifaces[dev]) {
      if (details.family === 'IPv4' && !details.internal && !details.address.startsWith('169.254')) {
        return details.address;
      }
    }
  }
  return '127.0.0.1';
}

// Broadcast to WebSocket clients
function broadcast(msg) {
  const json = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json);
      } catch (e) {}
    }
  });
}

// WebSocket handling with CSWSH protection
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== req.headers.host && !['localhost', '127.0.0.1'].includes(originUrl.hostname)) {
        ws.close(1008, 'Cross-origin WebSocket blocked');
        return;
      }
    } catch (e) {
      ws.close(1008, 'Invalid Origin');
      return;
    }
  }

  ws.send(JSON.stringify({
    type: 'status',
    data: { ...mc.getStatus(), instanceName: activeInstance.name, localIp: getLocalIpAddress() }
  }));
  ws.send(JSON.stringify({ type: 'logs_history', data: mc.logs }));
  ws.send(JSON.stringify({ type: 'playit_status', data: playit.getStatus() }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'command') {
        mc.sendCommand(msg.command);
      }
    } catch (e) {
      console.error('WS error:', e.message);
    }
  });
});

// Periodic Telemetry (every 2 seconds)
let prevCpuTimes = null;
function getSystemCpuUsage() {
  const cpus = os.cpus();
  let totalUser = 0, totalNice = 0, totalSys = 0, totalIdle = 0, totalIrq = 0;
  for (const cpu of cpus) {
    totalUser += cpu.times.user;
    totalNice += cpu.times.nice;
    totalSys += cpu.times.sys;
    totalIdle += cpu.times.idle;
    totalIrq += cpu.times.irq;
  }
  const total = totalUser + totalNice + totalSys + totalIdle + totalIrq;
  const idle = totalIdle;

  if (!prevCpuTimes) {
    prevCpuTimes = { total, idle };
    return 0;
  }

  const diffTotal = total - prevCpuTimes.total;
  const diffIdle = idle - prevCpuTimes.idle;
  prevCpuTimes = { total, idle };

  return diffTotal > 0 ? Math.round(((diffTotal - diffIdle) / diffTotal) * 100) : 0;
}

let lastServerPing = { online: false };

setInterval(async () => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const sysCpu = getSystemCpuUsage();
    const procMetrics = await mc.getProcessMetrics();
    const drive = await storage.getDriveStats();

    if (mc.status === 'online' && activeInstance.type !== 'bedrock') {
      try {
        const pingPort = activeInstance.port || mc.config.port || 25565;
        lastServerPing = await pingMinecraft('127.0.0.1', pingPort, 1500);
      } catch (e) {
        lastServerPing = { online: false };
      }
    } else {
      lastServerPing = { online: false };
    }

    broadcast({
      type: 'telemetry',
      data: {
        server: { ...mc.getStatus(), instanceName: activeInstance.name, localIp: getLocalIpAddress() },
        serverPing: lastServerPing,
        playit: playit.getStatus(),
        system: {
          totalMemBytes: totalMem,
          usedMemBytes: usedMem,
          freeMemBytes: freeMem,
          memPercent: Math.round((usedMem / totalMem) * 100),
          cpuPercent: sysCpu
        },
        process: procMetrics,
        drive
      }
    });
  } catch (e) {}
}, 2000);

// Auto-save interval (every 10 minutes)
setInterval(() => {
  if (mc && mc.status === 'online') {
    try {
      mc.sendCommand('save-all');
      console.log('[CraftOrbit Auto-Save] Flushed world save to disk.');
    } catch (e) {}
  }
}, 10 * 60 * 1000);

// --- MULTI-INSTANCE UNIVERSAL API ---

app.get('/api/instances', (req, res) => {
  const instanceList = registry.instances.map(inst => {
    const exists = fs.existsSync(inst.path);
    const detected = exists ? MinecraftServer.detectServerType(inst.path) : { type: 'unknown', name: 'Path not found' };
    return {
      ...inst,
      exists,
      detectedEngine: detected.name,
      isActive: inst.id === activeInstance.id,
      isRunning: (inst.id === activeInstance.id) && mc.status !== 'offline'
    };
  });

  res.json({
    activeInstanceId: activeInstance.id,
    activeInstance,
    instances: instanceList
  });
});

app.post('/api/instances/detect', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'Folder path required' });

  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Directory does not exist on disk' });
  }

  const detected = MinecraftServer.detectServerType(resolved);
  const name = path.basename(resolved);

  // Read properties if present
  let port = detected.type === 'bedrock' ? 19132 : 25565;
  const propFile = path.join(resolved, 'server.properties');
  if (fs.existsSync(propFile)) {
    try {
      const match = fs.readFileSync(propFile, 'utf8').match(/server-port=(\d+)/);
      if (match) port = parseInt(match[1], 10);
    } catch (e) {}
  }

  res.json({
    path: resolved,
    suggestedName: name,
    type: detected.type,
    engineName: detected.name,
    jar: detected.jar || '',
    port
  });
});

app.post('/api/instances/switch', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Instance ID required' });

    if (id === activeInstance.id) {
      return res.json({ success: true, activeInstance });
    }

    if (mc.status !== 'offline') {
      return res.status(400).json({ error: 'Cannot switch servers while the current server is running. Stop it first.' });
    }

    const target = registry.instances.find(i => i.id === id);
    if (!target) return res.status(404).json({ error: 'Instance not found in registry' });
    if (!fs.existsSync(target.path)) return res.status(404).json({ error: `Server directory not found: ${target.path}` });

    activeInstance = target;
    registry.activeInstanceId = target.id;
    saveRegistry(registry);

    // Switch storage & mc server instance
    storage.setDirectory(activeInstance.path);
    mc.setInstance(activeInstance.path, activeInstance);

    // Switch playit tunnel configuration to this instance
    playit.setInstance(activeInstance.id, activeInstance.tunnel || null);

    console.log(`[CraftOrbit Universal] Switched active server to: "${activeInstance.name}" (${activeInstance.path})`);

    // Broadcast new state
    broadcast({ type: 'status', data: { ...mc.getStatus(), instanceName: activeInstance.name } });
    broadcast({ type: 'playit_status', data: playit.getStatus() });

    res.json({ success: true, activeInstance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/add', (req, res) => {
  try {
    const { name, path: folderPath, type, minRam, maxRam, javaPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Server folder path required' });

    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: `Folder does not exist: ${resolved}` });
    }

    const detected = MinecraftServer.detectServerType(resolved);
    const instanceId = 'inst-' + Date.now();
    const newInst = {
      id: instanceId,
      name: name || path.basename(resolved),
      path: resolved,
      type: type || detected.type,
      minRam: minRam || '2G',
      maxRam: maxRam || (detected.type === 'forge' ? '6G' : '4G'),
      javaPath: javaPath || (detected.type === 'bedrock' ? '' : mc.detectJava()),
      autoRestart: false
    };

    registry.instances.push(newInst);
    saveRegistry(registry);

    res.json({ success: true, instance: newInst });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/delete', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Instance ID required' });
    if (id === activeInstance.id) {
      return res.status(400).json({ error: 'Cannot delete the currently active instance. Switch to another server first.' });
    }

    registry.instances = registry.instances.filter(i => i.id !== id);
    saveRegistry(registry);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/instances/edit', (req, res) => {
  try {
    const { id, name, minRam, maxRam, javaPath, autoRestart, type } = req.body;
    const target = registry.instances.find(i => i.id === id);
    if (!target) return res.status(404).json({ error: 'Instance not found' });

    if (name) target.name = name;
    if (minRam) target.minRam = minRam;
    if (maxRam) target.maxRam = maxRam;
    if (javaPath !== undefined) target.javaPath = javaPath;
    if (autoRestart !== undefined) target.autoRestart = autoRestart;
    if (type) target.type = type;

    saveRegistry(registry);

    if (id === activeInstance.id) {
      activeInstance = target;
      mc.saveConfig(target);
    }

    res.json({ success: true, instance: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- AUTO-EGG WORLD PROVISIONING API ---

app.get('/api/provision/scan-worlds', (req, res) => {
  try {
    const worlds = WorldProvisioner.scanLocalWorlds();
    res.json({ worlds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/provision/popular-versions', (req, res) => {
  res.json({
    versions: [
      { version: '26.2', label: '26.2 / 1.26 (Latest 2026 - Java 25)' },
      { version: '26.1.2', label: '26.1.2 / 1.26 (Minecraft 26.1 - Java 25)' },
      { version: '1.21.4', label: '1.21.4 (Latest 1.21 - Java 21)' },
      { version: '1.21.1', label: '1.21.1 (Stable 1.21 - Java 21)' },
      { version: '1.20.4', label: '1.20.4 (Recommended Paper - Java 17)' },
      { version: '1.20.1', label: '1.20.1 (Best for Mods - Java 17)' },
      { version: '1.19.4', label: '1.19.4 (Java 17)' },
      { version: '1.19.2', label: '1.19.2 (Classic RPG Modpack - Java 17)' },
      { version: '1.18.2', label: '1.18.2 (Java 17)' },
      { version: '1.16.5', label: '1.16.5 (Legacy Java 8)' },
      { version: '1.12.2', label: '1.12.2 (Classic Forge - Java 8)' }
    ]
  });
});

app.post('/api/provision/inspect', async (req, res) => {
  try {
    const { worldPath } = req.body;
    if (!worldPath) return res.status(400).json({ error: 'World path required' });
    const info = await WorldProvisioner.inspectWorld(worldPath);
    res.json(info);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/provision/deploy', async (req, res) => {
  try {
    const { worldPath, serverName, egg, mcVersion, port, maxRam, minRam, enableGeyser, seed } = req.body;
    if (!egg || !mcVersion) {
      return res.status(400).json({ error: 'egg and mcVersion are required' });
    }

    // Auto-allocate port if not provided or taken
    let targetPort = port || 25565;
    const takenPorts = new Set(registry.instances.map(i => i.port || 25565));
    while (takenPorts.has(targetPort)) {
      targetPort++;
    }

    const newInstance = await WorldProvisioner.autoHostWorld({
      worldPath,
      serverName,
      egg,
      mcVersion,
      port: targetPort,
      maxRam: maxRam || '4G',
      minRam: minRam || '2G',
      enableGeyser: enableGeyser !== false,
      seed: seed || ''
    }, (progress) => {
      const data = typeof progress === 'string' ? { text: progress, percent: -1 } : progress;
      console.log(`[Provisioner] ${data.text}`);
      broadcast({ type: 'provision_progress', data });
    });

    // Register into instances
    registry.instances.push(newInstance);
    registry.activeInstanceId = newInstance.id;
    saveRegistry(registry);

    // Switch active instance
    activeInstance = newInstance;
    storage.setDirectory(activeInstance.path);
    mc.setInstance(activeInstance.path, activeInstance);

    broadcast({ type: 'status', data: { ...mc.getStatus(), instanceName: activeInstance.name } });

    res.json({ success: true, instance: newInstance });
  } catch (e) {
    console.error('Provision deploy failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- GEYSER CROSS-PLAY API ---
app.get('/api/plugins/geyser-status', (req, res) => {
  const pluginsDir = path.join(activeInstance.path, 'plugins');
  const modsDir = path.join(activeInstance.path, 'mods');
  const hasGeyser = fs.existsSync(path.join(pluginsDir, 'Geyser-Spigot.jar')) ||
                    fs.existsSync(path.join(pluginsDir, 'geyser-spigot.jar')) ||
                    fs.existsSync(path.join(modsDir, 'Geyser-Fabric.jar'));
  const hasFloodgate = fs.existsSync(path.join(pluginsDir, 'floodgate-spigot.jar')) ||
                       fs.existsSync(path.join(pluginsDir, 'Floodgate-Spigot.jar'));
  res.json({
    installed: hasGeyser,
    hasFloodgate,
    isCompatible: activeInstance.type === 'paper' || activeInstance.type === 'purpur' || activeInstance.type === 'spigot' || activeInstance.type === 'fabric'
  });
});

app.post('/api/plugins/install-geyser', async (req, res) => {
  try {
    const result = await WorldProvisioner.installGeyser(activeInstance.path, (l) => console.log(`[Geyser] ${l}`));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PLAYIT.GG GLOBAL HOSTING API ---

app.get('/api/playit/status', (req, res) => {
  res.json({
    ...playit.getStatus(),
    logs: playit.logs.slice(-30)
  });
});

app.post('/api/playit/start', async (req, res) => {
  try {
    const result = await playit.start();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/playit/stop', (req, res) => {
  try {
    const result = playit.stop();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/playit/reset', async (req, res) => {
  try {
    const result = await playit.reset();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/playit/address', (req, res) => {
  try {
    const { address, javaAddress, bedrockAddress, bedrockPort, instanceId } = req.body;
    const target = (instanceId ? registry.instances.find(i => i.id === instanceId) : null) || activeInstance;

    target.tunnel = {
      javaAddress: (javaAddress !== undefined ? javaAddress : address) || '',
      bedrockAddress: bedrockAddress || '',
      bedrockPort: String(bedrockPort || '19132').trim()
    };

    saveRegistry(registry);
    playit.setAddresses(target.tunnel, target.id);

    res.json({
      success: true,
      instanceId: target.id,
      instanceName: target.name,
      ...target.tunnel,
      publicAddress: target.tunnel.javaAddress
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- SERVER PROCESS CONTROL ---

app.get('/api/status', async (req, res) => {
  const status = mc.getStatus();
  const processMetrics = await mc.getProcessMetrics();
  res.json({ ...status, instanceName: activeInstance.name, localIp: getLocalIpAddress(), processMetrics });
});

app.post('/api/server/start', (req, res) => {
  try {
    if (!activeInstance || activeInstance.id === 'none' || !activeInstance.path) {
      return res.status(400).json({ error: 'No server selected. Click "Host World" or "Add Server" to configure one first!' });
    }
    const result = mc.start();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/server/stop', (req, res) => {
  try {
    const result = mc.stop();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/server/restart', (req, res) => {
  try {
    const result = mc.restart();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/server/kill', (req, res) => {
  try {
    const result = mc.kill();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/system/shutdown', async (req, res) => {
  try {
    console.log('[CraftOrbit] Received shutdown request from web interface...');
    res.json({ success: true, message: 'Web dashboard and servers are shutting down cleanly.' });

    // 1. Gracefully stop Minecraft server if running
    if (mc && mc.status !== 'offline') {
      try {
        mc.stop();
      } catch (e) {}
    }

    // 2. Stop playit tunnel if running
    if (playit) {
      try {
        playit.stop();
      } catch (e) {}
    }

    // 3. Gracefully close server and exit process
    setTimeout(() => {
      console.log('[CraftOrbit] Exiting process cleanly.');
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 2000);
    }, 1500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/server/command', (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });
    const result = mc.sendCommand(command);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/server/quick-action', (req, res) => {
  try {
    const { action } = req.body;
    let cmd = '';
    switch (action) {
      case 'day': cmd = 'time set day'; break;
      case 'night': cmd = 'time set night'; break;
      case 'weather_clear': cmd = 'weather clear'; break;
      case 'weather_rain': cmd = 'weather rain'; break;
      case 'clearlag': cmd = 'kill @e[type=item]'; break;
      case 'save': cmd = 'save-all flush'; break;
      case 'difficulty_peaceful': cmd = 'difficulty peaceful'; break;
      case 'difficulty_easy': cmd = 'difficulty easy'; break;
      case 'difficulty_normal': cmd = 'difficulty normal'; break;
      case 'difficulty_hard': cmd = 'difficulty hard'; break;
      default: return res.status(400).json({ error: 'Unknown quick action' });
    }
    const result = mc.sendCommand(cmd);
    res.json({ success: true, command: cmd, result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/mods/upload', express.raw({ type: '*/*', limit: '120mb' }), async (req, res) => {
  try {
    const fileName = req.query.name;
    if (!fileName || !fileName.endsWith('.jar')) {
      return res.status(400).json({ error: 'Only .jar mod files are supported' });
    }
    const cleanFileName = path.basename(fileName);
    let targetFolder = path.join(activeInstance.path, 'mods');
    if (!fs.existsSync(targetFolder) && fs.existsSync(path.join(activeInstance.path, 'plugins'))) {
      targetFolder = path.join(activeInstance.path, 'plugins');
    }
    if (!fs.existsSync(targetFolder)) {
      await fs.promises.mkdir(targetFolder, { recursive: true });
    }
    const destPath = path.join(targetFolder, cleanFileName);
    await fs.promises.writeFile(destPath, req.body);
    res.json({ success: true, fileName: cleanFileName, size: req.body.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/modpack/import-zip', async (req, res) => {
  try {
    const { zipPath } = req.body;
    if (!zipPath) return res.status(400).json({ error: 'Zip file path required' });
    const resolvedZip = path.resolve(zipPath);
    if (!fs.existsSync(resolvedZip)) {
      return res.status(404).json({ error: `Modpack zip not found: ${resolvedZip}` });
    }
    const result = await WorldProvisioner.extractModpackZip(resolvedZip, activeInstance.path, (l) => console.log(`[Modpack] ${l}`));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- MODRINTH MOD STORE & INSTALLER API ---
app.get('/api/modrinth/search', async (req, res) => {
  try {
    const query = req.query.query || '';
    const mcVersion = req.query.version || '';
    const loader = req.query.loader || '';
    const projectType = req.query.type || 'mod'; // 'mod' or 'modpack'
    const limit = parseInt(req.query.limit, 10) || 12;

    const facets = [[`project_type:${projectType}`]];
    if (mcVersion && mcVersion !== 'any') {
      facets.push([`versions:${mcVersion}`]);
    }
    if (loader && loader !== 'vanilla' && loader !== 'none') {
      const cleanLoader = loader === 'neoforge' ? 'neoforge' : (loader === 'paper' || loader === 'purpur' ? 'spigot' : loader);
      facets.push([`categories:${cleanLoader}`]);
    }

    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=${limit}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    const mRes = await fetch(url, {
      headers: { 'User-Agent': 'CraftOrbit-Manager/1.0 (contact@craftcontrol.local)' }
    });
    if (!mRes.ok) throw new Error(`Modrinth returned HTTP ${mRes.status}`);

    const data = await mRes.json();
    const hits = (data.hits || []).map(h => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      categories: h.categories,
      author: h.author,
      iconUrl: h.icon_url,
      downloads: h.downloads,
      follows: h.follows,
      projectType: h.project_type
    }));

    res.json({ hits, totalHits: data.total_hits });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/modrinth/install', async (req, res) => {
  try {
    const { projectId, version: reqVersion, loader: reqLoader } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const targetMcVersion = reqVersion || mc.detectMinecraftVersion();
    const targetLoader = reqLoader || activeInstance.type;

    // Fetch version files from Modrinth
    const url = `https://api.modrinth.com/v2/project/${projectId}/version`;
    const vRes = await fetch(url, {
      headers: { 'User-Agent': 'CraftOrbit-Manager/1.0 (contact@craftcontrol.local)' }
    });
    if (!vRes.ok) throw new Error(`Failed to fetch versions for mod ${projectId}`);

    const versions = await vRes.json();
    if (!versions || versions.length === 0) throw new Error('No versions available for this mod');

    // Find best matching version
    let match = versions.find(v => {
      const matchVer = v.game_versions.includes(targetMcVersion);
      const matchLoader = targetLoader === 'none' || v.loaders.includes(targetLoader) || v.loaders.includes('forge') || v.loaders.includes('fabric');
      return matchVer && matchLoader;
    });

    if (!match) {
      match = versions.find(v => v.game_versions.includes(targetMcVersion)) || versions[0];
    }

    const primaryFile = match.files?.find(f => f.primary) || match.files?.[0];
    if (!primaryFile || !primaryFile.url) {
      throw new Error('No downloadable jar file found for this mod version');
    }

    // Target directory (mods or plugins)
    let targetFolder = path.join(activeInstance.path, 'mods');
    if (!fs.existsSync(targetFolder) && fs.existsSync(path.join(activeInstance.path, 'plugins'))) {
      targetFolder = path.join(activeInstance.path, 'plugins');
    }
    if (!fs.existsSync(targetFolder)) {
      await fs.promises.mkdir(targetFolder, { recursive: true });
    }

    const destPath = path.join(targetFolder, primaryFile.filename);
    const downloadRes = await fetch(primaryFile.url);
    if (!downloadRes.ok) throw new Error(`Download failed with HTTP ${downloadRes.status}`);

    const buf = await downloadRes.arrayBuffer();
    await fs.promises.writeFile(destPath, Buffer.from(buf));

    res.json({
      success: true,
      fileName: primaryFile.filename,
      size: buf.byteLength,
      versionNumber: match.version_number
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/server/logs', (req, res) => {
  res.json(mc.logs);
});

// --- STORAGE MANAGEMENT API ---

app.get('/api/storage/overview', async (req, res) => {
  try {
    const data = await storage.getStorageOverview();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/storage/clean-logs', async (req, res) => {
  try {
    const result = await storage.cleanOldLogs();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/storage/clean-cache', async (req, res) => {
  try {
    const result = await storage.cleanCaches();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/storage/delete-file', async (req, res) => {
  try {
    const { relativePath } = req.body;
    if (!relativePath) return res.status(400).json({ error: 'Path required' });
    const result = await storage.deleteFile(relativePath);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/storage/backup', async (req, res) => {
  try {
    if (mc.status === 'online') {
      mc.sendCommand('save-all flush');
    }
    const result = await storage.createWorldBackup();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/storage/backups', async (req, res) => {
  try {
    const backups = await storage.listBackups();
    res.json(backups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/storage/download-backup/:name', (req, res) => {
  const fileName = path.basename(req.params.name);
  if (!fileName || fileName.startsWith('.')) {
    return res.status(403).json({ error: 'Invalid file name' });
  }
  const filePath = path.join(activeInstance.path, 'backups', fileName);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Backup not found' });
  }
});

app.post('/api/storage/restore', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'File name required' });
    if (mc.status !== 'offline') {
      return res.status(400).json({ error: 'Please stop the Minecraft server before restoring a backup!' });
    }
    const result = await storage.restoreBackup(fileName);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SERVER PING QUERY API ---
app.get('/api/server/ping', async (req, res) => {
  try {
    const port = activeInstance.port || mc.config.port || 25565;
    const result = await pingMinecraft('127.0.0.1', port, 2000);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, online: false });
  }
});

// --- 9ROUTER AI ASSISTANT API ---
const NINEROUTER_URL = process.env.NINEROUTER_URL || 'http://localhost:20128';
const NINEROUTER_KEY = process.env.NINEROUTER_KEY || '';
const NINEROUTER_MODEL = process.env.NINEROUTER_MODEL || 'ag/gemini-3.8-flash-low';

async function call9RouterAI(messages) {
  const headers = { 'Content-Type': 'application/json' };
  if (NINEROUTER_KEY) {
    headers['Authorization'] = `Bearer ${NINEROUTER_KEY}`;
  }
  const response = await fetch(`${NINEROUTER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: NINEROUTER_MODEL,
      messages,
      stream: false
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`9Router error ${response.status}: ${errText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response from AI';
}

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const serverStatus = mc.getStatus();
    const systemPrompt = `You are the CraftOrbit Universal AI Copilot, an expert Minecraft server administrator.
Current Server Profile:
- Name: "${activeInstance.name}"
- Engine: ${serverStatus.detectedEngine} (${serverStatus.engineType})
- Status: ${serverStatus.status}
- Online Players: ${serverStatus.players.join(', ') || 'None'}
- Memory Allocation: -Xms${mc.config.minRam} -Xmx${mc.config.maxRam}
- Server Folder: ${activeInstance.path}

Provide direct, actionable advice tailored to this specific Minecraft engine. Format commands in backticks (e.g. \`/save-all\`).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6),
      { role: 'user', content: message }
    ];

    const reply = await call9RouterAI(messages);
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/diagnose', async (req, res) => {
  try {
    const errorLogs = mc.logs
      .filter(l => l.text.includes('ERROR') || l.text.includes('Exception') || l.text.includes('WARN'))
      .slice(-40)
      .map(l => l.text)
      .join('\n');

    let crashContent = '';
    const crashDir = path.join(activeInstance.path, 'crash-reports');
    if (fs.existsSync(crashDir)) {
      try {
        const crashFiles = await fs.promises.readdir(crashDir);
        if (crashFiles.length > 0) {
          crashFiles.sort();
          const latestCrash = path.join(crashDir, crashFiles[crashFiles.length - 1]);
          const content = await fs.promises.readFile(latestCrash, 'utf8');
          crashContent = `Latest Crash Report (${crashFiles[crashFiles.length - 1]}):\n` + content.slice(0, 3000);
        }
      } catch (e) {}
    }

    if (!errorLogs && !crashContent) {
      return res.json({
        diagnosis: `No errors or crash reports detected for "${activeInstance.name}". Logs look clean and healthy!`
      });
    }

    const prompt = `Diagnose this Minecraft ${activeInstance.type} server issue on "${activeInstance.name}":
${crashContent ? crashContent + '\n\n' : ''}Recent Log Errors:
${errorLogs}

Provide root cause, player impact, exact fix steps, and recommended console commands.`;

    const messages = [
      { role: 'system', content: 'You are an expert Minecraft server crash diagnostician.' },
      { role: 'user', content: prompt }
    ];

    const diagnosis = await call9RouterAI(messages);
    res.json({ diagnosis, rawErrorCount: mc.logs.filter(l => l.text.includes('ERROR')).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- MODS / PLUGINS / ADDONS API ---
app.get('/api/mods', async (req, res) => {
  try {
    let folder = path.join(activeInstance.path, 'mods');
    let isPlugin = false;
    if (!fs.existsSync(folder) && fs.existsSync(path.join(activeInstance.path, 'plugins'))) {
      folder = path.join(activeInstance.path, 'plugins');
      isPlugin = true;
    }

    if (!fs.existsSync(folder)) {
      return res.json({ mods: [], totalCount: 0, totalBytes: 0, folderType: 'none' });
    }

    const files = await fs.promises.readdir(folder, { withFileTypes: true });
    const mods = [];
    let totalBytes = 0;

    for (const f of files) {
      if (f.isFile() && (f.name.endsWith('.jar') || f.name.endsWith('.jar.disabled'))) {
        const full = path.join(folder, f.name);
        try {
          const stat = await fs.promises.stat(full);
          const isEnabled = f.name.endsWith('.jar');
          const cleanName = f.name.replace(/\.jar(\.disabled)?$/, '');
          totalBytes += stat.size;
          mods.push({
            fileName: f.name,
            name: cleanName,
            enabled: isEnabled,
            size: stat.size,
            mtime: stat.mtime
          });
        } catch (e) {}
      }
    }

    mods.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      mods,
      totalCount: mods.length,
      enabledCount: mods.filter(m => m.enabled).length,
      disabledCount: mods.filter(m => !m.enabled).length,
      totalBytes,
      folderType: isPlugin ? 'plugins' : 'mods'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mods/toggle', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'File name required' });

    let folder = path.join(activeInstance.path, 'mods');
    if (!fs.existsSync(folder) && fs.existsSync(path.join(activeInstance.path, 'plugins'))) {
      folder = path.join(activeInstance.path, 'plugins');
    }

    const oldPath = path.join(folder, fileName);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Mod file not found' });

    let newFileName = '';
    if (fileName.endsWith('.jar')) {
      newFileName = fileName + '.disabled';
    } else if (fileName.endsWith('.jar.disabled')) {
      newFileName = fileName.replace(/\.disabled$/, '');
    } else {
      return res.status(400).json({ error: 'Invalid mod extension' });
    }

    const newPath = path.join(folder, newFileName);
    await fs.promises.rename(oldPath, newPath);

    res.json({ success: true, oldName: fileName, newName: newFileName, enabled: newFileName.endsWith('.jar') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PLAYER ROSTER & MANAGEMENT API ---
app.get('/api/players/data', (req, res) => {
  try {
    const readJsonSafe = (file) => {
      const p = path.join(activeInstance.path, file);
      if (fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; }
      }
      return [];
    };

    const usercache = readJsonSafe('usercache.json');
    const ops = readJsonSafe('ops.json');
    const whitelist = readJsonSafe('whitelist.json');
    const allowlist = readJsonSafe('allowlist.json'); // Bedrock
    const permissions = readJsonSafe('permissions.json'); // Bedrock
    const banned = readJsonSafe('banned-players.json');
    const online = mc.players || [];

    const opMap = new Set(ops.map(o => (o.name || '').toLowerCase()));
    for (const p of permissions) {
      if (p.permission === 'operator' && p.xuid) opMap.add((p.name || p.xuid).toLowerCase());
    }

    const wlMap = new Set(whitelist.map(w => (w.name || '').toLowerCase()));
    for (const a of allowlist) {
      if (a.name) wlMap.add(a.name.toLowerCase());
    }

    const banMap = new Set(banned.map(b => (b.name || '').toLowerCase()));
    const onlineMap = new Set(online.map(p => p.toLowerCase()));

    const allNames = new Map();
    for (const u of usercache) {
      if (u.name) allNames.set(u.name.toLowerCase(), { name: u.name, uuid: u.uuid });
    }
    for (const a of allowlist) {
      if (a.name && !allNames.has(a.name.toLowerCase())) allNames.set(a.name.toLowerCase(), { name: a.name, uuid: a.xuid });
    }
    for (const name of online) {
      if (!allNames.has(name.toLowerCase())) allNames.set(name.toLowerCase(), { name, uuid: '' });
    }
    for (const o of ops) {
      if (o.name && !allNames.has(o.name.toLowerCase())) allNames.set(o.name.toLowerCase(), { name: o.name, uuid: o.uuid });
    }

    const playerList = Array.from(allNames.values()).map(p => {
      const lower = p.name.toLowerCase();
      return {
        name: p.name,
        uuid: p.uuid,
        isOnline: onlineMap.has(lower),
        isOp: opMap.has(lower),
        isWhitelisted: wlMap.has(lower),
        isBanned: banMap.has(lower)
      };
    });

    playerList.sort((a, b) => {
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      players: playerList,
      onlineCount: online.length,
      opsCount: opMap.size,
      whitelistCount: wlMap.size,
      bannedCount: banMap.size
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/players/action', (req, res) => {
  try {
    const { action, player, reason } = req.body;
    if (!action) return res.status(400).json({ error: 'Action required' });

    if (action !== 'broadcast') {
      if (!player || !/^[a-zA-Z0-9_]{1,16}$/.test(player)) {
        return res.status(400).json({ error: 'Invalid player name: must be alphanumeric (1-16 chars)' });
      }
    }

    let cmd = '';
    switch (action) {
      case 'op': cmd = `op ${player}`; break;
      case 'deop': cmd = `deop ${player}`; break;
      case 'kick': cmd = `kick ${player} ${String(reason || 'Kicked by administrator').replace(/[\r\n]/g, ' ')}`; break;
      case 'ban': cmd = `ban ${player} ${String(reason || 'Banned by administrator').replace(/[\r\n]/g, ' ')}`; break;
      case 'pardon': cmd = `pardon ${player}`; break;
      case 'whitelist_add': cmd = `whitelist add ${player}`; break;
      case 'whitelist_remove': cmd = `whitelist remove ${player}`; break;
      case 'give_diamonds': cmd = `give ${player} diamond 64`; break;
      case 'give_netherite': cmd = `give ${player} netherite_ingot 16`; break;
      case 'give_xp': cmd = `experience add ${player} 30 levels`; break;
      case 'heal': cmd = `effect give ${player} instant_health 1 255 true`; break;
      case 'feed': cmd = `effect give ${player} saturation 10 255 true`; break;
      case 'clear_effects': cmd = `effect clear ${player}`; break;
      case 'gm_creative': cmd = `gamemode creative ${player}`; break;
      case 'gm_survival': cmd = `gamemode survival ${player}`; break;
      case 'gm_spectator': cmd = `gamemode spectator ${player}`; break;
      case 'tp_spawn': cmd = `teleport ${player} 0 100 0`; break;
      case 'broadcast': {
        const cleanMsg = String(reason || '').replace(/["\\]/g, '').replace(/[\r\n]/g, ' ');
        cmd = `tellraw @a {"text":"[Server Admin] ${cleanMsg}","color":"gold"}`;
        break;
      }
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    mc.sendCommand(cmd);
    res.json({ success: true, command: cmd });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- CONFIG & SETTINGS API ---

app.get('/api/config', (req, res) => {
  const props = mc.getServerProperties();
  res.json({
    launch: mc.config,
    properties: props,
    serverDir: activeInstance.path,
    instance: activeInstance
  });
});

app.post('/api/config/launch', (req, res) => {
  try {
    mc.saveConfig(req.body);
    // Also save to instance in registry
    Object.assign(activeInstance, req.body);
    saveRegistry(registry);
    res.json({ success: true, config: mc.config });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/config/properties', (req, res) => {
  try {
    const updated = mc.saveServerProperties(req.body);
    res.json({ success: true, properties: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- FILE BROWSER API ---

app.get('/api/files', async (req, res) => {
  try {
    const relPath = req.query.path || '';
    if (relPath && !isSafeSubpath(activeInstance.path, relPath)) {
      return res.status(403).json({ error: 'Access denied: path traversal blocked' });
    }
    const safePath = path.resolve(activeInstance.path, relPath);

    const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
    const items = [];

    for (const ent of entries) {
      const full = path.join(safePath, ent.name);
      try {
        const stat = await fs.promises.stat(full);
        items.push({
          name: ent.name,
          isDirectory: ent.isDirectory(),
          size: ent.isDirectory() ? 0 : stat.size,
          mtime: stat.mtime
        });
      } catch (e) {}
    }

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      currentPath: relPath.replace(/\\/g, '/'),
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/file-content', async (req, res) => {
  try {
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    if (!isSafeSubpath(activeInstance.path, relPath)) {
      return res.status(403).json({ error: 'Access denied: path traversal blocked' });
    }
    const safePath = path.resolve(activeInstance.path, relPath);

    const stat = await fs.promises.stat(safePath);
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds 2MB limit' });
    }

    const content = await fs.promises.readFile(safePath, 'utf8');
    res.json({ path: relPath, content, size: stat.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/file-content', async (req, res) => {
  try {
    const { path: relPath, content } = req.body;
    if (!relPath || content === undefined) {
      return res.status(400).json({ error: 'Path and content required' });
    }
    if (!isSafeSubpath(activeInstance.path, relPath)) {
      return res.status(403).json({ error: 'Access denied: path traversal blocked' });
    }
    const safePath = path.resolve(activeInstance.path, relPath);

    await fs.promises.writeFile(safePath, content, 'utf8');
    res.json({ success: true, path: relPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎮 CraftOrbit Universal Server Manager is Online!`);
  console.log(`🌐 Localhost URL: http://localhost:${PORT}`);
  console.log(`📂 Active Server: [${activeInstance.name}]`);
  console.log(`📁 Directory: ${activeInstance.path}`);
  console.log(`=======================================================`);

  // Launch Standalone Desktop App Window (Non-browser experience)
  DesktopWindow.launch(PORT, async () => {
    console.log('[CraftOrbit] GUI closed by user. Cleaning up...');
    try {
      if (mc && mc.status === 'online') {
        await mc.stop();
      }
      if (playit) {
        playit.stop();
      }
    } catch (e) {}
    process.exit(0);
  });
});
