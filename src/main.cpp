#include <Arduino.h>
#include <HardwareSerial.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ===================== USER CONFIGURATION =====================

// Wi-Fi Configuration
const char* WIFI_SSID = "Converge_2.4GHz_KmU4";
const char* WIFI_PASSWORD = "PfmnWf2q";

// Backend API Configuration
// The backend handles TextBee SMS gateway and Brevo Email notifications via Render Cloud.
const char* API_URL = "https://fire-alarm-system-by3n.onrender.com/api/telemetry";
const char* DEVICE_ID = "esp32s3-fire-alarm-01";

// Physical SIM900A Hardware Module Configuration (Offline Backup)
// Set to true if you have a physical SIM900A module wired to the ESP32.
// Set to false if you rely on Wi-Fi with TextBee SMS and Brevo Email.
constexpr bool ENABLE_SIM900A_HARDWARE = true;

const char* ALERT_PHONE_NUMBERS[] = {
  "+639124492121",
  "+639993328833"
};
int TOTAL_PHONE_NUMBERS = sizeof(ALERT_PHONE_NUMBERS) / sizeof(ALERT_PHONE_NUMBERS[0]);

// GPIO Pin Configuration
constexpr int MQ2_PIN = 6;       // MQ-2 AO through voltage divider
constexpr int DHT_PIN = 4;       // DHT22 DATA
constexpr int RELAY_PIN = 7;     // Relay module IN (Active LOW)
constexpr int GSM_RX_PIN = 18;   // ESP32 RX2 <- SIM900A 3VT (or TXD)
constexpr int GSM_TX_PIN = 17;   // ESP32 TX2 -> SIM900A 3VR (or RXD)

// Sensor Configuration
constexpr int DHT_TYPE = DHT22;

// Relay Configuration (Active LOW for common relay modules)
constexpr bool RELAY_ACTIVE_LOW = true;

// Alarm Thresholds
constexpr int   MQ2_ALARM_THRESHOLD = 800;    // Buzzer triggers when live ADC reaches 800 or higher (sensitive smoke detection)
constexpr float TEMP_THRESHOLD_C    = 40.0f;  // Buzzer triggers when temperature reaches 40°C or higher

// Immediate Real-Time Active Monitoring (0s warmup - reads and arms immediately at boot)
constexpr unsigned long MQ2_WARMUP_MS = 0UL;

// Timing Configuration - continuous rapid sampling time-to-time
constexpr unsigned long SENSOR_INTERVAL_MS = 1000;    // Sample sensors every 1.0 second
constexpr unsigned long TELEMETRY_INTERVAL_MS = 2500; // Cloud telemetry update every 2.5 seconds
constexpr unsigned long SMS_COOLDOWN_MS = 5UL * 60UL * 1000UL;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
constexpr unsigned long GSM_RETRY_INTERVAL_MS = 15000;

// Sensor Error Thresholds
constexpr unsigned long SENSOR_ERROR_COOLDOWN_MS = 30000;
constexpr int DHT_MAX_READ_FAILURES = 5;

// ===================== SENSOR MANAGER =====================

struct SensorReadings {
  int mq2Raw;
  float temperatureC;
  float humidityPct;
  bool mq2Valid;
  bool dhtValid;
  String sensorStatus;
};

class SensorManager {
public:
  SensorManager(int dhtPin, int dhtType, int mq2Pin);
  void begin();
  SensorReadings read();
  bool isHealthy() const;
  String getStatus() const;

private:
  DHT _dht;
  int _mq2Pin;
  int _dhtReadFailures;
  unsigned long _lastErrorReport;
  String _currentStatus;
};

SensorManager::SensorManager(int dhtPin, int dhtType, int mq2Pin)
  : _dht(dhtPin, dhtType), _mq2Pin(mq2Pin), _dhtReadFailures(0), _lastErrorReport(0), _currentStatus("OK") {
}

void SensorManager::begin() {
  _dht.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(_mq2Pin, ADC_11db);
}

SensorReadings SensorManager::read() {
  SensorReadings readings;
  readings.mq2Raw = analogRead(_mq2Pin);
  readings.mq2Valid = true;
  readings.dhtValid = false;
  readings.temperatureC = NAN;
  readings.humidityPct = NAN;

  float t = _dht.readTemperature();
  float h = _dht.readHumidity();

  if (!isnan(t) && !isnan(h)) {
    readings.temperatureC = t;
    readings.humidityPct = h;
    readings.dhtValid = true;
    _dhtReadFailures = 0;
    if (_currentStatus != "OK") {
      Serial.println("[SENSOR] DHT22 readings recovered");
    }
    _currentStatus = "OK";
  } else {
    _dhtReadFailures++;
    if (_currentStatus != "DHT_ERROR") {
      Serial.println("[SENSOR] DHT22 read failed - temperature alarm disabled for invalid reading");
    }
    _currentStatus = "DHT_ERROR";
    if (_dhtReadFailures >= DHT_MAX_READ_FAILURES) {
      unsigned long now = millis();
      if (now - _lastErrorReport >= SENSOR_ERROR_COOLDOWN_MS) {
        _lastErrorReport = now;
        Serial.println("[SENSOR] DHT22 sensor error - multiple read failures");
      }
    }
  }

  readings.sensorStatus = _currentStatus;
  return readings;
}

bool SensorManager::isHealthy() const {
  return _currentStatus == "OK";
}

String SensorManager::getStatus() const {
  return _currentStatus;
}

// ===================== ALARM MANAGER =====================

enum AlarmReason {
  NORMAL,
  SMOKE_OR_GAS,
  HIGH_TEMPERATURE,
  SMOKE_AND_HIGH_TEMPERATURE
};

class AlarmManager {
public:
  AlarmManager(int relayPin, bool relayActiveLow);
  void begin();
  bool evaluate(int mq2Raw, float temperatureC, float humidityPct, int mq2Threshold, float tempThreshold);
  bool isActive() const;
  AlarmReason getReason() const;
  String getReasonString() const;
  bool getRelayStatus() const;

private:
  int _relayPin;
  bool _relayActiveLow;
  bool _alarmActive;
  AlarmReason _alarmReason;
  bool _relayStatus;
  bool _stateReported;

  void setBuzzerAlarm(bool active);
  String alarmReasonToString(AlarmReason reason) const;
};

AlarmManager::AlarmManager(int relayPin, bool relayActiveLow)
  : _relayPin(relayPin), _relayActiveLow(relayActiveLow), _alarmActive(false), _alarmReason(NORMAL), _relayStatus(false), _stateReported(false) {
}

void AlarmManager::begin() {
  digitalWrite(_relayPin, _relayActiveLow ? HIGH : LOW);
  pinMode(_relayPin, OUTPUT);

  _alarmActive = false;
  _alarmReason = NORMAL;
  _relayStatus = false;
  _stateReported = true;

  Serial.println("[RELAY] Initialized - buzzer OFF");
  Serial.println("[ALARM] System monitoring armed - buzzer OFF");
}

bool AlarmManager::evaluate(int mq2Raw, float temperatureC, float humidityPct, int mq2Threshold, float tempThreshold) {
  // Trigger smoke alarm when reading reaches or exceeds threshold (1500+)
  bool smokeTriggered = mq2Raw >= mq2Threshold;
  // Trigger heat alarm when temperature reaches or exceeds 40°C
  bool temperatureTriggered = !isnan(temperatureC) && temperatureC >= tempThreshold;

  AlarmReason newReason = NORMAL;
  if (smokeTriggered && temperatureTriggered) {
    newReason = SMOKE_AND_HIGH_TEMPERATURE;
  } else if (smokeTriggered) {
    newReason = SMOKE_OR_GAS;
  } else if (temperatureTriggered) {
    newReason = HIGH_TEMPERATURE;
  }

  bool shouldAlarm = smokeTriggered || temperatureTriggered;
  bool stateChanged = !_stateReported || (shouldAlarm != _alarmActive) || (newReason != _alarmReason);
  bool risingEdge = shouldAlarm && !_alarmActive;

  _alarmReason = newReason;
  setBuzzerAlarm(shouldAlarm);

  if (stateChanged) {
    Serial.printf("[ALARM] State Changed: %s - buzzer %s\n",
                  alarmReasonToString(_alarmReason).c_str(),
                  shouldAlarm ? "ACTIVATED 🚨" : "DEACTIVATED");
    _stateReported = true;
  }

  return risingEdge;
}

bool AlarmManager::isActive() const {
  return _alarmActive;
}

AlarmReason AlarmManager::getReason() const {
  return _alarmReason;
}

String AlarmManager::getReasonString() const {
  return alarmReasonToString(_alarmReason);
}

bool AlarmManager::getRelayStatus() const {
  return _relayStatus;
}

void AlarmManager::setBuzzerAlarm(bool active) {
  _alarmActive = active;
  _relayStatus = active;

  int outputLevel = _relayActiveLow ? (active ? LOW : HIGH) : (active ? HIGH : LOW);
  digitalWrite(_relayPin, outputLevel);
}

String AlarmManager::alarmReasonToString(AlarmReason reason) const {
  switch (reason) {
    case NORMAL: return "NORMAL";
    case SMOKE_OR_GAS: return "SMOKE DETECTED";
    case HIGH_TEMPERATURE: return "HIGH TEMPERATURE";
    case SMOKE_AND_HIGH_TEMPERATURE: return "SMOKE + HIGH TEMPERATURE";
    default: return "UNKNOWN";
  }
}

// ===================== GSM MANAGER (PHYSICAL SIM900A) =====================

HardwareSerial gsm(1);

class GSMManager {
public:
  GSMManager(int rxPin, int txPin, const char** phoneNumbers, int totalNumbers);
  void begin();
  void update();
  bool sendSMS(const String& message);
  bool isReady() const;
  String getStatus() const;

private:
  int _rxPin;
  int _txPin;
  const char** _phoneNumbers;
  int _totalNumbers;
  bool _initialized;
  String _status;
  unsigned long _lastInitAttempt;
  unsigned long _lastNetworkCheck;
  unsigned long _baudRate;

  String readGsmResponse(unsigned long timeoutMs);
  bool syncBaud(unsigned long baud);
  bool ensureCommunication();
  bool checkSIMCard();
  void checkSignalQuality();
  void checkSMSC();
  int getNetworkRegistrationStatus();
};

GSMManager::GSMManager(int rxPin, int txPin, const char** phoneNumbers, int totalNumbers)
  : _rxPin(rxPin), _txPin(txPin), _phoneNumbers(phoneNumbers), _totalNumbers(totalNumbers),
    _initialized(false), _status("DISABLED"), _lastInitAttempt(0), _lastNetworkCheck(0), _baudRate(115200) {
}

String GSMManager::readGsmResponse(unsigned long timeoutMs) {
  String response = "";
  unsigned long started = millis();
  while (millis() - started < timeoutMs) {
    while (gsm.available()) {
      response += static_cast<char>(gsm.read());
    }
    delay(5);
  }
  return response;
}

bool GSMManager::syncBaud(unsigned long baud) {
  gsm.end();
  delay(50);
  gsm.begin(baud, SERIAL_8N1, _rxPin, _txPin);
  delay(150);

  for (int attempt = 1; attempt <= 3; attempt++) {
    while (gsm.available()) gsm.read();
    gsm.print("AT\r\n");
    String res = readGsmResponse(300);
    res.trim();
    if (res.indexOf("OK") >= 0) {
      _baudRate = baud;
      return true;
    }
    delay(50);
  }
  return false;
}

bool GSMManager::ensureCommunication() {
  for (int attempt = 0; attempt < 2; attempt++) {
    while (gsm.available()) gsm.read();
    gsm.print("AT\r\n");
    String res = readGsmResponse(300);
    if (res.indexOf("OK") >= 0) return true;
    delay(50);
  }

  const unsigned long testBauds[] = { _baudRate, 115200, 9600 };
  for (unsigned long b : testBauds) {
    if (syncBaud(b)) {
      _baudRate = b;
      return true;
    }
  }
  return false;
}

bool GSMManager::checkSIMCard() {
  while (gsm.available()) gsm.read();
  gsm.print("AT+CPIN?\r\n");
  String response = readGsmResponse(1500);
  response.trim();
  Serial.printf("[GSM] SIM status response: %s\n\n", response.c_str());

  if (response.indexOf("READY") >= 0) {
    Serial.println("[GSM] ✓ SIM Card detected: +CPIN: READY");
    return true;
  } else if (response.indexOf("SIM PIN") >= 0) {
    Serial.println("[GSM] ⚠️ SIM locked with PIN. Unlock SIM card first.");
    return false;
  } else if (response.indexOf("SIM PUK") >= 0) {
    Serial.println("[GSM] ⚠️ SIM locked with PUK.");
    return false;
  }
  Serial.printf("[GSM] ✗ SIM card not ready. Response: %s\n", response.c_str());
  return false;
}

void GSMManager::checkSignalQuality() {
  while (gsm.available()) gsm.read();
  gsm.print("AT+CSQ\r\n");
  String response = readGsmResponse(1000);
  response.trim();
  Serial.printf("[GSM] Signal (CSQ): %s\n", response.c_str());
}

void GSMManager::checkSMSC() {
  while (gsm.available()) gsm.read();
  gsm.print("AT+CSCA?\r\n");
  String response = readGsmResponse(1000);
  response.trim();
  Serial.printf("[GSM] SMS Center (CSCA): %s\n", response.c_str());

  if (response.indexOf("+CSCA: \"\"") >= 0 || response.indexOf("+CSCA:") < 0) {
    Serial.println("[GSM] Setting default PH SMS Center (+639180000101)...");
    gsm.print("AT+CSCA=\"+639180000101\"\r\n");
    readGsmResponse(800);
  }
}

int GSMManager::getNetworkRegistrationStatus() {
  while (gsm.available()) gsm.read();
  gsm.print("AT+CREG?\r\n");
  String response = readGsmResponse(1000);
  response.trim();

  int idx = response.indexOf("+CREG:");
  if (idx >= 0) {
    int comma = response.indexOf(',', idx);
    if (comma >= 0 && comma + 1 < (int)response.length()) {
      int stat = response.substring(comma + 1, comma + 2).toInt();
      return stat;
    }
  }
  return -1;
}

void GSMManager::begin() {
  if (!ENABLE_SIM900A_HARDWARE) {
    _status = "DISABLED_BY_CONFIG";
    Serial.println("[GSM] Physical SIM900A disabled. SMS handled via TextBee Gateway + Brevo Email.");
    return;
  }

  _lastInitAttempt = millis();
  Serial.println("[GSM] Initializing SIM900A hardware module...");

  const unsigned long bauds[] = { 115200, 9600 };
  bool connected = false;

  for (unsigned long b : bauds) {
    if (syncBaud(b)) {
      connected = true;
      _baudRate = b;
      break;
    }
  }

  if (connected) {
    Serial.printf("[GSM] ✓ Synchronized and responding at %lu baud!\n", _baudRate);

    gsm.print("ATE0\r\n");
    readGsmResponse(300);
    gsm.print("AT+CMGF=1\r\n");
    readGsmResponse(300);
    gsm.print("AT+CSCS=\"GSM\"\r\n");
    readGsmResponse(300);

    if (checkSIMCard()) {
      _initialized = true;
      checkSignalQuality();
      checkSMSC();

      int regStat = getNetworkRegistrationStatus();
      if (regStat == 1 || regStat == 5) {
        _status = "READY";
        Serial.printf("[GSM] ✓ Network Registered & READY (CREG=%d). Module ready for SMS!\n", regStat);
      } else {
        _status = "SEARCHING_NETWORK";
        Serial.printf("[GSM] Searching for cellular network... (CREG=%d)\n", regStat);
      }
    } else {
      _initialized = true;
      _status = "NO_SIM";
      Serial.println("[GSM] SIM900A responded, but SIM card not detected or not ready.");
    }
  } else {
    _initialized = false;
    _status = "NOT_DETECTED";
    Serial.println("[GSM] Physical SIM900A module not responding at 115200 or 9600 baud.");
    Serial.println("[GSM] (Cloud TextBee SMS & Brevo Email remain active over Wi-Fi).");
  }
}

void GSMManager::update() {
  if (!ENABLE_SIM900A_HARDWARE) return;

  // Print any incoming unsolicited messages from SIM900A (e.g. RDY, +CPIN: READY, +CFUN: 1)
  while (gsm.available()) {
    String line = gsm.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      Serial.printf("[GSM] Module: %s\n", line.c_str());
    }
  }

  if (!_initialized && (millis() - _lastInitAttempt >= GSM_RETRY_INTERVAL_MS)) {
    begin();
    return;
  }

  if (_initialized && _status == "SEARCHING_NETWORK") {
    if (millis() - _lastNetworkCheck >= 10000) {
      _lastNetworkCheck = millis();
      int regStat = getNetworkRegistrationStatus();
      if (regStat == 1 || regStat == 5) {
        _status = "READY";
        Serial.printf("[GSM] ✓ SIM900A connected to cell tower! (CREG=%d, Status: READY)\n", regStat);
      } else {
        Serial.printf("[GSM] Still searching for network... (CREG=%d)\n", regStat);
      }
    }
  }
}

bool GSMManager::sendSMS(const String& message) {
  if (!ENABLE_SIM900A_HARDWARE) {
    Serial.println("[GSM] Physical SIM900A is disabled in configuration.");
    return false;
  }
  if (!_initialized) {
    Serial.println("[GSM] Physical SIM900A is not initialized.");
    return false;
  }
  if (_status != "READY") {
    Serial.printf("[GSM] ⚠️ Cannot send SMS: Cellular network not registered yet (Status: %s). Waiting for signal...\n", _status.c_str());
    return false;
  }

  Serial.println("\n=======================================================");
  Serial.printf("[GSM] 📤 INITIATING SIM900A SMS BROADCAST (%d RECIPIENT(S))\n", _totalNumbers);
  Serial.println("=======================================================");

  bool allSuccess = true;
  for (int i = 0; i < _totalNumbers; i++) {
    Serial.printf("[GSM] [%d/%d] Preparing SMS to: %s ...\n", i + 1, _totalNumbers, _phoneNumbers[i]);

    if (!ensureCommunication()) {
      Serial.printf("[GSM] ✗ Failed: SIM900A not responding to AT commands for %s\n", _phoneNumbers[i]);
      allSuccess = false;
      continue;
    }

    while (gsm.available()) gsm.read();
    gsm.print("AT+CMGF=1\r\n");
    readGsmResponse(300);

    gsm.print("AT+CMGS=\"");
    gsm.print(_phoneNumbers[i]);
    gsm.print("\"\r\n");
    String promptResponse = readGsmResponse(3000);
    if (promptResponse.indexOf(">") < 0) {
      Serial.printf("[GSM] ✗ Failed to get '>' prompt from SIM900A for %s. Response: %s\n",
                    _phoneNumbers[i], promptResponse.c_str());
      allSuccess = false;
      continue;
    }

    gsm.print(message);
    gsm.write(26); // Ctrl+Z
    Serial.printf("[GSM] Payload transmitted to %s. Awaiting cell tower confirmation...\n", _phoneNumbers[i]);
    String sendResponse = readGsmResponse(15000);
    sendResponse.trim();

    bool success = sendResponse.indexOf("+CMGS:") >= 0 && sendResponse.indexOf("OK") >= 0;

    if (success) {
      Serial.printf("[GSM] ✓ SMS DELIVERED SUCCESSFULLY to %s!\n", _phoneNumbers[i]);
      Serial.printf("[GSM] Carrier Response: %s\n\n", sendResponse.c_str());
    } else {
      Serial.printf("[GSM] ✗ SMS DELIVERY FAILED to %s.\n", _phoneNumbers[i]);
      Serial.printf("[GSM] Carrier Response: %s\n\n", sendResponse.c_str());
      allSuccess = false;
    }
    delay(1500);
  }
  Serial.println("=======================================================\n");
  return allSuccess;
}

bool GSMManager::isReady() const {
  return _initialized && (_status == "READY");
}

String GSMManager::getStatus() const {
  return _status;
}

// ===================== WIFI MANAGER =====================

class WiFiManager {
public:
  WiFiManager(const char* ssid, const char* password);
  void begin();
  void update();
  bool isConnected() const;
  String getStatus() const;
  int getRSSI() const;
  String getIP() const;

private:
  const char* _ssid;
  const char* _password;
  unsigned long _lastAttempt;
  bool _wasConnected;
};

WiFiManager::WiFiManager(const char* ssid, const char* password)
  : _ssid(ssid), _password(password), _lastAttempt(0), _wasConnected(false) {
}

void WiFiManager::begin() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Prevents ESP32-S3 radio from sleeping during WPA2 authentication handshake
  WiFi.begin(_ssid, _password);
  _lastAttempt = millis();
  Serial.printf("[WiFi] Connecting to %s...\n", _ssid);
}

void WiFiManager::update() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!_wasConnected) {
      _wasConnected = true;
      Serial.printf("[WiFi] Connected! IP: %s | RSSI: %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
    }
    return;
  }

  if (millis() - _lastAttempt < WIFI_RETRY_INTERVAL_MS) return;
  _lastAttempt = millis();

  if (_wasConnected) {
    Serial.println("[WiFi] Disconnected. Reconnecting...");
    _wasConnected = false;
  } else {
    Serial.printf("[WiFi] Re-attempting connection to %s...\n", _ssid);
  }

  WiFi.disconnect();
  delay(100);
  WiFi.begin(_ssid, _password);
}

bool WiFiManager::isConnected() const {
  return WiFi.status() == WL_CONNECTED;
}

String WiFiManager::getStatus() const {
  if (WiFi.status() == WL_CONNECTED) return "CONNECTED";
  if (WiFi.status() == WL_DISCONNECTED) return "DISCONNECTED";
  return "CONNECTING";
}

int WiFiManager::getRSSI() const {
  return WiFi.RSSI();
}

String WiFiManager::getIP() const {
  return WiFi.localIP().toString();
}

// ===================== API CLIENT (TEXTBEE & BREVO DISPATCH) =====================

struct TelemetryData {
  const char* deviceId;
  int mq2Raw;
  int mq2RawActual;
  int mq2Baseline;
  float temperatureC;
  float humidityPct;
  bool alarmActive;
  String alarmReason;
  bool relayStatus;
  String sensorStatus;
  bool wifiConnected;
  String wifiStatus;
  String gsmStatus;
  unsigned long uptimeMs;
};

class APIClient {
public:
  APIClient(const char* apiUrl);
  bool sendTelemetry(const TelemetryData& data, bool isEmergency = false);
  String getLastStatus() const;
  int getLastResponseCode() const;

private:
  const char* _apiUrl;
  String _lastStatus;
  int _lastResponseCode;
};

APIClient::APIClient(const char* apiUrl)
  : _apiUrl(apiUrl), _lastStatus("NOT_SENT"), _lastResponseCode(0) {
}

bool APIClient::sendTelemetry(const TelemetryData& data, bool isEmergency) {
  HTTPClient http;
  http.setTimeout(isEmergency ? 8000 : 6000);
  http.setReuse(false);

  bool isHttps = (strncmp(_apiUrl, "https://", 8) == 0);
  int code = 0;

  JsonDocument doc;
  doc["deviceId"] = data.deviceId;
  doc["mq2Raw"] = data.mq2Raw;
  doc["mq2RawActual"] = data.mq2RawActual;
  doc["mq2Baseline"] = data.mq2Baseline;
  if (isnan(data.temperatureC)) doc["temperatureC"] = nullptr;
  else doc["temperatureC"] = data.temperatureC;
  if (isnan(data.humidityPct)) doc["humidityPct"] = nullptr;
  else doc["humidityPct"] = data.humidityPct;
  doc["alarmActive"] = data.alarmActive;
  doc["alarmReason"] = data.alarmReason;
  doc["relayStatus"] = data.relayStatus;
  doc["sensorStatus"] = data.sensorStatus;
  doc["wifiConnected"] = data.wifiConnected;
  doc["wifiStatus"] = data.wifiStatus;
  doc["gsmStatus"] = data.gsmStatus;
  doc["uptimeMs"] = data.uptimeMs;

  String payload;
  serializeJson(doc, payload);

  if (isHttps) {
    std::unique_ptr<WiFiClientSecure> client(new WiFiClientSecure);
    if (!client) {
      Serial.println("[HTTP] Failed to allocate SSL client in memory.");
      return false;
    }
    client->setInsecure();
    client->setTimeout(6000);

    if (!http.begin(*client, _apiUrl)) {
      _lastStatus = "HTTP_INIT_FAILED";
      _lastResponseCode = 0;
      Serial.println("[HTTP] Could not initialize SSL connection to backend.");
      return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Connection", "close");

    code = http.POST(payload);
    http.end();
  } else {
    WiFiClient client;
    if (!http.begin(client, _apiUrl)) {
      _lastStatus = "HTTP_INIT_FAILED";
      _lastResponseCode = 0;
      Serial.println("[HTTP] Could not initialize connection to backend.");
      return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Connection", "close");

    code = http.POST(payload);
    http.end();
  }

  _lastResponseCode = code;

  if (code >= 200 && code < 300) {
    _lastStatus = "SUCCESS";
    Serial.printf("[HTTP] ✓ Cloud sync OK (HTTP %d)\n", code);
    return true;
  } else {
    _lastStatus = "HTTP_ERROR";
    Serial.printf("[HTTP] ✗ Cloud sync failed (code=%d: %s)\n", code, http.errorToString(code).c_str());
    return false;
  }
}

String APIClient::getLastStatus() const {
  return _lastStatus;
}

int APIClient::getLastResponseCode() const {
  return _lastResponseCode;
}

// ===================== MODULE INSTANCES =====================
SensorManager sensorManager(DHT_PIN, DHT_TYPE, MQ2_PIN);
AlarmManager alarmManager(RELAY_PIN, RELAY_ACTIVE_LOW);
GSMManager gsmManager(GSM_RX_PIN, GSM_TX_PIN, ALERT_PHONE_NUMBERS, TOTAL_PHONE_NUMBERS);
WiFiManager wifiManager(WIFI_SSID, WIFI_PASSWORD);
APIClient apiClient(API_URL);

// ===================== TIMING & STATE VARIABLES =====================
unsigned long lastSensorRead = 0;
unsigned long lastTelemetrySend = 0;
unsigned long lastSmsSent = 0;
bool previousAlarmState = false;

int mq2Raw = 0;        // baseline-delta value sent to dashboard (always ~0 in clean air)
float temperatureC = NAN;
float humidityPct = NAN;
String sensorStatus = "OK";

// ── MQ2 Baseline Calibration State ───────────────────────────────────────────
int   mq2Baseline       = -1;    // -1 = not yet calibrated
long  mq2CalibSum       = 0;
int   mq2CalibSamples   = 0;
bool  mq2Calibrated     = false;
int   mq2RawActual      = 0;     // the true hardware ADC reading (pre-baseline subtraction)

// Helper to bundle telemetry
TelemetryData buildCurrentTelemetry() {
  TelemetryData telemetry;
  telemetry.deviceId = DEVICE_ID;
  telemetry.mq2Raw = mq2Raw;
  telemetry.mq2RawActual = mq2RawActual;
  telemetry.mq2Baseline = mq2Baseline;
  telemetry.temperatureC = temperatureC;
  telemetry.humidityPct = humidityPct;
  telemetry.alarmActive = alarmManager.isActive();
  telemetry.alarmReason = alarmManager.getReasonString();
  telemetry.relayStatus = alarmManager.getRelayStatus();
  telemetry.sensorStatus = sensorStatus;
  telemetry.wifiConnected = wifiManager.isConnected();
  telemetry.wifiStatus = wifiManager.getStatus();
  telemetry.gsmStatus = gsmManager.getStatus();
  telemetry.uptimeMs = millis();
  return telemetry;
}

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n==================================================");
  Serial.println("  ESP32-S3 Fire Alarm & Disaster Warning System  ");
  Serial.println("  Channels: TextBee SMS (Free) + Brevo Email     ");
  Serial.println("==================================================");

  sensorManager.begin();
  Serial.println("[INIT] MQ-2 & DHT22 sensors armed.");

  alarmManager.begin();
  Serial.println("[INIT] Buzzer / Relay output configured.");

  wifiManager.begin();

  if (ENABLE_SIM900A_HARDWARE) {
    Serial.printf("[INIT] SIM900A Alert Recipients (%d configured):\n", TOTAL_PHONE_NUMBERS);
    for (int i = 0; i < TOTAL_PHONE_NUMBERS; i++) {
      Serial.printf("       [%d] %s\n", i + 1, ALERT_PHONE_NUMBERS[i]);
    }
    gsmManager.begin();
  } else {
    Serial.println("[INIT] Physical GSM disabled. Using Wi-Fi TextBee & Brevo.");
  }

  Serial.printf("[INIT] Backend Target: %s\n", API_URL);
  Serial.printf("[INIT] Boot Warmup: %lus | Smoke Alarm Threshold: >= %d ADC\n",
                MQ2_WARMUP_MS / 1000UL, MQ2_ALARM_THRESHOLD);
  Serial.printf("[INIT] Temperature Alarm Threshold: >= %.1f deg C\n", TEMP_THRESHOLD_C);
  Serial.println("[INIT] Buzzer triggers when Smoke >= 800 ADC OR Temp >= 40.0C.");
  Serial.println("[INIT] Setup complete.\n");
}

void loop() {
  wifiManager.update();
  if (ENABLE_SIM900A_HARDWARE) {
    gsmManager.update();
  }

  unsigned long now = millis();

  // 1. Periodic Sensor Reading & Alarm Evaluation
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;

    SensorReadings readings = sensorManager.read();
    mq2Raw        = readings.mq2Raw;      // Live physical ADC reading (e.g. 466 ADC)
    mq2RawActual  = readings.mq2Raw;
    temperatureC  = readings.temperatureC;
    humidityPct   = readings.humidityPct;
    sensorStatus  = readings.sensorStatus;

    // ── Real-Time Alarm Evaluation (Continuous time-to-time active monitoring) ──
    bool risingEdge = alarmManager.evaluate(mq2Raw, temperatureC, humidityPct, MQ2_ALARM_THRESHOLD, TEMP_THRESHOLD_C);

    // ── CRITICAL DISPATCH: FAST CLOUD TRANSMISSION (TEXTBEE & BREVO) ──
    // When alarm fires, do NOT wait for the 3-second cycle. Dispatch immediately!
    if (risingEdge) {
      Serial.println("\n[ALERT] 🚨 FIRE/SMOKE HAZARD DETECTED! INITIATING EMERGENCY DISPATCH...");
      if (wifiManager.isConnected()) {
        TelemetryData emergencyData = buildCurrentTelemetry();
        bool sent = apiClient.sendTelemetry(emergencyData, true);
        if (sent) {
          lastTelemetrySend = now; // Reset periodic timer
        }
      } else {
        Serial.println("[ALERT] Wi-Fi offline - Emergency cloud dispatch queued upon reconnection.");
      }
    }

    // Physical GSM module fallback broadcast (if enabled and registered)
    if (ENABLE_SIM900A_HARDWARE && alarmManager.isActive()) {
      if (lastSmsSent == 0 || (now - lastSmsSent >= SMS_COOLDOWN_MS)) {
        String message = "BABALA SA SUNOG (ESP32 Alert)\r\n";
        message += "Banta: " + alarmManager.getReasonString() + "\r\n";
        message += "MQ2: " + String(mq2Raw) + " | Temp: " + String(temperatureC, 1) + "C\r\n";
        message += "Inspeksyun agad ang lugar!";

        if (!gsmManager.isReady()) {
          Serial.printf("[GSM] ⚠️ Physical SIM900A not ready (Status: %s). SMS sent via Wi-Fi TextBee gateway.\n",
                        gsmManager.getStatus().c_str());
        } else if (gsmManager.sendSMS(message)) {
          lastSmsSent = millis();
          Serial.println("[GSM] ✓ Physical SIM900A backup SMS broadcast completed successfully.");
        }
      }
    } else if (!alarmManager.isActive() && lastSmsSent > 0) {
      lastSmsSent = 0;
    }

    previousAlarmState = alarmManager.isActive();

    Serial.printf("[SENSOR] MQ-2 ADC=%d | Temp=%.1f C | Hum=%.1f %% | Alarm=%s (%s) | Wi-Fi=%s\n",
                  mq2Raw, temperatureC, humidityPct,
                  alarmManager.isActive() ? "ACTIVE" : "OFF",
                  alarmManager.getReasonString().c_str(),
                  wifiManager.getStatus().c_str());
  }

  // 2. Regular Telemetry Interval (Dashboard Live Updates)
  if (now - lastTelemetrySend >= TELEMETRY_INTERVAL_MS) {
    lastTelemetrySend = now;

    if (wifiManager.isConnected()) {
      TelemetryData telemetry = buildCurrentTelemetry();
      apiClient.sendTelemetry(telemetry, false);
    }
  }

  delay(5);
}
