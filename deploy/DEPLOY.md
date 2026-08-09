# Hosting DrivePro on Oracle Cloud (Always Free)

The server is zero-dependency Node and `app/dist` is committed, so the VM
needs no build toolchain: clone → run. One script does the whole setup.

## 1. Create the VM

- Oracle Cloud console → Compute → Instances → **Create instance**.
- Image: **Ubuntu 24.04** (22.04 also fine). Shape: **Ampere A1 Flex**
  (Always Free: up to 4 OCPU / 24 GB — 1 OCPU / 6 GB is plenty).
- Add your SSH key, create, and note the **public IP**.
- Recommended: Networking → Reserved public IPs → reserve one and assign it
  to the instance, so the IP survives stop/start.

## 2. Open ports in the cloud firewall

Instance page → Virtual cloud network → your subnet's **Security List**
(or the instance's NSG) → **Add Ingress Rules**:

- Source `0.0.0.0/0`, protocol TCP, destination port `80`
- Source `0.0.0.0/0`, protocol TCP, destination port `443`

(The setup script opens the same ports *inside* the VM — OCI Ubuntu images
also ship a restrictive iptables that silently drops traffic otherwise.)

## 3. Point a DuckDNS name at the VM

- https://www.duckdns.org → sign in → create a subdomain, e.g.
  `yourname.duckdns.org` → set its IP to the VM's public IP.
- Copy your DuckDNS **token** if you want the VM to keep the record fresh
  automatically (recommended with a non-reserved IP).

## 4. Run the setup script

SSH in (`ssh ubuntu@<ip>`) and run:

```bash
git clone https://github.com/igor-vuta/DrivePro_2.git
sudo DOMAIN=yourname.duckdns.org DUCKDNS_TOKEN=your-token \
  bash DrivePro_2/deploy/setup-oci.sh
```

The script installs Node 22 and Caddy, opens 80/443 in iptables, creates a
`drivepro` system user, clones the repo to `/opt/drivepro/repo`, writes
`/etc/drivepro.env` (including a generated `ADMIN_TOKEN`), starts the
`drivepro` systemd service and puts Caddy in front with automatic
Let's Encrypt TLS. Re-running it is safe.

Then open **https://yourname.duckdns.org** — the web app is served by the
same process. HTTPS is what makes *Add to Home Screen* and web push work.

## 5. Day-2 operations

| Task            | Command                                                    |
| --------------- | ---------------------------------------------------------- |
| Update the app  | `sudo bash /opt/drivepro/repo/deploy/update.sh`            |
| Server logs     | `journalctl -u drivepro -f`                                |
| Caddy logs      | `journalctl -u caddy -f`                                   |
| Restart         | `sudo systemctl restart drivepro`                          |
| Admin token     | `sudo grep ADMIN_TOKEN /etc/drivepro.env` → open `/admin`  |
| Backup data     | `sudo tar czf drivepro-data.tgz -C /opt/drivepro data`     |

All state (SQLite DB, JWT secret, VAPID push keys) lives in
`/opt/drivepro/data` — back up that one folder. Restoring it on a fresh VM
keeps every account, ride, streak, crew and push subscription.

## Environments

Three environments, deliberately separated so nothing developer-only can
reach real users:

| Env      | How it runs                       | `NODE_ENV`   | OTP echo |
| -------- | --------------------------------- | ------------ | -------- |
| **dev**  | `./start.sh` (server + tunnel)    | unset        | ON       |
| **test** | `bash server/tests/run-all.sh`    | `test`       | ON       |
| **prod** | systemd `drivepro` on the VM      | `production` | see below |

The OTP echo returns the verification code in the API response
(`devCode`), which is what makes local testing possible without SMS — and
which would also let anyone verify a phone number they do not own. It is
therefore **off by default whenever `NODE_ENV=production`**. `OTP_ECHO`
overrides the default in both directions (`1` on, `0` off).

> **Prod is currently running with `OTP_ECHO=1`** because no SMS provider
> is wired yet (roadmap L24). The line in `/etc/drivepro.env` is marked
> TEMPORARY: delete it the moment real SMS delivery lands, and the safe
> default takes over. While it is set, every boot logs
> `!! OTP_ECHO is ON in production` — check `journalctl -u drivepro`.

`deploy/update.sh` backfills `NODE_ENV` and `OTP_ECHO` into an existing
`/etc/drivepro.env` (setup-oci.sh only writes that file when it is absent,
so VMs provisioned earlier would otherwise never get the new keys).

## Auto-deploy on push (GitHub Actions)

`.github/workflows/deploy.yml` runs the full smoke suite on every push to
`main` and, if green, SSHes into the VM and runs `deploy/update.sh`.
One-time setup:

1. Make a dedicated deploy key on your machine:
   `ssh-keygen -t ed25519 -f ~/.ssh/drivepro_deploy -N '' -C drivepro-deploy`
2. Authorize it on the VM:
   `ssh ubuntu@<vm> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/drivepro_deploy.pub`
3. In the GitHub repo → Settings → Secrets and variables → Actions, add:
   - `DEPLOY_HOST` — the DuckDNS domain (or the VM IP)
   - `DEPLOY_SSH_KEY` — the *contents* of `~/.ssh/drivepro_deploy` (private key)

Until the secrets exist the deploy job skips itself, so the workflow is safe
to merge first. Tests run on every push either way.

## Troubleshooting

- **Site unreachable, but `curl localhost:4000/api/health` works on the VM**
  → ingress 80/443 missing in the Security List (step 2), or iptables —
  re-run the script.
- **TLS errors on first load** → DNS not propagated yet or the DuckDNS IP
  is wrong; `dig yourname.duckdns.org` should return the VM IP. Caddy
  retries certificate issuance automatically.
- **Push notifications denied** → they require the https:// origin; also
  check the browser granted permission for the site.
- **`node: not found` in the service** → Node was installed after the unit
  started; `sudo systemctl restart drivepro`.
