# WebTNX

<p align="center">
  <strong>Stable, Lightweight, and Secure HTTP Tunneling Tool</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/RAM_Footprint-~10MB_--_50MB-green?style=flat-square" alt="RAM Footprint">
  <img src="https://img.shields.io/badge/Security-SSL%2FTLS%20%2B%20Symmetric_Encryption-blue?style=flat-square" alt="Security">
  <img src="https://img.shields.io/badge/License-NeuralNexusLab_Proprietary-red?style=flat-square" alt="License">
</p>

---

**WebTNX** is a stable, convenient, and secure HTTP reverse-proxy tunnel that allows you to safely expose your local servers to the internet without configuring any router settings or system dependencies. It is designed to be highly reliable, lightweight, and suitable for stable, long-term server hosting.

WebTNX supports both a **Zero-Install Web Agent** (running entirely in a browser tab) and **Native CLI Clients** (Windows standalone `.exe`, Linux/macOS Shell script, and Python Source). The native CLI agents run directly on the host OS, completely bypassing browser sandboxing and CORS (Cross-Origin Resource Sharing) restrictions.

---

## ⚙️ Key Features

* 🌐 **Web Agent**: Expose your local server on any device (including smartphones and tablets) directly via a browser tab. Requires no software installation.
* 💻 **Native CLI Agents (CORS Bypassed)**: Run directly on your OS to bypass CORS restrictions natively—no need to configure CORS on your local codebase.
* 🔒 **Symmetric Transit Encryption**: Protected by End-to-End SSL/TLS secure channels, supplemented by symmetric payload encryption on the client before data transit.
* 🚀 **Extreme Server Efficiency**: Highly optimized backend, stably running with a baseline memory footprint of less than 50MB of RAM.
* 📊 **Interactive Web Console**: A real-time request history dashboard built into the tunnel page, displaying HTTP methods, path logs, response status codes, and payload previews.

---

## 🛠️ Part 1: Self-Hosting Guide (How to Copy & Run)

Expose your public server instance in less than 2 minutes. Follow these simple steps:

### Prerequisites
Ensure you have **Node.js** (v18+ recommended) installed on your public server.

### 1. Clone the Repository
```bash
git clone https://github.com/NeuralNexusLab-nh/WebTNX.git
cd WebTNX
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure the Port and Run
You can configure the server port via the `PORT` environment variable:

**On Linux / macOS:**
```bash
PORT=3000 node server.js
```

**On Windows (PowerShell):**
```powershell
$env:PORT="3000"; node server.js
```

**On Windows (CMD):**
```cmd
set PORT=3000
node server.js
```

The WebTNX server is now live. Open your browser and visit `http://localhost:3000` to access the tunnel panel.

---

## 🛡️ Part 2: Active Defense & Security Architecture

WebTNX is designed with proactive security principles at its core:
* **Directory Traversal Immunity**: Strict whitelist-based validation blocks malicious payload injection on tunnel IDs.
* **DDoS & Memory Exhaustion Shield**: A hard-capped **2MB payload limit** prevents memory-overflow attacks on resource-constrained hosting environments.
* **Auto Fault Tolerance**: In case of temporary network drops, the CLI agent automatically retries connection recovery every 5 seconds without manual restarts.
* **Symmetric Encryption**: Payload contents are encrypted on the client using a secure key, keeping your local data completely private over the public internet.

---

## 🏢 Part 3: Developer Profile: NeuralNexusLab

**WebTNX** is developed and maintained by **NeuralNexusLab**.

* 🌐 **Official Website**: [https://nxlab.zone.id](https://nxlab.zone.id)
* 📍 **Location**: Based in Taiwan.
* ⚔️ **Expertise**: Full-Stack DevSecOps & Web Penetration Testing (Red Team).

Our background in professional offensive security and defensive engineering is the reason WebTNX is built with a highly secure, hardened, and resilient architecture. We design tools that prioritize not only convenience but robust defense.

---

## ⚖️ License

Distributed under the **NeuralNexusLab Shared Source License v1.0**. 

* Commercial use to facilitate or power your own business operations or subscription services is **strictly permitted** (e.g., using WebTNX to proxy your backend AI APIs and charging users for the AI service).
* Commercializing the HTTP Tunneling service itself is **strictly prohibited** (e.g., you cannot sell or charge users directly for WebTNX tunneling, subdomains, or hosting).
* Attribution is required. You must prominently credit **NeuralNexusLab** with a link to `https://nxlab.zone.id` in any publicly hosted instance or modified version of this software.

See the `LICENSE` file for more details.
