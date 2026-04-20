[Unit]
Description=Higgins AI Agent (Telegram)
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={{HIGGINS_ROOT}}
ExecStart={{NODE_PATH}} {{HIGGINS_ROOT}}/index.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=higgins

[Install]
WantedBy=default.target
