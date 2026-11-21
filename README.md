# ESP32-S3 Fire Alarm IoT Prototype

This project contains:
- `src/main.cpp`: PlatformIO firmware for ESP32-S3 (Arduino framework)
- `backend/`: Node.js, Express and Socket.IO API
- `frontend/`: React + TypeScript dashboard built with Vite

## Important safety and hardware notes

This is a prototype, not a certified fire alarm. Do not rely on it as the only fire-protection device.

- Confirm GPIO availability for your exact ESP32-S3 board.
- MQ-2 analog output must be reduced to a safe ESP32-S3 ADC voltage using a voltage divider or suitable level interface. Never connect a possible 5V output directly to an ESP32 GPIO.
- Power the MQ-2 heater from its specified supply.
- Power the SIM900A according to the exact breakout/module requirements; GSM transmit current peaks are high. Do not assume it can run from the ESP32 3.3V pin.
- Confirm UART logic levels. SIM900A RX may need a level interface from ESP32 TX depending on the module.
- The relay input must be compatible with ESP32 3.3V logic. Check active-low/active-high behavior.
- The buzzer must be a 12V DC unit and powered through relay contacts, not from an ESP32 GPIO.
- Common grounds are required for logic signals when using separate non-isolated supplies.
- Thresholds in the firmware are examples. MQ-2 raw ADC readings are not calibrated ppm values.
- SIM900A needs a compatible SIM, antenna and available 2G service. Some carriers/regions have retired 2G.
- SMS sending can block firmware briefly; local relay activation is performed before SMS attempts.

## 1. Flash the ESP32-S3

Install VS Code and PlatformIO IDE. Open this folder as the PlatformIO project.

Edit `src/main.cpp`:
- Set `WIFI_SSID` and `WIFI_PASSWORD`.
- Set `API_URL` to the computer's LAN IP, e.g. `http://192.168.1.25:3001/api/telemetry`.
- Set `ALERT_PHONE_NUMBER`.
- Verify GPIO numbers, relay polarity, and thresholds.

Connect the ESP32-S3 over USB. Build and upload using PlatformIO. Open Serial Monitor at 115200 baud.

## 2. Run the backend

Install Node.js 20+ (or a current LTS release).

```bash
cd backend
npm install
npm run dev
```

The API listens on port 3001. Test `http://localhost:3001/api/health` in a browser.

For the ESP32 to reach the backend, the computer and ESP32 must be on the same network, and the OS firewall must allow inbound TCP port 3001. Use the computer's LAN IP in `API_URL`; do not use `localhost` there.

If accessing the frontend from another device, set `FRONTEND_ORIGIN` to the frontend origin before starting the backend, for example:
- Windows PowerShell: `$env:FRONTEND_ORIGIN="http://192.168.1.25:5173"; npm run dev`
- macOS/Linux: `FRONTEND_ORIGIN=http://192.168.1.25:5173 npm run dev`

## 3. Run the React dashboard

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

If viewing the dashboard on the same computer, `http://localhost:3001` is fine. If viewing it from another device, create `frontend/.env` with:

```env
VITE_API_BASE=http://192.168.1.25:3001
```

Replace the IP with the computer's LAN IP, then restart Vite.

## Data flow

ESP32 posts JSON to `POST /api/telemetry`. Backend stores the latest reading in memory and broadcasts a `telemetry` event over Socket.IO. React receives updates and renders the dashboard.

This starter stores only the latest telemetry in memory. It does not provide persistent history, authentication, TLS, remote access, or dashboard controls.

## Suggested folder structure

```text
fire-alarm-iot/
├── platformio.ini
├── src/
│   └── main.cpp
├── backend/
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── styles.css
└── README.md
```
