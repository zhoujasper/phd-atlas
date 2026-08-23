const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

let serverProcess;
let mainWindow;
let serverPort;

function getNodeRuntime() {
  if (app.isPackaged) {
    const bundledNode = path.join(process.resourcesPath, "node");
    if (fs.existsSync(bundledNode)) return bundledNode;
  }

  return process.env.PHD_ATLAS_NODE_PATH
    || process.env.npm_node_execpath
    || "node";
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address
        ? address.port
        : null;
      probe.close(() => {
        if (!port) {
          reject(new Error("无法找到可用的本地端口"));
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForServer(url, retry = 40) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve();
    });

    request.on("error", () => {
      if (retry <= 0) {
        reject(new Error("PhD Atlas 服务启动失败"));
        return;
      }

      setTimeout(() => {
        waitForServer(url, retry - 1).then(resolve).catch(reject);
      }, 500);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);
}

app.whenReady().then(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const serverProjectRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : projectRoot;
  const serverScript = path.join(serverProjectRoot, "tools", "start-server.mjs");
  serverPort = await findAvailablePort();

  serverProcess = spawn(
    getNodeRuntime(),
    [serverScript],
    {
      cwd: app.isPackaged ? process.resourcesPath : projectRoot,
      env: {
        ...process.env,
        PHD_ATLAS_INTERNAL_SERVER_WORKER: "1",
        NODE_ENV: "development",
        PORT: String(serverPort),
        HOST: "127.0.0.1",
        DOMAIN: `http://localhost:${serverPort}`,
        BASE_URL: `http://localhost:${serverPort}`,
        CORS_ORIGIN: `http://localhost:${serverPort}`,
        ALLOWED_HOSTS: "localhost,127.0.0.1",
        SECURE: "false",
        PHD_ATLAS_STORAGE_ROOT: path.join(
          app.getPath("userData"),
          "storage"
        ),
        PHD_ATLAS_PROJECT_ROOT: serverProjectRoot,
      },
      stdio: "inherit",
    }
  );

  await waitForServer(`http://127.0.0.1:${serverPort}/api/health`);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
