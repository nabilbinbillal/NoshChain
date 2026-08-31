module.exports = {
  apps: [
    {
      name: "noshchain-node1",
      script: "src/node.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm",
      cwd: "/home/noshadmin/NoshChain-github",
      env_production: {
        NODE_ENV: "production",
        PORT: 3001,
        DATA_FILE: "data/blockchain.db",
        PEER: "http://localhost:3002",
        LOG_LEVEL: "info",
        DIFFICULTY: 2
      },
      env: {
        NODE_ENV: "development",
        PORT: 3001,
        DATA_FILE: "data/blockchain.db",
        PEER: "http://localhost:3002",
        LOG_LEVEL: "debug",
        DIFFICULTY: 2
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000
    },
    {
      name: "noshchain-node2",
      script: "src/node.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm",
      cwd: "/home/noshadmin/NoshChain-github",
      env_production: {
        NODE_ENV: "production",
        PORT: 3002,
        DATA_FILE: "data/node2.db",
        PEER: "http://localhost:3001",
        LOG_LEVEL: "info",
        DIFFICULTY: 2
      },
      env: {
        NODE_ENV: "development",
        PORT: 3002,
        DATA_FILE: "data/node2.db",
        PEER: "http://localhost:3001",
        LOG_LEVEL: "debug",
        DIFFICULTY: 2
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000
    },
    {
      name: "noshchain-activity",
      script: "src/activity-daemon.ts",
      interpreter: "node",
      interpreter_args: "--import tsx/esm",
      cwd: "/home/noshadmin/NoshChain-github",
      env_production: {
        NODE_ENV: "production",
        NODE_URL: "http://localhost:3001",
        LOG_LEVEL: "info"
      },
      env: {
        NODE_ENV: "development",
        NODE_URL: "http://localhost:3001",
        LOG_LEVEL: "debug"
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000
    }
  ]
};
