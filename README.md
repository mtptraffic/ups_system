# UPS monitoring system

Simple Node.js dashboard for 1–10 ESP32 UPS monitors. Compatible with JSON fields `id`, `battery`, `load`, `tem`.

## Deploy to Render
1. Create a MongoDB Atlas cluster and database user. Obtain a connection string. Set Atlas Network Access so Render can connect (Render outbound IPs vary by service configuration; restrict access when possible).
2. Upload project files to your **own private GitHub repository**. Do not upload `.env` or credentials.
3. In Render create a **Web Service** from that repository. Runtime: Node; build command: `npm install`; start command: `npm start`.
4. Set environment variables `MONGODB_URI`, `DEVICE_API_KEY`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD` in Render's environment settings.
5. Open your Render URL; browser will request dashboard username and password.
6. ESP32 sends HTTPS POST to `https://YOUR-SERVICE.onrender.com/data` with `Content-Type: application/json` and `x-api-key: YOUR_DEVICE_API_KEY`.

Example JSON: `{ "id": 1, "battery": 12.6, "load": 0.45, "tem": 32.5 }`.

## ESP32 change
In the existing HTTPClient code, after `http.begin(...)` and before `http.POST(...)`, add:
`http.addHeader("x-api-key", "YOUR_DEVICE_API_KEY");`
Keep `http.addHeader("Content-Type", "application/json");`.
Use HTTPS with proper TLS certificate validation on the ESP32. Avoid insecure TLS settings in production.

## Notes
- `load` is treated as **current in amperes**, not ON/OFF. Confirm your sensor calibration.
- UPS IDs are integers from 1 to 10; unused devices show Offline.
- Offline threshold: 60 seconds.
- Battery threshold (red): 10.5 V; adjust to match your battery chemistry/system.
- The database stores **latest readings only**, not historical charts.
- Input/output AC voltage is not shown because existing firmware does not transmit it.
- Browser authentication is HTTP Basic over HTTPS. Suitable for an initial private dashboard; use stronger authentication for broader production deployment.
