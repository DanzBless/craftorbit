const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const execPromise = util.promisify(exec);

class PlayitManager {
  constructor(options = {}, onLog = () => {}, onStatusChange = () => {}) {
    this.options = options;
    this.onLog = onLog;
    this.onStatusChange = onStatusChange;
    this.process = null;
    this.status = 'offline'; // 'offline' | 'starting' | 'claiming' | 'running'
    this.claimUrl = null;
    this.tunnelsCount = 0;
    this.logs = [];
    this.maxLogs = 200;
    this.activeInstanceId = this.options.activeInstanceId || 'default';
    this.tunnelsByInstance = {};
    this.publicAddress = '';
    this.javaAddress = '';
    this.bedrockAddress = '';
    this.bedrockPort = '19132';
    const appRoot = (process.execPath && !process.execPath.endsWith('node.exe') && !process.execPath.endsWith('node'))
      ? path.dirname(process.execPath)
      : __dirname;
    this.appRoot = appRoot;
    this.configPath = path.join(appRoot, 'playit-config.json');

    this.loadSavedConfig();
  }

  loadSavedConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        if (data.tunnelsByInstance) {
          this.tunnelsByInstance = data.tunnelsByInstance;
        } else if (data.javaAddress || data.publicAddress) {
          this.tunnelsByInstance['default'] = {
            javaAddress: data.javaAddress || data.publicAddress || '',
            bedrockAddress: data.bedrockAddress || '',
            bedrockPort: data.bedrockPort || '19132'
          };
        }
      } catch (e) {}
    }
    this.applyActiveInstanceTunnel();
  }

  setInstance(instanceId, instanceTunnel = null) {
    this.activeInstanceId = instanceId || 'default';
    if (instanceTunnel) {
      this.tunnelsByInstance[this.activeInstanceId] = {
        javaAddress: instanceTunnel.javaAddress || '',
        bedrockAddress: instanceTunnel.bedrockAddress || '',
        bedrockPort: instanceTunnel.bedrockPort || '19132'
      };
      this.saveConfig();
    }
    this.applyActiveInstanceTunnel();
    this.onStatusChange(this.getStatus());
  }

  applyActiveInstanceTunnel() {
    const active = this.tunnelsByInstance[this.activeInstanceId] || {
      javaAddress: '',
      bedrockAddress: '',
      bedrockPort: '19132'
    };
    this.javaAddress = active.javaAddress || '';
    this.publicAddress = this.javaAddress;
    this.bedrockAddress = active.bedrockAddress || '';
    this.bedrockPort = active.bedrockPort || '19132';
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        tunnelsByInstance: this.tunnelsByInstance
      }, null, 2), 'utf8');
    } catch (e) {}
  }

  setAddresses({ javaAddress, bedrockAddress, bedrockPort, address }, instanceId) {
    const targetId = instanceId || this.activeInstanceId || 'default';
    const current = this.tunnelsByInstance[targetId] || { javaAddress: '', bedrockAddress: '', bedrockPort: '19132' };

    if (address !== undefined) {
      current.javaAddress = (address || '').trim();
    }
    if (javaAddress !== undefined) {
      current.javaAddress = (javaAddress || '').trim();
    }
    if (bedrockAddress !== undefined) {
      current.bedrockAddress = (bedrockAddress || '').trim();
    }
    if (bedrockPort !== undefined) {
      current.bedrockPort = String(bedrockPort || '19132').trim();
    }

    this.tunnelsByInstance[targetId] = current;
    this.saveConfig();

    if (targetId === this.activeInstanceId) {
      this.applyActiveInstanceTunnel();
      this.onStatusChange(this.getStatus());
    }
  }

  setPublicAddress(addr) {
    this.setAddresses({ javaAddress: addr }, this.activeInstanceId);
  }

  async findExecutable() {
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'playit.exe' : 'playit';

    // 1. Check local tools folder
    const localExe = path.join(this.appRoot, 'tools', binaryName);
    if (fs.existsSync(localExe)) return localExe;

    // 2. Check standard installation path
    if (isWindows) {
      const installedExe = 'C:\\Program Files\\playit_gg\\bin\\playit.exe';
      if (fs.existsSync(installedExe)) return installedExe;
    } else {
      const linuxPaths = ['/usr/local/bin/playit', '/usr/bin/playit', '/opt/playit/playit'];
      for (const p of linuxPaths) {
        if (fs.existsSync(p)) return p;
      }
    }

    // 3. Check system PATH
    try {
      const checkCmd = isWindows ? 'where playit.exe' : 'which playit';
      const { stdout } = await execPromise(checkCmd);
      if (stdout && stdout.trim()) {
        const first = stdout.trim().split(/\r?\n/)[0];
        if (fs.existsSync(first)) return first;
      }
    } catch (e) {}

    // 4. Download playit binary automatically if missing
    return await this.downloadPlayitBinary();
  }

  async downloadPlayitBinary() {
    const isWindows = process.platform === 'win32';
    const isArm = process.arch === 'arm64';
    const binaryName = isWindows ? 'playit.exe' : 'playit';
    const toolsDir = path.join(this.appRoot, 'tools');

    if (!fs.existsSync(toolsDir)) {
      await fs.promises.mkdir(toolsDir, { recursive: true });
    }
    const exePath = path.join(toolsDir, binaryName);
    if (fs.existsSync(exePath)) return exePath;

    let downloadUrl = '';
    if (isWindows) {
      downloadUrl = 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-windows-x86_64.exe';
    } else if (isArm) {
      downloadUrl = 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-linux-aarch64';
    } else {
      downloadUrl = 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-linux-x86_64';
    }

    this.appendLog(`[playit.gg] Downloading official playit agent (${isWindows ? 'Windows' : 'Linux'}) from GitHub...`);

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download playit binary: HTTP ${res.status}`);
    }

    const buf = await res.arrayBuffer();
    await fs.promises.writeFile(exePath, Buffer.from(buf));

    // Ensure executable permissions on Linux/macOS
    if (!isWindows) {
      try {
        await fs.promises.chmod(exePath, 0o755);
      } catch (e) {}
    }

    this.appendLog(`[playit.gg] Download complete: ${binaryName} is ready.`);
    return exePath;
  }

  setStatus(s) {
    if (this.status !== s) {
      this.status = s;
      this.onStatusChange(this.getStatus());
    }
  }

  appendLog(line) {
    const clean = line.replace(/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
    if (!clean) return;

    this.logs.push({
      time: new Date().toISOString(),
      text: clean
    });
    if (this.logs.length > this.maxLogs) this.logs.shift();

    this.onLog(clean);
    this.parseLogLine(clean);
  }

  parseLogLine(line) {
    // Detect claim URL
    const claimMatch = line.match(/(https:\/\/playit\.gg\/claim\/[a-zA-Z0-9]+)/);
    if (claimMatch) {
      this.claimUrl = claimMatch[1];
      this.setStatus('claiming');
    }

    // Detect valid secret & tunnels count
    const tunnelMatch = line.match(/secret key valid, agent has (\d+) tunnel/);
    if (tunnelMatch) {
      this.tunnelsCount = parseInt(tunnelMatch[1], 10) || 0;
      this.claimUrl = null;
      this.setStatus('running');
    }

    if (line.includes('got initial pong from tunnel server') || line.includes('starting up tunnel connection')) {
      if (this.status !== 'claiming') {
        this.setStatus('running');
      }
    }
  }

  async start() {
    if (this.status === 'running' || this.status === 'claiming') {
      return { success: true, message: 'Tunnel is already running', status: this.status };
    }

    this.setStatus('starting');
    const exe = await this.findExecutable();
    this.appendLog(`[playit.gg] Starting agent binary: ${exe}`);

    try {
      this.process = spawn(exe, ['--stdout', 'start'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      });

      this.process.stdout.on('data', (d) => {
        const lines = d.toString('utf8').split(/\r?\n/);
        for (const line of lines) this.appendLog(line);
      });

      this.process.stderr.on('data', (d) => {
        const lines = d.toString('utf8').split(/\r?\n/);
        for (const line of lines) this.appendLog(line);
      });

      this.process.on('close', (code) => {
        this.appendLog(`[playit.gg] Agent stopped with code ${code}`);
        this.setStatus('offline');
        this.process = null;
      });

      this.process.on('error', (err) => {
        this.appendLog(`[playit.gg ERROR] ${err.message}`);
        this.setStatus('offline');
        this.process = null;
      });

      return { success: true, status: this.status, claimUrl: this.claimUrl };
    } catch (e) {
      this.setStatus('offline');
      throw e;
    }
  }

  stop() {
    if (this.process) {
      this.appendLog('[playit.gg] Stopping tunnel process...');
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.setStatus('offline');
    return { success: true };
  }

  async reset() {
    this.appendLog('[playit.gg] Resetting agent secret key to generate new claim link...');
    this.stop();

    try {
      const exe = await this.findExecutable();
      await execPromise(`"${exe}" reset`);
    } catch (e) {
      // Also delete known playit.toml path if present
      const systemToml = path.join(os.homedir(), 'AppData', 'Local', 'playit_gg', 'playit.toml');
      if (fs.existsSync(systemToml)) {
        try { fs.unlinkSync(systemToml); } catch (err) {}
      }
    }

    this.claimUrl = null;
    this.tunnelsCount = 0;
    return this.start();
  }

  getStatus() {
    return {
      status: this.status, // 'offline' | 'starting' | 'claiming' | 'running'
      claimUrl: this.claimUrl,
      tunnelsCount: this.tunnelsCount,
      publicAddress: this.javaAddress || this.publicAddress,
      javaAddress: this.javaAddress || this.publicAddress,
      bedrockAddress: this.bedrockAddress,
      bedrockPort: this.bedrockPort,
      running: this.status === 'running' || this.status === 'claiming'
    };
  }
}

module.exports = PlayitManager;
