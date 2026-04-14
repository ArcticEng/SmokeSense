# SmokeSense — Fire Monitoring System

Full-stack fire detection platform by Arctic Engineering.
Sits between VESDA aspirating systems (R15k+) and basic fire alarms (R200).

## Architecture

```
ESP32 Sensor Node  →  MQTT Broker  →  Bridge Service  →  Supabase  →  Dashboard/App
     (firmware)      (HiveMQ free)    (Railway/Node)    (PostgreSQL)   (Vercel/Next.js)
```

## Project Structure

```
smokesense/
├── app/                     # Next.js 14 App Router
│   ├── layout.tsx           # Root layout (dark theme)
│   ├── page.tsx             # Redirect to /dashboard or /login
│   ├── globals.css          # Tailwind base styles
│   ├── login/page.tsx       # Auth page (sign in / register)
│   ├── dashboard/page.tsx   # Main monitoring dashboard
│   └── api/devices/[deviceId]/command/
│       └── route.ts         # MQTT command API endpoint
├── lib/
│   ├── supabase.ts          # Supabase client + types
│   └── hooks.ts             # React hooks (auth, devices, realtime, events)
├── middleware.ts             # Auth route protection
├── capacitor.config.ts      # Mobile app wrapper (iOS/Android)
├── tailwind.config.js
├── tsconfig.json
├── next.config.js
├── package.json
└── .env.local.example       # Environment variables template
```

## Quick Start

### 1. Supabase
- Create project at supabase.com
- Run `supabase_schema.sql` in SQL Editor
- Copy URL + anon key + service key

### 2. Dashboard (this project)
```bash
git clone <repo>
cd smokesense
npm install
cp .env.local.example .env.local   # fill in Supabase keys
npm run dev                         # http://localhost:3000
```

### 3. MQTT Bridge
```bash
cd mqtt-bridge/
cp .env.example .env               # fill in Supabase + MQTT keys
npm install
node mqtt_bridge.js
```
Deploy to Railway: connect GitHub repo, set env vars, done.

### 4. ESP32 Firmware
- Open `SmokeSense_MQTT.ino` + `config.h` in PlatformIO
- Set WiFi credentials in config.h
- `pio run --target upload`
- Device auto-registers on first MQTT publish

### 5. Mobile App (optional)
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap add ios && npx cap add android
npm run build
npx cap sync
npx cap open ios    # or android
```

## Deploy to Vercel
```bash
npm i -g vercel
vercel --prod
```
Set environment variables in Vercel dashboard.

## MQTT Topics
| Topic | Direction | QoS | Purpose |
|-------|-----------|-----|---------|
| `smokesense/{org}/{dev}/telemetry` | Device → Cloud | 0 | Sensor readings (2s) |
| `smokesense/{org}/{dev}/event` | Device → Cloud | 1 | Alarm stage changes |
| `smokesense/{org}/{dev}/status` | Device → Cloud | 1 | Online/offline (LWT) |
| `smokesense/{org}/{dev}/heartbeat` | Device → Cloud | 0 | Alive ping (30s) |
| `smokesense/{org}/{dev}/cmd` | Cloud → Device | 1 | Commands |
| `smokesense/{org}/{dev}/config` | Cloud → Device | 1 | Threshold updates |

## Alarm Stages (VESDA-equivalent)
| Stage | Label | Trigger | Response |
|-------|-------|---------|----------|
| 0 | Clear | Baseline | Normal |
| 1 | Alert | >80 delta | Investigate |
| 2 | Action | >200 delta | Respond |
| 3 | Fire 1 | >400 delta | Pre-alarm |
| 4 | Fire 2 | >700 delta | Evacuate |

## License
Proprietary — Arctic Engineering (Pty) Ltd
