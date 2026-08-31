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
        PEER: "",
        LOG_LEVEL: "info",
        DIFFICULTY: 2
      },
      env: {
        NODE_ENV: "development",
        PORT: 3001,
        DATA_FILE: "data/blockchain.db",
        PEER: "",
        LOG_LEVEL: "debug",
        DIFFICULTY: 2
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000
    }
  ]
};
