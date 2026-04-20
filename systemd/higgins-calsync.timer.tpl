[Unit]
Description=Higgins Calendar Sync Timer (daily at 6:00 AM)

[Timer]
OnCalendar=*-*-* 06:00:00
Persistent=true

[Install]
WantedBy=timers.target
