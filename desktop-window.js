const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');

class DesktopWindow {
  static findChromiumBinary() {
    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe')
      ];

      for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
      }

      // Check EdgeCore folder if Edge was updated
      const edgeCoreDir = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
      if (fs.existsSync(edgeCoreDir)) {
        try {
          const versions = fs.readdirSync(edgeCoreDir);
          for (const v of versions) {
            const edgeExe = path.join(edgeCoreDir, v, 'msedge.exe');
            if (fs.existsSync(edgeExe)) return edgeExe;
          }
        } catch (e) {}
      }
    } else if (process.platform === 'linux') {
      const linuxCandidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/usr/bin/brave-browser'
      ];
      for (const p of linuxCandidates) {
        if (fs.existsSync(p)) return p;
      }
    }

    return null;
  }

  static launch(port, onCloseCallback = () => {}) {
    // Check if headless or no-gui is requested
    const isHeadless = process.argv.includes('--no-gui') || 
                       process.argv.includes('--headless') || 
                       process.env.HEADLESS === 'true' ||
                       (!process.env.DISPLAY && process.platform !== 'win32');

    if (isHeadless) {
      console.log(`[CraftOrbit GUI] Running in headless mode (no GUI window requested).`);
      return null;
    }

    const binary = this.findChromiumBinary();
    const url = `http://localhost:${port}`;

    if (binary) {
      const userProfileDir = path.join(os.tmpdir(), 'craftorbit-desktop-profile');
      const args = [
        `--app=${url}`,
        `--user-data-dir=${userProfileDir}`,
        '--window-size=1440,900',
        '--window-position=center',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-component-update',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync'
      ];

      console.log(`[CraftOrbit GUI] Launching standalone desktop window using: ${binary}`);
      const gui = spawn(binary, args, {
        detached: false,
        stdio: 'ignore'
      });

      gui.on('exit', (code) => {
        console.log(`[CraftOrbit GUI] Desktop window closed (code: ${code}). Shutting down...`);
        onCloseCallback();
      });

      gui.on('error', (err) => {
        console.error(`[CraftOrbit GUI] Failed to launch window process: ${err.message}`);
        this.openDefaultBrowser(url);
      });

      return gui;
    } else {
      console.log(`[CraftOrbit GUI] No standalone Chromium engine found. Falling back to default browser...`);
      this.openDefaultBrowser(url);
      return null;
    }
  }

  static openDefaultBrowser(url) {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  }
}

module.exports = DesktopWindow;
