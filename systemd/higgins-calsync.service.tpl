[Unit]
Description=Higgins Calendar Sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory={{HIGGINS_ROOT}}
ExecStart={{NODE_PATH}} {{HIGGINS_ROOT}}/skills/calendar/cal-sync.mjs
StandardOutput=journal
StandardError=journal
SyslogIdentifier=higgins-calsync
