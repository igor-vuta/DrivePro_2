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
| SMS / OTP mode  | `journalctl -u drivepro -n 30 \| grep -E 'SMS\|OTP\|Telegram'` |
| Backup data     | `sudo tar czf drivepro-data.tgz -C /opt/drivepro data`     |

All state (SQLite DB, JWT secret, VAPID push keys) lives in
`/opt/drivepro/data` — back up that one folder. Restoring it on a fresh VM
keeps every account, ride, streak, crew and push subscription.

## Unattended operations

`deploy/setup-ops.sh` installs three things and is re-run by `update.sh` on
every deploy, so a VM provisioned before any of it existed picks it up on its
next push:

| What | Unit | When |
| --- | --- | --- |
| Backup `/opt/drivepro/data` | `drivepro-backup.timer` | 03:20 UTC nightly (≈09:20 Almaty), 14 kept |
| Health / disk / backup-age check | `drivepro-watchdog.timer` | every 10 min |
| Ubuntu security updates | `unattended-upgrades` | daily |

```bash
systemctl list-timers 'drivepro-*'            # are they armed
sudo bash /opt/drivepro/repo/deploy/backup.sh # run a backup now
journalctl -u drivepro-backup -n 20           # did last night's work
journalctl -u drivepro-watchdog -n 20         # what the watchdog sees
```

**Backups** go to `/opt/drivepro/backups`, `0600`, newest 14 kept. The
database is snapshotted with `sqlite3 .backup` rather than copied, because a
plain copy of a database being written to can restore corrupt. Each archive is
opened after writing and deleted if it will not read — an unverified backup is
not a backup. Restore with:

```bash
sudo systemctl stop drivepro
sudo tar xzf /opt/drivepro/backups/drivepro-YYYYMMDD-HHMMSS.tgz -C /opt/drivepro/data
sudo chown -R drivepro:drivepro /opt/drivepro/data
sudo systemctl start drivepro
```

**Alerts** reuse the Telegram bot that already delivers verification codes, so
they cost nothing new. Set the chat to alert:

```bash
sudo sh -c 'echo "ALERT_TELEGRAM_CHAT_ID=123456789" >> /etc/drivepro.env'
```

(Message the bot, then read your chat id from
`journalctl -u drivepro | grep -i telegram`.) Without it the watchdog still
runs and still logs — it just has nobody to tell. It reports once when
something breaks and once when it recovers, never every ten minutes.

**Reboots are deliberately manual.** `unattended-upgrades` installs security
updates but never reboots: an unattended restart of the only production
machine at an hour nobody is watching is worse than a pending one. When
`/var/run/reboot-required` exists (kernel or libc updates), pick a moment:

```bash
sudo reboot        # then check: curl -sf https://drivepro-almaty.duckdns.org/api/health
```

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

Configuring a real SMS provider turns the echo off **by itself** — you do
not need `NODE_ENV` or `OTP_ECHO` for that. An explicit `OTP_ECHO=1` still
wins, but every boot then logs `!! OTP_ECHO is ON and …`.

### Turning on real SMS (Twilio)

Add the credentials to `/etc/drivepro.env` **on the VM** and restart. They
never belong in the repo:

```bash
sudo tee -a /etc/drivepro.env >/dev/null <<'EOF'
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM=+1XXXXXXXXXX
EOF
# and remove the temporary echo, which is no longer needed:
sudo sed -i '/^OTP_ECHO=1$/d' /etc/drivepro.env
sudo systemctl restart drivepro
journalctl -u drivepro -n 20 | grep -E 'SMS|OTP'
```

You should see `SMS: twilio AC…` and `echo to clients OFF`. Use
`TWILIO_MESSAGING_SERVICE_SID=MG…` instead of `TWILIO_FROM` if you send
through a Messaging Service. `SMS_TEMPLATE` overrides the message text
(`{code}` is substituted).

Two Twilio facts that bite in Kazakhstan:

- A **trial** account only delivers to numbers you have verified in the
  console. Everyone else gets error `21608`, which the app surfaces as
  `sms_failed` rather than pretending a code was sent.
- KZ operators generally require a **registered alphanumeric sender ID**
  for A2P traffic. Without it, delivery to `+7 7…` numbers may be silently
  dropped by the carrier even though Twilio accepts the message.

### Telegram (recommended for Kazakhstan)

Kazakh carriers require a pre-registered alphanumeric sender ID for A2P SMS,
and refuse international long codes outright — so SMS may never reach your
users. A Telegram bot needs no approval from anyone and reaches the same
people. Setup is two minutes:

1. Open Telegram, message **@BotFather**, send `/newbot`, pick a display
   name and a username ending in `bot`.
2. It replies with a token like `8123456:AAE…`. Put it on the VM:

```bash
sudo tee -a /etc/drivepro.env >/dev/null <<'EOF'
TELEGRAM_BOT_TOKEN=8123456:AAE...
EOF
sudo systemctl restart drivepro
journalctl -u drivepro -n 20 | grep Telegram
```

You should see `Telegram: bot @YourBotName`. The app then offers
**“Verify with Telegram instead”** on the verification screen.

How it verifies: the app opens `t.me/<bot>?start=<nonce>`, the user presses
Start, and the bot asks for their contact. Telegram returns the phone number
**it** has already verified; if that matches the number typed into the app,
the account is verified with no code ever being sent or entered. Sharing
somebody else's contact card does not work — Telegram only reports its own
`user_id` when a user shares themselves, and the server checks that.

Once linked, later codes (password reset) go to the Telegram chat instead of
SMS. Nothing is required in the Caddyfile: the bot uses long polling, not a
webhook.

`deploy/update.sh` backfills `NODE_ENV` and `OTP_ECHO` into an existing
`/etc/drivepro.env` (setup-oci.sh only writes that file when it is absent,
so VMs provisioned earlier would otherwise never get the new keys).

## Routing (OSRM)

Walk / cycle / drive routing goes through `server/src/geo.js`, which proxies
OSRM. By default it uses the **FOSSGIS demo servers**
(`routing.openstreetmap.de/routed-{car,foot,bike}`) - unlike the plain OSRM
demo, these serve all three profiles, so everything works with no setup. They
are shared community servers, though, so for anything beyond a demo, self-host:

```bash
sudo bash /opt/drivepro/repo/deploy/setup-osrm.sh
```

This downloads the Kazakhstan extract, builds car/foot/bike profiles, runs
each as a Docker container behind systemd on ports 5000-5002, and appends
`OSRM_URL` / `OSRM_FOOT_URL` / `OSRM_BIKE_URL` to `/etc/drivepro.env`.

**Done on the prod VM 2026-08-11.** The build took ~3 h on its 956 MB of
RAM (the script's 4 GB swapfile is what makes it possible at all); the live
service stayed up but sluggish throughout, and CI health checks needed the
60 s grace window `update.sh` now has. The routers run with `--mmap=1` —
mandatory on this box, since the three graphs total ~3.3 GB and loading
them into anonymous memory thrashes forever. To rebuild after a fresh
region download, rerun the script; it skips whatever is already built.

> **Run it attended.** It competes with the live service for the whole
> build. Nothing breaks without it; the FOSSGIS fallback keeps serving in
> the meantime.

## Places (2GIS)

Named places - search by name, category chips, tap-a-building - come from the
2GIS Catalog API through `server/src/places.js`. The key lives only in
`/etc/drivepro.env` and never reaches a browser; the app calls our own
`/api/places/*` and gets a provider-neutral shape back.

```bash
sudo sh -c 'echo "TWOGIS_KEY=your_key_here" >> /etc/drivepro.env'
sudo systemctl restart drivepro
```

Without the key the endpoints answer `503 places_off`, `/api/me` reports
`placesProvider: false`, and the app hides the place features rather than
offering dead buttons - so an unconfigured deployment degrades quietly.

Provider quirks absorbed in `places.js`, learned by probing the live API:
- "Nothing found" comes back as `meta.code` **404**, which is an empty list,
  not an error.
- There is no point-lookup call. A wildcard `q=*` returns 404; a point query
  with no filter returns administrative districts. What a tap on a building
  actually needs is `point` + small `radius` + `type=branch`.
- Coordinates are `lon,lat`, and items can arrive with no `point` at all -
  those are dropped rather than rendered at 0,0.

`TWOGIS_API_URL` is a test seam; `smoke36` runs the whole surface against a
stub and never touches the real API.

### The basemap key is a different kind of secret

`TWOGIS_KEY` above is a server secret and stays one. The **basemap** key cannot
be: MapGL draws vector tiles with WebGL in the browser and authenticates from
there, so whatever key it uses is visible to anyone running the map. There is no
proxy that changes this.

```bash
sudo sh -c 'echo "TWOGIS_MAP_KEY=your_browser_key" >> /etc/drivepro.env'
sudo systemctl restart drivepro
journalctl -u drivepro -n 30 | grep '^Map:'
```

- **`Map: 2GIS MapGL (own browser key)`** — what you want. Create a *second*
  key in the 2GIS console with only the MapGL JS API on it and restrict it to
  this deployment's domain, so publishing it grants nothing anywhere else.
- **`Map: 2GIS MapGL !! reusing TWOGIS_KEY in browsers …`** — with no
  `TWOGIS_MAP_KEY`, the catalog key is reused so a one-key deployment still
  gets a map. It works, but that key also spends the 1,000/month catalog quota
  and is now readable by every signed-in user. Fine for a demo; split the keys
  before it matters.
- **`Map: OpenStreetMap raster (no TWOGIS_MAP_KEY)`** — no key at all. The app
  falls back to CARTO raster tiles, which need no key and always work.

The key travels in `/api/me`, so it reaches signed-in clients only and is never
baked into the static bundle. That is not secrecy — it just keeps it out of
crawlers and off the public JS.

`GEO_USER_AGENT` overrides the Nominatim User-Agent - set a real contact there
before any serious geocoding volume, or Nominatim may block a generic one.

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
