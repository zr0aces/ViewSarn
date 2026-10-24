# Systemd Service Deployment (Bare-metal / Virtual Machine)

Unit configuration for running ViewSarn natively under `systemd` with process supervision and sandbox hardening (`ProtectSystem=strict`, `NoNewPrivileges=true`).

## Setup

1. **Install application:**
   ```bash
   sudo mkdir -p /opt/viewsarn /var/lib/viewsarn/output /etc/viewsarn
   sudo chown -R www-data:www-data /var/lib/viewsarn/output /etc/viewsarn
   ```

2. **Generate API key:**
   ```bash
   sudo node /opt/viewsarn/scripts/generate-apikey.js -f /etc/viewsarn/apikeys.txt -c "systemd-prod"
   sudo chown www-data:www-data /etc/viewsarn/apikeys.txt
   sudo chmod 600 /etc/viewsarn/apikeys.txt
   ```

3. **Install unit file:**
   ```bash
   sudo cp viewsarn.service /etc/systemd/system/viewsarn.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now viewsarn
   ```

4. **Check status & logs:**
   ```bash
   sudo systemctl status viewsarn
   sudo journalctl -u viewsarn -f
   ```
