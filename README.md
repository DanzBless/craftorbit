# 🪐 CraftOrbit — Universal Minecraft Server Manager & Global Host

[![GitHub Release](https://img.shields.io/github/v/release/DanzBless/craftorbit?color=white&label=Release&style=flat-square)](https://github.com/DanzBless/craftorbit/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg?style=flat-square)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-white.svg?style=flat-square)](https://github.com/DanzBless/craftorbit)
[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-white.svg?style=flat-square)](https://nodejs.org)
[![Cross-Play: Java %2B Bedrock](https://img.shields.io/badge/Cross--Play-Java%20%2B%20Bedrock-white.svg?style=flat-square)](https://geysermc.org)

**CraftOrbit** is a modern, high-performance, open-source web management panel for hosting Minecraft servers effortlessly on your computer and playing with friends worldwide—**zero router port forwarding required**.

Featuring automated server engine downloading (**Forge, NeoForge, Fabric, Paper, and Vanilla**), dual **playit.gg** tunneling (PC + Mobile), 1-click **GeyserMC & Floodgate** cross-play, in-browser **Modrinth** mod store, and real-time hardware telemetry.

---

## ⚡ Quick Start

### 🚀 Option A: Standalone Desktop App (Windows — No Node.js Required)
1. Download **`CraftOrbit-v1.3.0-Windows-Standalone.zip`** from [Releases](https://github.com/DanzBless/craftorbit/releases/latest).
2. Extract the archive anywhere on your PC.
3. Double-click **`CraftOrbit.exe`**.
4. A dedicated Chromium application window launches immediately with zero setup required.

### 📦 Option B: Standard Portable Package (Windows)
1. Ensure **Node.js** (v18+) and Java Runtime are installed.
2. Download **`CraftOrbit-v1.3.0-Windows.zip`** from [Releases](https://github.com/DanzBless/craftorbit/releases/latest).
3. Extract and double-click **`setup.bat`** (or `start.bat`).
4. Dashboard opens in browser: 👉 **`http://localhost:3000`**

*(Optional: Double-click `start-silent.vbs` to run CraftOrbit hidden in the background without keeping a CMD window open).*

### 🐧 Option C: Linux / Ubuntu Server (CLI & 24/7 Hosting)
1. Download or clone on your Ubuntu machine:
   ```bash
   wget https://github.com/DanzBless/craftorbit/releases/download/v1.3.0/CraftOrbit-v1.3.0-Linux-Server.tar.gz
   mkdir -p craftorbit && tar -xzf CraftOrbit-v1.3.0-Linux-Server.tar.gz -C craftorbit
   cd craftorbit
   ```
2. Run automated setup:
   ```bash
   chmod +x setup.sh start.sh
   ./setup.sh
   ```
3. Start the dashboard:
   ```bash
   ./start.sh
   ```
4. *(Optional) Run as 24/7 Systemd Service on Boot:*
   ```bash
   sudo cp craftorbit.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now craftorbit
   ```

---

## 🌟 Key Features

| Feature | Description |
| :--- | :--- |
| 🖥️ **Standalone Desktop GUI** | Bundled Windows executable (`CraftOrbit.exe`) running via Node SEA + Chromium App mode. Zero runtime dependencies or browser clutter. |
| 🎮 **Auto-Egg Provisioner** | 1-click server creation. Automatically downloads the official `.jar` for **Forge**, **NeoForge**, **Fabric**, **Paper**, or **Vanilla** directly from official APIs. |
| 🌍 **Global Tunneling (playit.gg)** | Host public games without touching router NAT/firewalls or leaking your home IP address. Supports separate dual tunnels for PC and Mobile. |
| 📱 **Java + Bedrock Cross-Play** | Auto-installs **Geyser** and **Floodgate** so friends on Android, iOS, Xbox, PlayStation, and Switch can join your Java Paper server on port `19132`. |
| 📦 **Modrinth Mod & Pack Store** | Search and install mods directly from the Modrinth catalog with 1 click. Includes `.zip` modpack importer for CurseForge/Modrinth server packs. |
| ⏱️ **Real-Time Telemetry & SLP** | Live RAM/CPU charts, native Server List Ping (latency ms & player count), and automated 10-minute world saves (`/save-all`). |
| 🔄 **1-Click Disaster Recovery** | Full world backup creation (`.zip`) with an instant 1-click restore button. |
| 🏛️ **Argonara Sidebar Workspace** | Full-height Pterodactyl-style left navigation. Decluttered header with live breadcrumbs and active server switching. |
| 🎨 **Obsidian Monochrome Theme** | High-contrast, zero-distraction dark aesthetic with strictly functional emerald (online) and rose (offline) states. |
| ⚡ **Production Hardened & UX Polish** | Skeleton loaders eliminate layout shifts (CLS), optimistic updates provide instant feedback (<50ms), and strict security headers prevent CSRF and path traversal. |
| 👥 **Active Players & Operations** | Overview dashboard displays online player heads, one-click world shortcuts (day/night/clear/save), and an in-game broadcast announcer. |
| ⌨️ **Command Palette & Hotkeys** | Press `Ctrl + K` for spotlight actions, `Alt + 1..9` to jump to tabs, `/` to focus console, and `Esc` to close modals. |
| 🌐 **Multi-Language (i18n)** | Native English display language with 1-click Language Switcher (English US & Bahasa Indonesia). |

---

## 🕹️ Supported Engines & Versions

- **Minecraft Forge**: 1.12.2, 1.16.5, 1.18.2, 1.19.2, 1.20.1 (Automated `--installServer` execution).
- **NeoForge**: 1.20.4, 1.21.1, 1.26 / 26.2 (Automated Maven installer).
- **Fabric**: All versions (Automated Fabric Server Launcher & Fabric-API injection).
- **Paper / Purpur**: High-performance servers with Bukkit/Spigot plugin support.
- **Mojang Vanilla**: Official `server.jar` packages.
- **Minecraft Bedrock**: Native Bedrock Dedicated Server support.

---

## 🤝 Inviting Friends

When your server is online, CraftOrbit provides ready-to-copy join addresses:
- **🌐 Internet (playit.gg)**: Give this domain (`xyz.gl.joinmc.link`) to friends playing outside your house.
- **🏠 Home Wi-Fi (LAN)**: Connect with siblings and housemates on the same network (`192.168.x.x:PORT`).
- **📱 Mobile Bedrock**: Phone and tablet players connect using the Bedrock Server IP and Port.

---

## ❓ Frequently Asked Questions (FAQ)

### How do I host a Minecraft server for free without port forwarding?
CraftOrbit integrates with `playit.gg` to create encrypted global tunnels. Launch your server in CraftOrbit, start the tunnel, and share the generated public domain with your friends. No router configuration or static IP required.

### Can friends on Bedrock (Mobile / Console) join my Java server?
Yes. When deploying a Paper or Purpur server in CraftOrbit, check **Auto-install Geyser & Floodgate**. CraftOrbit handles plugin installation and cross-play translation automatically.

### Does CraftOrbit require paid hosting?
No. CraftOrbit is 100% free and open-source under the MIT license. It runs entirely on your own computer.

---

## 📜 License & Attribution
Distributed under the **MIT License**. Created by [Naze_Tz](https://github.com/DanzBless).
Contributions, issues, and feature requests are welcome on [GitHub](https://github.com/DanzBless/craftorbit).
