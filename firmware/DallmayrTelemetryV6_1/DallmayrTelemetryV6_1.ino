/*
  Dallmayr South Africa - Telemetry V6.1 VODACOM DATA TEST
  Quoted-hardware validation build

  PRIMARY TARGET
  --------------
  - ESP32-S3 WROOM-1 N16R8 development board
  - DFRobot Gravity Air780E / Air780EU 4G Cat-1 module (UART + external 5 V supply)
  - SP3232EET RS-232 transceiver for DEX/UCS
  - TLP521-2 isolated machine interface reserved for MDB / isolated digital I/O
  - Wide-input protected DC/DC supply: vending-machine rail -> regulated 5 V

  BACKEND
  -------
  - Supabase telemetry-config: remote live/daily/monthly policy control
  - Supabase telemetry-ingest: cumulative counter, heartbeat and fault-state ingest
  - Per-transport application byte counters are included with every ingest.
  - SIM DATA TEST sends two harmless simulation snapshots over cellular only.
  - No database row is created for every vend; cumulative counters are uploaded.

  IMPORTANT MDB NOTE
  ------------------
  MDB is 9600 baud with an additional mode/address bit. ESP32-S3's normal
  HardwareSerial API supports 5-8 data bits, not a native MDB 9th mode bit.
  Therefore this sketch DOES NOT pretend that a normal UART is a complete MDB
  controller. The MDB GPIO pins are reserved for a tested opto-isolated 9-bit
  software/bridge driver. DEX is implemented as the first direct machine route.

  NEVER connect the vending-machine power rail, MDB bus, DEX/RS-232 levels or
  any 24-45 V machine signal directly to ESP32 GPIO.

  REQUIRED ARDUINO LIBRARY
  ------------------------
  - ArduinoJson 7.x
  - Preferences is supplied by the ESP32 Arduino core.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_mac.h>
#include <math.h>

// -----------------------------------------------------------------------------
// Firmware identity / backend preset
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// PRODUCTION SETTINGS
// -----------------------------------------------------------------------------
// Secrets are NOT embedded in this production build.
// Configure Wi-Fi at runtime with:
//   WIFI SET <ssid>|<password>
// The credentials are stored in ESP32 NVS and are never printed back.
//
// If this ESP32 is already enrolled, its per-device credential remains in NVS.
// If NVS is erased/new hardware is commissioned, provision a one-time token with:
//   ENROLL TOKEN <one-time-token>
// The token is erased from NVS immediately after successful enrollment.
//
#define DALLMAYR_WIFI_SSID              ""
#define DALLMAYR_WIFI_PASSWORD          ""
#define DALLMAYR_CELL_APN               "internet"
#define DALLMAYR_MACHINE_SERIAL         ""
#define DALLMAYR_ENROLLMENT_TOKEN       ""
#define DALLMAYR_SUPABASE_ANON_KEY      ""
//
// Validation mode: normal machine I/O remains locked, while the dedicated
// SIM DATA TEST command may send an isolated simulation_snapshot pair.
#define DALLMAYR_SIM_DATA_TEST_ENABLED  true
//
// IMPORTANT: real machine I/O is compile-time locked OFF until MDB/DEX wiring,
// isolation and protocol driver are physically verified. Network, heartbeat,
// remote policy and GNSS location are fully active with this set to false.
#define DALLMAYR_MACHINE_IO_ENABLED     false
// Prevent console-generated fake faults/recoveries in production.
#define DALLMAYR_ALLOW_TEST_COMMANDS    false
//
// Generic NMEA GNSS receiver. Requires a physical GNSS module.
#define DALLMAYR_GNSS_ENABLED           true
#define DALLMAYR_GNSS_BAUD              9600UL
#define DALLMAYR_GNSS_RX_PIN            6   // ESP32 RX <- GNSS TX
#define DALLMAYR_GNSS_TX_PIN            7   // ESP32 TX -> GNSS RX (often optional)
// 0/0 disables manual location fallback; production never invents a GPS fix.
#define DALLMAYR_FALLBACK_LATITUDE      0.0
#define DALLMAYR_FALLBACK_LONGITUDE     0.0
// -----------------------------------------------------------------------------
// END PRODUCTION SETTINGS
// -----------------------------------------------------------------------------
// ----------------------------------------------------------------------------- -----------------------------------------------------------------------------

static const char* FIRMWARE_VERSION = "6.1.0-esp32s3-vodacom-data-test";
static const char* API_HOST = "egbiiizxsqlarqpnzxxs.supabase.co";
static const char* ENROLL_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-enroll";
static const char* INGEST_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-ingest";
static const char* CONFIG_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-config";

// Device identity is derived automatically from the ESP32 factory eFuse MAC.
// The database UUID remains server-generated; the public device code becomes:
// DLM-ESP32-XXXXXXXXXXXX
String hardwareUid;
String deviceId;
String deviceKey;
String enrollmentToken;
String supabaseAnonKey = DALLMAYR_SUPABASE_ANON_KEY;

// In production mode this is supplied from the USER SETTINGS section above. Later the MDB/DEX driver can
// replace it with a machine-reported serial when the machine exposes one.
String reportedMachineSerial = DALLMAYR_MACHINE_SERIAL;

// Production Wi-Fi credentials are loaded from ESP32 NVS. Compile-time values are blank fallbacks.
String wifiSsid = DALLMAYR_WIFI_SSID;
String wifiPassword = DALLMAYR_WIFI_PASSWORD;

// Public-network SIMs normally obtain APN automatically.
static const char* DEFAULT_APN = DALLMAYR_CELL_APN;

// -----------------------------------------------------------------------------
// ESP32 pin assignment
// -----------------------------------------------------------------------------
// ESP32-S3 has three UARTs. Serial/USB is used for diagnostics, UART1 for the
// Air780E/Air780EU and UART2 for DEX through the SP3232EET.
// Pins can be changed here if the quoted development board breaks them out on
// different headers.

/*
  C130001 10-WIRE WORKING MAP — VERIFY WITH CONTINUITY TEST BEFORE CONNECTING
  ---------------------------------------------------------------------------
  Nayax publicly identifies C130001 as an MDB/YDEX cable, but the internal
  10-wire colour-to-signal map below is a PROTOTYPE WORKING MAP and must be
  confirmed on YOUR cable before cutting/splicing.

  C130001 cable colours / intended destination:

    RED     -> MDB machine power +24..34 VDC -> BMT DC/DC IN+
               NEVER to an ESP32 GPIO or 5 V pin directly.

    GREY    -> MDB machine power return / 0 V -> BMT DC/DC IN-
               This is the machine-side power return.

    YELLOW  -> MDB pin 3 / N.C. in the working map -> leave disconnected.

    PURPLE  -> MDB data line (working map: Master Receive)
               -> isolated MDB interface / 9-bit bridge
               -> bridge output to ESP32 MDB_RX_PIN below.
               NEVER connect this wire directly to ESP32 GPIO.

    BLUE    -> MDB data line (working map: Master Transmit)
               -> isolated MDB interface / 9-bit bridge
               -> bridge input from ESP32 MDB_TX_PIN below.
               NEVER connect this wire directly to ESP32 GPIO.

    BLACK   -> MDB communications common
               -> isolated MDB interface COM/reference.
               Do not assume this is interchangeable with DEX ground until
               continuity and the interface design have been verified.

    ORANGE  -> DEX TX FROM MACHINE
               -> SP3232 R1IN (RS-232 side)
               -> SP3232 R1OUT (TTL side)
               -> ESP32 DEX_RX_PIN below.
               NEVER connect ORANGE directly to ESP32 GPIO.

    BROWN   -> DEX RX TO MACHINE
               <- SP3232 T1OUT (RS-232 side)
               <- SP3232 T1IN (TTL side)
               <- ESP32 DEX_TX_PIN below.
               NEVER connect BROWN directly to ESP32 GPIO.

    GREEN   -> DEX GND
               -> SP3232 GND / logic-side reference as required by the
                  finished DEX interface design.

    WHITE   -> shield / drain / spare in the working map.
               VERIFY with continuity meter before use. Do not connect to
               ESP32 until its actual termination is confirmed.

  Cellular wiring is independent of the C130001 cable:
    Air780E/Air780EU TX -> ESP32 CELL_RX_PIN
    Air780E/Air780EU RX <- ESP32 CELL_TX_PIN
*/

#if CONFIG_IDF_TARGET_ESP32S3
// ---------------- ESP32-S3 WROOM-1 N16R8 prototype pin assignment ----------------
static const int CELL_RX_PIN = 1;   // GPIO1 <- Air780 TX (confirmed prototype wiring)
static const int CELL_TX_PIN = 2;   // GPIO2 -> Air780 RX (confirmed prototype wiring)

static const int DEX_RX_PIN  = 17;  // GPIO17 <- SP3232 R1OUT <- C130001 ORANGE (DEX TX from machine)
static const int DEX_TX_PIN  = 18;  // GPIO18 -> SP3232 T1IN  -> C130001 BROWN  (DEX RX to machine)

static const int MDB_RX_PIN  = 4;   // GPIO4  <- ISOLATED MDB bridge <- C130001 PURPLE (working map)
static const int MDB_TX_PIN  = 5;   // GPIO5  -> ISOLATED MDB bridge -> C130001 BLUE   (working map)
                                    // C130001 BLACK = MDB COM/reference at the isolated MDB interface.
                                    // RED/GREY go to BMT DC/DC, not to these GPIOs.
#elif CONFIG_IDF_TARGET_ESP32
// Classic ESP32-WROOM compatibility for bench development.
// Same C130001 signal paths as above; only the ESP32 GPIO numbers differ.
static const int CELL_RX_PIN = 26;  // GPIO26 <- Air780E/Air780EU TX
static const int CELL_TX_PIN = 27;  // GPIO27 -> Air780E/Air780EU RX
static const int DEX_RX_PIN  = 32;  // GPIO32 <- SP3232 R1OUT <- C130001 ORANGE
static const int DEX_TX_PIN  = 33;  // GPIO33 -> SP3232 T1IN  -> C130001 BROWN
static const int MDB_RX_PIN  = 34;  // GPIO34 <- isolated MDB bridge <- C130001 PURPLE (working map)
static const int MDB_TX_PIN  = 25;  // GPIO25 -> isolated MDB bridge -> C130001 BLUE   (working map)
#else
#error "This quoted-hardware sketch targets ESP32-S3 or classic ESP32."
#endif

static const uint32_t DEBUG_BAUD = 115200;
static const uint32_t CELL_BAUD  = 115200;
static const uint32_t DEFAULT_DEX_BAUD = 9600;

HardwareSerial CellSerial(1);
HardwareSerial DexSerial(2);
HardwareSerial GnssSerial0(0);
HardwareSerial* gnssSerial = nullptr;
Preferences prefs;

struct GnssFix {
  bool valid = false;
  double latitude = 0.0;
  double longitude = 0.0;
  float altitudeM = NAN;
  float speedMps = NAN;
  uint8_t satellites = 0;
  float hdop = NAN;
  float accuracyM = NAN;
  uint32_t lastFixMs = 0;
  char utcIso[25] = {0};
};

GnssFix gnssFix;
String gnssLine;
uint32_t lastLocationUploadMs = 0;

// -----------------------------------------------------------------------------
// Limits / scheduling
// -----------------------------------------------------------------------------

static const uint16_t MAX_COUNTERS = 96;
static const uint8_t MAX_ITEMS_PER_UPLOAD = 16; // backend limit
static const uint8_t MAX_FAULTS = 24;
static const size_t DEX_TEXT_MAX = 12288;
static const uint32_t CONFIG_RETRY_MS = 60000UL;
static const uint32_t CELL_RETRY_MS = 30000UL;
static const uint32_t DEX_REQUEST_TIMEOUT_MS = 15000UL;
static const uint32_t DEX_FRAME_IDLE_MS = 1800UL;
static const uint32_t COUNTER_SAVE_DEBOUNCE_MS = 5000UL;
static const uint32_t DATA_USAGE_SAVE_INTERVAL_MS = 300000UL;

// -----------------------------------------------------------------------------
// Runtime configuration / state
// -----------------------------------------------------------------------------

enum MachineInterface : uint8_t {
  IFACE_DEX = 1,
  IFACE_MDB = 2,
  IFACE_NORMALIZED_UART = 3,
  IFACE_PULSE = 4,
  IFACE_DISABLED = 5
};

struct RuntimePolicy {
  char mode[12];
  char source[16];
  char profileId[48];
  uint32_t counterIntervalMinutes;
  uint32_t heartbeatIntervalMinutes;
  uint32_t configRefreshMinutes;
  bool immediateFaults;
  bool immediateRecovery;
  bool counterDue;
  bool heartbeatDue;
  char transportPreference[12];
  bool wifiEnabled;
  bool cellularEnabled;
  bool locationEnabled;
  uint32_t locationIntervalMinutes;
  uint32_t locationMinMoveM;
  bool locationDue;
};

struct CounterEntry {
  char selection[41];
  char product[65];
  uint32_t priceCents;
  uint64_t soldTotal;
  uint64_t failedTotal;
  uint64_t revenueCentsTotal;
  bool used;
  bool dirty;
};

struct LocalFault {
  char code[41];
  char severity[12];
  bool active;
  bool used;
  bool pendingUpload;
};

RuntimePolicy policy;
CounterEntry counters[MAX_COUNTERS];
LocalFault faults[MAX_FAULTS];
uint16_t counterCount = 0;

char counterEpoch[33] = {0};
char bootId[33] = {0};
char dataUsageEpoch[33] = {0};
uint32_t sequenceNumber = 0;
uint64_t cellularApplicationTxBytes = 0;
uint64_t cellularApplicationRxBytes = 0;
uint64_t wifiApplicationTxBytes = 0;
uint64_t wifiApplicationRxBytes = 0;
bool dataUsageStorageDirty = false;
uint32_t lastDataUsageSaveMs = 0;
MachineInterface machineInterface = IFACE_DISABLED;
uint32_t dexBaud = DEFAULT_DEX_BAUD;
String apn = DEFAULT_APN;
String cellularModel;
String cellularOperator;
uint32_t lastWifiAttemptMs = 0;
bool wifiBeginIssued = false;   // Prevent repeated WiFi.begin() while STA is still connecting.
bool wifiRadioDisabled = false;
static const uint32_t WIFI_STATUS_LOG_MS = 60000UL;

uint32_t lastConfigAttemptMs = 0;
uint32_t lastConfigSuccessMs = 0;
uint32_t lastCellAttemptMs = 0;
uint32_t lastCounterSaveMs = 0;
bool counterStorageDirty = false;
bool cellReady = false;
bool counterUploadRequested = false;
bool heartbeatUploadRequested = false;
uint32_t lastEnrollmentAttemptMs = 0;
uint32_t lastSimulationUploadMs = 0;
uint8_t simulationSelectionCursor = 0;
uint64_t simulationSold[3] = { 100, 75, 50 };
uint64_t simulationRevenue[3] = { 250000, 187500, 125000 };

static const uint32_t ENROLL_RETRY_MS = 30000UL;

// DEX receiver state.
String dexText;
uint32_t lastDexByteMs = 0;
uint32_t dexRequestStartedMs = 0;
bool dexRequestActive = false;
bool dexSawDataThisRequest = false;
bool dexInBlock = false;
bool dexSawDle = false;
uint8_t dexCrcBytesRemaining = 0;
bool dexAckToggle = true;  // First block ACK is DLE '1', then alternates.
int dexDecimalPlaces = 2;

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

void copyText(char* out, size_t outSize, const String& value) {
  if (!out || outSize == 0) return;
  value.substring(0, outSize - 1).toCharArray(out, outSize);
  out[outSize - 1] = '\0';
}

String trimCopy(String value) {
  value.trim();
  return value;
}

void makeRandomId(char* out, size_t outSize) {
  uint64_t r = (static_cast<uint64_t>(esp_random()) << 32) | esp_random();
  snprintf(out, outSize, "%08lX%08lX",
           static_cast<unsigned long>(r >> 32),
           static_cast<unsigned long>(r & 0xFFFFFFFFULL));
}

void initializeDeviceIdentity() {
  uint8_t mac[6] = {0};
  if (esp_efuse_mac_get_default(mac) != ESP_OK) {
    Serial.println(F("FATAL: could not read ESP32 factory MAC/eFuse identity."));
    return;
  }

  char uid[13] = {0};
  snprintf(uid, sizeof(uid), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  hardwareUid = uid;
  deviceId = "DLM-ESP32-" + hardwareUid;
}

bool deviceEnrolled() {
  return deviceId.length() > 0 && deviceKey.length() >= 20;
}

void saveDeviceCredential() {
  prefs.begin("dallmayr", false);
  prefs.putString("device_key", deviceKey);
  prefs.end();
}

const char* interfaceName(MachineInterface iface) {
  switch (iface) {
    case IFACE_DEX: return "dex";
    case IFACE_MDB: return "mdb";
    case IFACE_NORMALIZED_UART: return "normalized_uart";
    case IFACE_PULSE: return "pulse";
    case IFACE_DISABLED: return "disabled";
    default: return "unknown";
  }
}

MachineInterface parseInterface(String value) {
  value.trim();
  value.toUpperCase();
  if (value == "DEX") return IFACE_DEX;
  if (value == "MDB") return IFACE_MDB;
  if (value == "NORMALIZED" || value == "NORMALIZED_UART") return IFACE_NORMALIZED_UART;
  if (value == "PULSE") return IFACE_PULSE;
  if (value == "DISABLED") return IFACE_DISABLED;
  return static_cast<MachineInterface>(0);
}

uint64_t toUInt64(const String& s) {
  return strtoull(s.c_str(), nullptr, 10);
}

uint64_t dexValueToCents(uint64_t raw) {
  if (dexDecimalPlaces == 2) return raw;
  if (dexDecimalPlaces < 2) {
    for (int i = dexDecimalPlaces; i < 2; ++i) raw *= 10ULL;
    return raw;
  }
  for (int i = 2; i < dexDecimalPlaces; ++i) raw /= 10ULL;
  return raw;
}

String fieldAt(const String& line, int wantedIndex) {
  int fieldIndex = 0;
  int start = 0;
  for (int i = 0; i <= line.length(); ++i) {
    if (i == line.length() || line.charAt(i) == '*') {
      if (fieldIndex == wantedIndex) return line.substring(start, i);
      fieldIndex++;
      start = i + 1;
    }
  }
  return "";
}

// -----------------------------------------------------------------------------
// Persistent storage (ESP32 NVS)
// -----------------------------------------------------------------------------

void saveCoreSettings() {
  prefs.begin("dallmayr", false);
  prefs.putString("apn", apn);
  prefs.putUChar("iface", static_cast<uint8_t>(machineInterface));
  prefs.putULong("dexbaud", dexBaud);
  prefs.putString("epoch", counterEpoch);
  prefs.putString("machine_sn", reportedMachineSerial);
  prefs.end();
}

void saveDataUsageNow() {
  prefs.begin("dallmayr", false);
  prefs.putString("usage_epoch", dataUsageEpoch);
  prefs.putULong64("cell_app_tx", cellularApplicationTxBytes);
  prefs.putULong64("cell_app_rx", cellularApplicationRxBytes);
  prefs.putULong64("wifi_app_tx", wifiApplicationTxBytes);
  prefs.putULong64("wifi_app_rx", wifiApplicationRxBytes);
  prefs.end();
  dataUsageStorageDirty = false;
  lastDataUsageSaveMs = millis();
}

void recordApplicationTransfer(const char* transport, size_t requestBytes, size_t responseBytes) {
  if (strcmp(transport, "cellular") == 0) {
    cellularApplicationTxBytes += static_cast<uint64_t>(requestBytes);
    cellularApplicationRxBytes += static_cast<uint64_t>(responseBytes);
  } else if (strcmp(transport, "wifi") == 0) {
    wifiApplicationTxBytes += static_cast<uint64_t>(requestBytes);
    wifiApplicationRxBytes += static_cast<uint64_t>(responseBytes);
  } else {
    return;
  }
  dataUsageStorageDirty = true;
}

void maintainDataUsageStorage() {
  if (!dataUsageStorageDirty) return;
  if (millis() - lastDataUsageSaveMs < DATA_USAGE_SAVE_INTERVAL_MS) return;
  saveDataUsageNow();
}

void saveNetworkProvisioning() {
  prefs.begin("dallmayr", false);
  prefs.putString("wifi_ssid", wifiSsid);
  prefs.putString("wifi_pass", wifiPassword);
  prefs.end();
}

void saveEnrollmentToken() {
  prefs.begin("dallmayr", false);
  if (enrollmentToken.length()) prefs.putString("enroll_token", enrollmentToken);
  else prefs.remove("enroll_token");
  prefs.end();
}

void saveSupabaseAnonKey() {
  prefs.begin("dallmayr", false);
  if (supabaseAnonKey.length()) prefs.putString("supabase_anon", supabaseAnonKey);
  else prefs.remove("supabase_anon");
  prefs.end();
}

void loadCoreSettings() {
  prefs.begin("dallmayr", true);
  apn = prefs.getString("apn", DEFAULT_APN);
  deviceKey = prefs.getString("device_key", "");
  wifiSsid = prefs.getString("wifi_ssid", DALLMAYR_WIFI_SSID);
  wifiPassword = prefs.getString("wifi_pass", DALLMAYR_WIFI_PASSWORD);
  enrollmentToken = prefs.getString("enroll_token", DALLMAYR_ENROLLMENT_TOKEN);
  supabaseAnonKey = prefs.getString("supabase_anon", DALLMAYR_SUPABASE_ANON_KEY);
  machineInterface = static_cast<MachineInterface>(prefs.getUChar("iface", IFACE_DISABLED));
  dexBaud = prefs.getULong("dexbaud", DEFAULT_DEX_BAUD);
  String epoch = prefs.getString("epoch", "");
  String usageEpoch = prefs.getString("usage_epoch", "");
  cellularApplicationTxBytes = prefs.getULong64("cell_app_tx", 0);
  cellularApplicationRxBytes = prefs.getULong64("cell_app_rx", 0);
  wifiApplicationTxBytes = prefs.getULong64("wifi_app_tx", 0);
  wifiApplicationRxBytes = prefs.getULong64("wifi_app_rx", 0);
  String storedMachineSerial = prefs.getString("machine_sn", "");
  prefs.end();

  reportedMachineSerial = String(DALLMAYR_MACHINE_SERIAL).length() ? String(DALLMAYR_MACHINE_SERIAL) : storedMachineSerial;
  if (!DALLMAYR_MACHINE_IO_ENABLED) machineInterface = IFACE_DISABLED;

  if (epoch.length() == 0) {
    makeRandomId(counterEpoch, sizeof(counterEpoch));
    saveCoreSettings();
  } else {
    copyText(counterEpoch, sizeof(counterEpoch), epoch);
  }

  if (usageEpoch.length() == 0) {
    makeRandomId(dataUsageEpoch, sizeof(dataUsageEpoch));
    saveDataUsageNow();
  } else {
    copyText(dataUsageEpoch, sizeof(dataUsageEpoch), usageEpoch);
  }
}

void saveCountersNow() {
  prefs.begin("dallmayr", false);
  prefs.putUShort("counter_n", counterCount);
  prefs.putBytes("counters", counters, sizeof(counters));
  prefs.end();
  counterStorageDirty = false;
  lastCounterSaveMs = millis();
}

void loadCounters() {
  memset(counters, 0, sizeof(counters));
  prefs.begin("dallmayr", true);
  uint16_t storedCount = prefs.getUShort("counter_n", 0);
  counterCount = storedCount > MAX_COUNTERS ? MAX_COUNTERS : storedCount;
  size_t len = prefs.getBytesLength("counters");
  if (len == sizeof(counters)) prefs.getBytes("counters", counters, sizeof(counters));
  prefs.end();

  // Every counter is safe to resend because the backend ingests cumulative values.
  for (uint16_t i = 0; i < counterCount; ++i) {
    if (counters[i].used) counters[i].dirty = true;
  }
}

void maintainCounterStorage() {
  if (!counterStorageDirty) return;
  if (millis() - lastCounterSaveMs < COUNTER_SAVE_DEBOUNCE_MS) return;
  saveCountersNow();
}

// -----------------------------------------------------------------------------
// Counter / fault tables
// -----------------------------------------------------------------------------

CounterEntry* findCounter(const String& selection) {
  for (uint16_t i = 0; i < counterCount; ++i) {
    if (counters[i].used && selection.equalsIgnoreCase(counters[i].selection)) return &counters[i];
  }
  return nullptr;
}

CounterEntry* getCounter(const String& selection) {
  CounterEntry* existing = findCounter(selection);
  if (existing) return existing;
  if (counterCount >= MAX_COUNTERS) return nullptr;

  CounterEntry& c = counters[counterCount++];
  memset(&c, 0, sizeof(c));
  c.used = true;
  c.dirty = true;
  copyText(c.selection, sizeof(c.selection), selection);
  counterStorageDirty = true;
  return &c;
}

void setCumulativeCounter(const String& selection,
                          uint64_t sold,
                          uint64_t revenueCents,
                          uint32_t configuredPriceCents,
                          const String& product) {
  CounterEntry* c = getCounter(selection);
  if (!c) {
    Serial.println(F("Counter table full; DEX product ignored."));
    return;
  }

  bool changed = c->soldTotal != sold || c->revenueCentsTotal != revenueCents ||
                 c->priceCents != configuredPriceCents || product != c->product;
  c->soldTotal = sold;
  c->revenueCentsTotal = revenueCents;
  c->priceCents = configuredPriceCents;
  if (product.length()) copyText(c->product, sizeof(c->product), product);
  if (changed) {
    c->dirty = true;
    counterStorageDirty = true;
  }
}

void incrementLocalVend(const String& selection, uint32_t priceCents, bool success) {
  CounterEntry* c = getCounter(selection);
  if (!c) return;
  if (success) {
    c->soldTotal++;
    c->revenueCentsTotal += priceCents;
  } else {
    c->failedTotal++;
  }
  c->priceCents = priceCents;
  c->dirty = true;
  counterStorageDirty = true;
}

LocalFault* findFault(const String& code) {
  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    if (faults[i].used && code.equalsIgnoreCase(faults[i].code)) return &faults[i];
  }
  return nullptr;
}

LocalFault* getFault(const String& code) {
  LocalFault* f = findFault(code);
  if (f) return f;
  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    if (!faults[i].used) {
      memset(&faults[i], 0, sizeof(LocalFault));
      faults[i].used = true;
      copyText(faults[i].code, sizeof(faults[i].code), code);
      return &faults[i];
    }
  }
  return nullptr;
}

// Forward declaration; fault changes use the cellular uploader below.
bool uploadFaultState(const String& code, bool active, const String& severity,
                      const String& source, const String& detail, const String& raw);

void setLocalFaultState(const String& code, bool active, String severity,
                        const String& source, const String& detail, const String& raw) {
  if (code.length() == 0) return;
  severity.toLowerCase();
  LocalFault* f = getFault(code);
  if (!f) return;

  bool stateChanged = f->active != active || !severity.equalsIgnoreCase(f->severity);
  f->active = active;
  copyText(f->severity, sizeof(f->severity), severity);
  if (!stateChanged && !f->pendingUpload) return;

  bool allowedNow = active ? policy.immediateFaults : policy.immediateRecovery;
  if (allowedNow && (cellReady || WiFi.status() == WL_CONNECTED) && uploadFaultState(code, active, severity, source, detail, raw)) {
    f->pendingUpload = false;
  } else {
    f->pendingUpload = true;
  }
}

void flushPendingFaults() {
  if (!cellReady && WiFi.status() != WL_CONNECTED) return;
  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    LocalFault& f = faults[i];
    if (!f.used || !f.pendingUpload) continue;
    if (uploadFaultState(f.code, f.active, f.severity, "queued", "Deferred fault state", "")) {
      f.pendingUpload = false;
    }
  }
}

// -----------------------------------------------------------------------------
// Air780E/Air780EU AT transport
// -----------------------------------------------------------------------------

void cellDrain(uint32_t quietMs = 50) {
  uint32_t last = millis();
  while (millis() - last < quietMs) {
    while (CellSerial.available()) {
      CellSerial.read();
      last = millis();
    }
    delay(1);
  }
}

String cellReadUntil(uint32_t timeoutMs, const char* token1 = nullptr,
                     const char* token2 = nullptr, bool echoDebug = false) {
  String response;
  uint32_t started = millis();
  while (millis() - started < timeoutMs) {
    while (CellSerial.available()) {
      char c = static_cast<char>(CellSerial.read());
      response += c;
      if (response.length() > 12000) response.remove(0, 3000);
      if (echoDebug) Serial.write(c);
      if (token1 && response.indexOf(token1) >= 0) return response;
      if (token2 && response.indexOf(token2) >= 0) return response;
    }
    delay(2);
  }
  return response;
}

bool cellCommand(const String& command, const char* expected = "OK",
                 uint32_t timeoutMs = 3000, bool tolerateError = false) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = cellReadUntil(timeoutMs, expected, "ERROR");
  if (response.indexOf(expected) >= 0) return true;
  if (tolerateError && response.indexOf("ERROR") >= 0) return true;
  Serial.print(F("CELL command failed: "));
  Serial.println(command);
  Serial.println(response);
  return false;
}

bool cellQueryContains(const String& command, const char* required, uint32_t timeoutMs = 3000) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = cellReadUntil(timeoutMs, "OK", "ERROR");
  return response.indexOf(required) >= 0;
}

int readCellCsq() {
  cellDrain();
  CellSerial.print("AT+CSQ\r\n");
  String response = cellReadUntil(2500, "OK", "ERROR");
  int pos = response.indexOf("+CSQ:");
  if (pos < 0) return -1;
  int comma = response.indexOf(',', pos);
  if (comma < 0) return -1;
  String value = response.substring(pos + 5, comma);
  value.trim();
  return value.toInt();
}

String cellQueryText(const String& command, uint32_t timeoutMs = 3000) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = cellReadUntil(timeoutMs, "OK", "ERROR");
  response.replace("\r", "\n");
  while (response.indexOf("\n\n") >= 0) response.replace("\n\n", "\n");
  response.trim();
  return response;
}

String readCellModel() {
  String response = cellQueryText("AT+CGMM");
  int firstNl = response.indexOf('\n');
  if (firstNl >= 0) response = response.substring(0, firstNl);
  response.replace("AT+CGMM", "");
  response.replace("OK", "");
  response.trim();
  return response;
}

String readCellOperator() {
  String response = cellQueryText("AT+COPS?");
  int q1 = response.indexOf('"');
  int q2 = q1 >= 0 ? response.indexOf('"', q1 + 1) : -1;
  if (q1 >= 0 && q2 > q1) return response.substring(q1 + 1, q2);
  int pos = response.indexOf("+COPS:");
  if (pos >= 0) {
    String out = response.substring(pos + 6);
    int nl = out.indexOf('\n');
    if (nl >= 0) out = out.substring(0, nl);
    out.trim();
    return out;
  }
  return "";
}

bool initializeCellular() {
  Serial.println(F("Initialising Air780E/Air780EU..."));
  if (!cellCommand("AT", "OK", 1500)) return false;
  cellCommand("ATE0", "OK", 1500, true);
  cellularModel = readCellModel();
  if (cellularModel.length()) {
    Serial.print(F("Cellular model: "));
    Serial.println(cellularModel);
    String upperModel = cellularModel;
    upperModel.toUpperCase();
    if (upperModel.indexOf("AIR780E") >= 0 && upperModel.indexOf("AIR780EU") < 0) {
      Serial.println(F("WARNING: plain Air780E is not the EMEA/Africa variant. Air780EU is recommended for South Africa."));
    }
  }

  if (!cellQueryContains("AT+CPIN?", "READY", 3000)) {
    Serial.println(F("SIM is not ready."));
    return false;
  }

  // Allow network registration/attachment to settle.
  for (int attempt = 0; attempt < 12; ++attempt) {
    if (cellQueryContains("AT+CGATT?", "+CGATT: 1", 2500)) break;
    delay(2500);
    if (attempt == 11) {
      Serial.println(F("Cellular packet service is not attached."));
      return false;
    }
  }

  // Log both EPS and packet registration. Roaming is acceptable; the active
  // operator is shown by STATUS and returned with telemetry for verification.
  cellCommand("AT+CEREG?", "+CEREG:", 2500, true);
  cellCommand("AT+CGREG?", "+CGREG:", 2500, true);

  cellCommand("AT+SAPBR=0,1", "OK", 2500, true);
  if (!cellCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 2500)) return false;
  String apnCmd = "AT+SAPBR=3,1,\"APN\",\"" + apn + "\"";
  if (!cellCommand(apnCmd, "OK", 2500)) return false;
  if (!cellCommand("AT+SAPBR=1,1", "OK", 15000, true)) return false;
  if (!cellQueryContains("AT+SAPBR=2,1", "+SAPBR: 1,1", 4000)) {
    Serial.println(F("Cellular bearer opened without a usable IPv4 address."));
    return false;
  }

  cellReady = true;
  cellularOperator = readCellOperator();
  int csq = readCellCsq();
  Serial.print(F("Air780E/Air780EU online. CSQ="));
  Serial.println(csq);
  return true;
}

void maintainCellular() {
  if (cellReady) {
    // A cheap periodic attachment check also catches SIM/network loss.
    static uint32_t lastCheck = 0;
    if (millis() - lastCheck > 60000UL) {
      lastCheck = millis();
      if (!cellQueryContains("AT+CGATT?", "+CGATT: 1", 2500)) {
        cellReady = false;
        Serial.println(F("Cellular attachment lost."));
      }
    }
    return;
  }

  if (millis() - lastCellAttemptMs < CELL_RETRY_MS) return;
  lastCellAttemptMs = millis();
  initializeCellular();
}

bool airHttpPost(const char* url, const String& json, String& responseBody, int& statusCode, bool withDeviceAuth = true) {
  responseBody = "";
  statusCode = 0;
  if (!cellReady) return false;
  if (!supabaseAnonKey.length()) {
    Serial.println(F("Supabase anon JWT missing. Use: SUPABASE ANON KEY <value>"));
    return false;
  }
  if (json.length() > 3500) {
    Serial.println(F("Payload too large for conservative Air780E/Air780EU HTTP buffer limit."));
    return false;
  }

  cellCommand("AT+HTTPTERM", "OK", 2000, true);
  if (!cellCommand("AT+HTTPINIT", "OK", 3000)) return false;
  if (!cellCommand("AT+HTTPSSL=1", "OK", 3000)) {
    cellCommand("AT+HTTPTERM", "OK", 1500, true);
    return false;
  }
  if (!cellCommand("AT+HTTPPARA=\"CID\",1", "OK", 2500)) return false;

  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + String(url) + "\"";
  if (!cellCommand(urlCmd, "OK", 4000)) return false;
  if (!cellCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2500)) return false;

  // Keep Supabase gateway JWT verification enabled, then add the independent
  // per-device credential for config/ingest calls.
  String headers = "Authorization: Bearer " + supabaseAnonKey +
                   "\\r\\napikey: " + supabaseAnonKey;
  if (withDeviceAuth) {
    if (!deviceEnrolled()) return false;
    headers += "\\r\\nX-Device-ID: " + deviceId +
               "\\r\\nX-Device-Key: " + deviceKey +
               "\\r\\nX-Firmware-Version: " + String(FIRMWARE_VERSION);
  }
  String headerCmd = "AT+HTTPPARA=\"USERDATA\",\"" + headers + "\"";
  if (!cellCommand(headerCmd, "OK", 3000)) return false;

  cellDrain();
  CellSerial.print("AT+HTTPDATA=");
  CellSerial.print(json.length());
  CellSerial.print(",15000\r\n");
  String dataPrompt = cellReadUntil(5000, "DOWNLOAD", "ERROR");
  if (dataPrompt.indexOf("DOWNLOAD") < 0) {
    Serial.println(F("Air780E/Air780EU did not accept HTTP payload data."));
    cellCommand("AT+HTTPTERM", "OK", 1500, true);
    return false;
  }

  CellSerial.print(json);
  String dataAccepted = cellReadUntil(17000, "OK", "ERROR");
  if (dataAccepted.indexOf("OK") < 0) {
    cellCommand("AT+HTTPTERM", "OK", 1500, true);
    return false;
  }

  cellDrain();
  CellSerial.print("AT+HTTPACTION=1\r\n");
  String action = cellReadUntil(25000, "+HTTPACTION:", "ERROR");
  if (action.indexOf("+HTTPACTION:") < 0) {
    Serial.println(F("No HTTPACTION result from Air780E/Air780EU."));
    cellCommand("AT+HTTPTERM", "OK", 1500, true);
    return false;
  }

  // The first read may stop as soon as +HTTPACTION: appears; continue until LF.
  action += cellReadUntil(1000, "\n", nullptr);
  int p = action.lastIndexOf("+HTTPACTION:");
  if (p >= 0) {
    int firstComma = action.indexOf(',', p);
    int secondComma = action.indexOf(',', firstComma + 1);
    if (firstComma >= 0 && secondComma >= 0) {
      statusCode = action.substring(firstComma + 1, secondComma).toInt();
    }
  }

  cellDrain();
  CellSerial.print("AT+HTTPREAD\r\n");
  String read = cellReadUntil(7000, "\r\nOK\r\n", "ERROR");
  int header = read.indexOf("+HTTPREAD:");
  if (header >= 0) {
    int bodyStart = read.indexOf('\n', header);
    if (bodyStart >= 0) {
      bodyStart++;
      int bodyEnd = read.lastIndexOf("\r\nOK");
      if (bodyEnd < bodyStart) bodyEnd = read.length();
      responseBody = read.substring(bodyStart, bodyEnd);
      responseBody.trim();
    }
  }


  // Count exact JSON body bytes handed to the modem and returned by HTTPREAD.
  // This deliberately excludes TLS, TCP/IP and mobile-network overhead.
  recordApplicationTransfer("cellular", json.length(), responseBody.length());

  cellCommand("AT+HTTPTERM", "OK", 2000, true);
  bool ok = statusCode >= 200 && statusCode < 300;
  if (!ok) {
    Serial.print(F("HTTP POST failed status="));
    Serial.println(statusCode);
    Serial.println(responseBody);
  }
  return ok;
}

// -----------------------------------------------------------------------------
// GNSS / GPS (generic NMEA UART)
// -----------------------------------------------------------------------------

bool gnssChecksumValid(const String& sentence) {
  if (!sentence.startsWith("$") || sentence.length() < 7) return false;
  int star = sentence.indexOf('*');
  if (star < 0 || star + 2 >= (int)sentence.length()) return false;
  uint8_t checksum = 0;
  for (int i = 1; i < star; ++i) checksum ^= static_cast<uint8_t>(sentence[i]);
  char expected[3] = { sentence[star + 1], sentence[star + 2], 0 };
  return checksum == static_cast<uint8_t>(strtoul(expected, nullptr, 16));
}

int splitNmea(const String& sentence, String fields[], int maxFields) {
  int star = sentence.indexOf('*');
  String body = sentence.substring(1, star >= 0 ? star : sentence.length());
  int count = 0;
  int start = 0;
  while (count < maxFields) {
    int comma = body.indexOf(',', start);
    if (comma < 0) { fields[count++] = body.substring(start); break; }
    fields[count++] = body.substring(start, comma);
    start = comma + 1;
  }
  return count;
}

double nmeaCoordinate(const String& raw, const String& hemisphere) {
  if (!raw.length()) return NAN;
  double value = raw.toDouble();
  int degrees = static_cast<int>(value / 100.0);
  double minutes = value - degrees * 100.0;
  double decimal = degrees + minutes / 60.0;
  if (hemisphere == "S" || hemisphere == "W") decimal = -decimal;
  return decimal;
}

void updateGnssAccuracy() {
  if (!isnan(gnssFix.hdop) && gnssFix.hdop > 0) gnssFix.accuracyM = max(3.0f, gnssFix.hdop * 5.0f);
}

void parseNmeaSentence(const String& sentence) {
  if (!gnssChecksumValid(sentence)) return;
  String f[20];
  int count = splitNmea(sentence, f, 20);
  if (count < 2) return;

  if (f[0].endsWith("RMC") && count >= 10) {
    if (f[2] != "A") return;
    double lat = nmeaCoordinate(f[3], f[4]);
    double lon = nmeaCoordinate(f[5], f[6]);
    if (isnan(lat) || isnan(lon)) return;
    gnssFix.latitude = lat;
    gnssFix.longitude = lon;
    gnssFix.speedMps = f[7].length() ? static_cast<float>(f[7].toDouble() * 0.514444) : NAN;
    gnssFix.valid = true;
    gnssFix.lastFixMs = millis();
    if (f[1].length() >= 6 && f[9].length() == 6) {
      int day = f[9].substring(0, 2).toInt();
      int month = f[9].substring(2, 4).toInt();
      int year = 2000 + f[9].substring(4, 6).toInt();
      int hour = f[1].substring(0, 2).toInt();
      int minute = f[1].substring(2, 4).toInt();
      int second = f[1].substring(4, 6).toInt();
      snprintf(gnssFix.utcIso, sizeof(gnssFix.utcIso), "%04d-%02d-%02dT%02d:%02d:%02dZ", year, month, day, hour, minute, second);
    }
  }

  if (f[0].endsWith("GGA") && count >= 10) {
    if (f[6].toInt() <= 0) return;
    double lat = nmeaCoordinate(f[2], f[3]);
    double lon = nmeaCoordinate(f[4], f[5]);
    if (!isnan(lat) && !isnan(lon)) { gnssFix.latitude = lat; gnssFix.longitude = lon; }
    gnssFix.satellites = static_cast<uint8_t>(constrain(f[7].toInt(), 0, 99));
    gnssFix.hdop = f[8].length() ? static_cast<float>(f[8].toDouble()) : NAN;
    gnssFix.altitudeM = f[9].length() ? static_cast<float>(f[9].toDouble()) : NAN;
    gnssFix.valid = true;
    gnssFix.lastFixMs = millis();
    updateGnssAccuracy();
  }
}

void startGnss() {
  if (!DALLMAYR_GNSS_ENABLED) return;
  if (!DALLMAYR_MACHINE_IO_ENABLED || machineInterface != IFACE_DEX) {
    gnssSerial = &DexSerial;
  } else {
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
    gnssSerial = &GnssSerial0;
#else
    Serial.println(F("GNSS not started: DEX uses UART2 and UART0 is occupied by Serial. Enable USB CDC On Boot or use an external UART bridge."));
    return;
#endif
  }
  gnssSerial->begin(DALLMAYR_GNSS_BAUD, SERIAL_8N1, DALLMAYR_GNSS_RX_PIN, DALLMAYR_GNSS_TX_PIN);
  gnssLine.reserve(128);
  Serial.print(F("GNSS NMEA UART started RX GPIO")); Serial.print(DALLMAYR_GNSS_RX_PIN);
  Serial.print(F(" TX GPIO")); Serial.println(DALLMAYR_GNSS_TX_PIN);
}

void serviceGnss() {
  if (!gnssSerial) return;
  while (gnssSerial->available()) {
    char c = static_cast<char>(gnssSerial->read());
    if (c == '\n') {
      gnssLine.trim();
      if (gnssLine.length()) parseNmeaSentence(gnssLine);
      gnssLine = "";
    } else if (c != '\r') {
      if (gnssLine.length() < 160) gnssLine += c; else gnssLine = "";
    }
  }
  if (gnssFix.valid && millis() - gnssFix.lastFixMs > 600000UL) gnssFix.valid = false;
}

bool fallbackLocationConfigured() {
  return !(DALLMAYR_FALLBACK_LATITUDE == 0.0 && DALLMAYR_FALLBACK_LONGITUDE == 0.0)
    && DALLMAYR_FALLBACK_LATITUDE >= -90.0 && DALLMAYR_FALLBACK_LATITUDE <= 90.0
    && DALLMAYR_FALLBACK_LONGITUDE >= -180.0 && DALLMAYR_FALLBACK_LONGITUDE <= 180.0;
}

// -----------------------------------------------------------------------------
// Wi-Fi + cellular transport manager
// -----------------------------------------------------------------------------

bool wifiReady() {
  return WiFi.status() == WL_CONNECTED;
}

void maintainWiFi() {
  // Remote control can disable Wi-Fi per telemetry device.
  if (!policy.wifiEnabled || !wifiSsid.length()) {
    if (wifiBeginIssued && !wifiRadioDisabled) {
      Serial.println(F("Wi-Fi disabled by remote policy/config."));
      WiFi.setAutoReconnect(false);
      WiFi.disconnect(true, false);
      wifiBeginIssued = false;
      wifiRadioDisabled = true;
    }
    return;
  }

  if (wifiReady()) {
    wifiRadioDisabled = false;
    return;
  }

  // Configure/start the station only once. Repeating WiFi.begin() while the
  // ESP-IDF station is still associating causes:
  //   wifi:sta is connecting, cannot set config
  if (!wifiBeginIssued) {
    Serial.print(F("Starting Wi-Fi connection to SSID: "));
    Serial.println(wifiSsid);

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

    wifiBeginIssued = true;
    wifiRadioDisabled = false;
    lastWifiAttemptMs = millis();
    return;
  }

  // ESP32 auto-reconnect owns subsequent retries. Do not call WiFi.begin()
  // again while a connection attempt may still be active.
  if (millis() - lastWifiAttemptMs >= WIFI_STATUS_LOG_MS) {
    lastWifiAttemptMs = millis();
    Serial.print(F("Wi-Fi not connected yet; auto-reconnect active. status="));
    Serial.println(static_cast<int>(WiFi.status()));
  }
}

bool wifiHttpPost(const char* url, const String& json, String& responseBody, int& statusCode, bool withDeviceAuth = true) {
  responseBody = "";
  statusCode = 0;
  if (!wifiReady()) return false;
  if (!supabaseAnonKey.length()) return false;

  WiFiClientSecure tls;
  // Prototype choice: encryption is enabled, but CA validation is not pinned.
  // Replace with a managed root CA bundle before fleet rollout.
  tls.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(20000);
  if (!http.begin(tls, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
  http.addHeader("apikey", supabaseAnonKey);
  if (withDeviceAuth) {
    if (!deviceEnrolled()) {
      http.end();
      return false;
    }
    http.addHeader("X-Device-ID", deviceId);
    http.addHeader("X-Device-Key", deviceKey);
    http.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  }

  statusCode = http.POST(json);
  if (statusCode > 0) responseBody = http.getString();
  if (statusCode > 0) recordApplicationTransfer("wifi", json.length(), responseBody.length());
  http.end();

  return statusCode >= 200 && statusCode < 300;
}

void addTransportMetadata(JsonDocument& doc, const char* transport) {
  doc["transport"] = transport;
  doc["wifi_rssi"] = wifiReady() ? WiFi.RSSI() : 0;
  doc["cellular_csq"] = cellReady ? readCellCsq() : -1;
  if (cellularModel.length()) doc["cellular_model"] = cellularModel;
  if (cellularOperator.length()) doc["cellular_operator"] = cellularOperator;
}

void addDataUsageMetadata(JsonDocument& doc, const char* transport) {
  JsonObject usage = doc["data_usage"].to<JsonObject>();
  String transportEpoch = String(dataUsageEpoch) + "-" + transport;
  usage["counter_epoch"] = transportEpoch;
  if (strcmp(transport, "cellular") == 0) {
    usage["application_tx_bytes_total"] = cellularApplicationTxBytes;
    usage["application_rx_bytes_total"] = cellularApplicationRxBytes;
  } else if (strcmp(transport, "wifi") == 0) {
    usage["application_tx_bytes_total"] = wifiApplicationTxBytes;
    usage["application_rx_bytes_total"] = wifiApplicationRxBytes;
  }
}

bool tryRawPost(const char* transport, const char* url, const String& json,
                String& responseBody, int& statusCode) {
  if (strcmp(transport, "wifi") == 0) {
    if (!wifiReady()) return false;
    return wifiHttpPost(url, json, responseBody, statusCode);
  }
  if (strcmp(transport, "cellular") == 0) {
    if (!cellReady) return false;
    return airHttpPost(url, json, responseBody, statusCode);
  }
  return false;
}

bool transportAllowed(const char* transport) {
  if (strcmp(transport, "wifi") == 0) return policy.wifiEnabled;
  if (strcmp(transport, "cellular") == 0) return policy.cellularEnabled;
  return false;
}

void getTransportOrder(const char*& first, const char*& second) {
  String pref = policy.transportPreference;
  pref.toLowerCase();
  if (pref == "cellular") {
    first = "cellular";
    second = "wifi";
  } else {
    // "wifi" and "auto" both prefer Wi-Fi to reduce SIM data usage.
    first = "wifi";
    second = "cellular";
  }
}

bool postRawWithFailover(const char* url, const String& json, String& responseBody,
                         int& statusCode, String& usedTransport, bool managementTraffic) {
  const char* first;
  const char* second;
  getTransportOrder(first, second);

  const char* attempts[2] = { first, second };
  for (uint8_t i = 0; i < 2; ++i) {
    const char* t = attempts[i];
    if (!managementTraffic && !transportAllowed(t)) continue;
    if (tryRawPost(t, url, json, responseBody, statusCode)) {
      usedTransport = t;
      return true;
    }
  }

  // Management/config traffic is deliberately allowed to use either physical
  // connection. This prevents a bad remote transport setting from permanently
  // locking the device out of its control plane.
  if (managementTraffic) {
    const char* recovery[2] = { "wifi", "cellular" };
    for (uint8_t i = 0; i < 2; ++i) {
      const char* t = recovery[i];
      if (String(t) == first || String(t) == second) continue;
      if (tryRawPost(t, url, json, responseBody, statusCode)) {
        usedTransport = t;
        return true;
      }
    }
  }

  return false;
}

bool anyDataTransportReady() {
  return (policy.wifiEnabled && wifiReady()) || (policy.cellularEnabled && cellReady);
}

// -----------------------------------------------------------------------------
// First-boot enrollment
// -----------------------------------------------------------------------------

bool enrollOverAvailableNetwork(String& responseBody, int& statusCode, String& usedTransport) {
  responseBody = "";
  statusCode = 0;

  JsonDocument doc;
  doc["enrollment_token"] = enrollmentToken;
  doc["hardware_uid"] = hardwareUid;
  doc["firmware"] = FIRMWARE_VERSION;
  if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;

  String payload;
  serializeJson(doc, payload);

  if (wifiReady() && wifiHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "wifi";
    return true;
  }
  if (cellReady && airHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "cellular";
    return true;
  }
  return false;
}

bool performEnrollment() {
  if (deviceEnrolled()) return true;
  if (!hardwareUid.length()) return false;
  if (!enrollmentToken.length()) {
    Serial.println(F("Enrollment token missing. Provision it with: ENROLL TOKEN <one-time-token>"));
    return false;
  }
  if (!wifiReady() && !cellReady) return false;

  String body;
  String usedTransport;
  int status = 0;
  if (!enrollOverAvailableNetwork(body, status, usedTransport)) {
    Serial.print(F("Enrollment failed HTTP="));
    Serial.println(status);
    if (body.length()) Serial.println(body);
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    Serial.println(F("Enrollment response was not valid JSON."));
    return false;
  }
  if (!doc["accepted"].as<bool>()) {
    Serial.println(F("Enrollment was not accepted."));
    return false;
  }

  String returnedCode = doc["device_code"] | "";
  String returnedKey = doc["device_key"] | "";
  if (returnedCode != deviceId || returnedKey.length() < 20) {
    Serial.println(F("Enrollment response identity mismatch."));
    return false;
  }

  deviceKey = returnedKey;
  saveDeviceCredential();
  enrollmentToken = "";
  saveEnrollmentToken();

  Serial.print(F("ENROLLED via "));
  Serial.println(usedTransport);
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
  Serial.print(F("Machine link: "));
  Serial.println(String(doc["machine_link_status"] | "unlinked"));
  if (!doc["machine_id"].isNull()) {
    Serial.print(F("Machine UUID: "));
    Serial.println(String(doc["machine_id"] | ""));
  }
  heartbeatUploadRequested = true;
  lastConfigSuccessMs = 0;
  return true;
}

void maintainEnrollment() {
  if (deviceEnrolled()) return;
  if (millis() - lastEnrollmentAttemptMs < ENROLL_RETRY_MS && lastEnrollmentAttemptMs != 0) return;
  lastEnrollmentAttemptMs = millis();
  performEnrollment();
}

// -----------------------------------------------------------------------------
// Supabase payloads
// -----------------------------------------------------------------------------

void addCommonPayload(JsonDocument& doc, const char* type) {
  doc["type"] = type;
  doc["device_id"] = deviceId;
  doc["hardware_uid"] = hardwareUid;
  if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;
  doc["boot_id"] = bootId;
  doc["sequence"] = ++sequenceNumber;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["machine_interface"] = interfaceName(machineInterface);
  doc["profile_id"] = policy.profileId;
}

bool sendDocumentToIngest(JsonDocument& doc) {
  if (!deviceEnrolled()) return false;
  const char* first;
  const char* second;
  getTransportOrder(first, second);
  const char* attempts[2] = { first, second };

  for (uint8_t i = 0; i < 2; ++i) {
    const char* t = attempts[i];
    if (!transportAllowed(t)) continue;
    if (strcmp(t, "wifi") == 0 && !wifiReady()) continue;
    if (strcmp(t, "cellular") == 0 && !cellReady) continue;

    addTransportMetadata(doc, t);
    addDataUsageMetadata(doc, t);
    String payload;
    serializeJson(doc, payload);
    String body;
    int status = 0;

    bool ok = strcmp(t, "wifi") == 0
      ? wifiHttpPost(INGEST_URL, payload, body, status)
      : airHttpPost(INGEST_URL, payload, body, status);

    if (ok) {
      Serial.print(F("Telemetry uploaded via "));
      Serial.println(t);
      return true;
    }

    Serial.print(F("Telemetry upload failed via "));
    Serial.print(t);
    Serial.print(F(" HTTP="));
    Serial.println(status);
  }

  return false;
}

bool uploadHeartbeat() {
  JsonDocument doc;
  addCommonPayload(doc, "heartbeat");
  bool ok = sendDocumentToIngest(doc);
  if (ok) heartbeatUploadRequested = false;
  return ok;
}

bool uploadFaultState(const String& code, bool active, const String& severity,
                      const String& source, const String& detail, const String& raw) {
  JsonDocument doc;
  addCommonPayload(doc, "fault_state");
  doc["fault_code"] = code;
  doc["active"] = active;
  doc["severity"] = severity;
  doc["source"] = source;
  doc["detail"] = detail;
  if (raw.length()) doc["raw"] = raw.substring(0, 480);
  return sendDocumentToIngest(doc);
}

bool uploadCounterBatch(uint16_t startIndex, uint16_t& nextIndex) {
  JsonDocument doc;
  addCommonPayload(doc, "counter_snapshot");
  doc["counter_epoch"] = counterEpoch;
  JsonArray items = doc["items"].to<JsonArray>();

  uint8_t added = 0;
  uint16_t i = startIndex;
  for (; i < counterCount && added < MAX_ITEMS_PER_UPLOAD; ++i) {
    CounterEntry& c = counters[i];
    if (!c.used) continue;
    JsonObject item = items.add<JsonObject>();
    item["selection"] = c.selection;
    if (strlen(c.product)) item["product"] = c.product;
    if (c.priceCents > 0) item["configured_price_cents"] = c.priceCents;
    item["sold_total"] = c.soldTotal;
    item["failed_total"] = c.failedTotal;
    item["revenue_cents_total"] = c.revenueCentsTotal;
    added++;
  }
  nextIndex = i;
  if (added == 0) return true;

  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    for (uint16_t j = startIndex; j < nextIndex; ++j) {
      if (j < counterCount && counters[j].used) counters[j].dirty = false;
    }
  }
  return ok;
}

bool uploadAllCounters() {
  if (!anyDataTransportReady()) return false;
  uint16_t index = 0;
  while (index < counterCount) {
    uint16_t next = index;
    if (!uploadCounterBatch(index, next)) return false;
    if (next <= index) break;
    index = next;
  }
  counterUploadRequested = false;
  return true;
}

bool sendCellularSimulationSnapshot(const char* testBootId, uint64_t soldTotal,
                                    uint64_t revenueCentsTotal, JsonDocument& responseDoc,
                                    size_t& requestBytes, size_t& responseBytes) {
  JsonDocument doc;
  addCommonPayload(doc, "simulation_snapshot");
  doc["simulation"] = true;
  doc["boot_id"] = testBootId;
  addTransportMetadata(doc, "cellular");
  addDataUsageMetadata(doc, "cellular");

  JsonArray items = doc["items"].to<JsonArray>();
  JsonObject item = items.add<JsonObject>();
  item["selection"] = "VODACOM-SIM-TEST-A1";
  item["product"] = "Vodacom SIM data test";
  item["sold_total"] = soldTotal;
  item["failed_total"] = 0;
  item["revenue_cents_total"] = revenueCentsTotal;

  String payload;
  serializeJson(doc, payload);
  String body;
  int status = 0;
  bool ok = airHttpPost(INGEST_URL, payload, body, status);
  requestBytes = payload.length();
  responseBytes = body.length();

  Serial.print(F("SIM DATA TEST HTTP="));
  Serial.print(status);
  Serial.print(F(" request="));
  Serial.print(requestBytes);
  Serial.print(F("B response="));
  Serial.print(responseBytes);
  Serial.println(F("B"));

  if (!ok) {
    if (body.length()) Serial.println(body);
    return false;
  }
  DeserializationError error = deserializeJson(responseDoc, body);
  if (error || !responseDoc["accepted"].as<bool>() || !responseDoc["simulation"].as<bool>()) {
    Serial.println(F("SIM DATA TEST response was not an accepted simulation upload."));
    if (body.length()) Serial.println(body);
    return false;
  }
  return true;
}

bool runVodacomSimDataTest() {
  Serial.println(F("--- VODACOM CELLULAR-ONLY SIM DATA TEST ---"));
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED) {
    Serial.println(F("Blocked: this firmware was not compiled as a simulation-test build."));
    return false;
  }
  if (!deviceEnrolled()) {
    Serial.println(F("Blocked: enroll the device before running the test."));
    return false;
  }
  if (!cellReady) {
    Serial.println(F("Cellular bearer is not ready; attempting to connect now."));
    cellReady = initializeCellular();
  }
  if (!cellReady) {
    Serial.println(F("Blocked: the Air780E/Air780EU could not open a cellular bearer."));
    return false;
  }

  char testBootId[33] = {0};
  makeRandomId(testBootId, sizeof(testBootId));
  uint64_t bytesBefore = cellularApplicationTxBytes + cellularApplicationRxBytes;
  size_t requestBytes = 0;
  size_t responseBytes = 0;
  JsonDocument baselineResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 0, 0, baselineResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED during the zero-value baseline."));
    return false;
  }

  delay(500);
  JsonDocument incrementResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 1, 1500, incrementResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED during the one-item increment."));
    return false;
  }

  long dailyUnits = incrementResponse["daily_delta_units"] | -1;
  long dailyRevenue = incrementResponse["daily_delta_revenue_cents"] | -1;
  if (dailyUnits != 1 || dailyRevenue != 1500) {
    Serial.print(F("SIM DATA TEST FAILED: expected delta 1 / R15.00, received "));
    Serial.print(dailyUnits);
    Serial.print(F(" / cents "));
    Serial.println(dailyRevenue);
    return false;
  }

  saveDataUsageNow();
  uint64_t testBytes = cellularApplicationTxBytes + cellularApplicationRxBytes - bytesBefore;
  char byteBuffer[24] = {0};
  snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(testBytes));
  Serial.print(F("SIM DATA TEST PASSED over cellular. Exact JSON body bytes: "));
  Serial.println(byteBuffer);
  Serial.println(F("Vodacom billing will be higher because TLS, TCP/IP and radio overhead are not included."));
  return true;
}

bool syncRemotePolicy() {
  if (!deviceEnrolled()) return false;
  if (!wifiReady() && !cellReady) return false;

  String body;
  String usedTransport;
  int status = 0;
  if (!postRawWithFailover(CONFIG_URL, "{}", body, status, usedTransport, true)) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.print(F("Config JSON parse failed: "));
    Serial.println(err.c_str());
    return false;
  }
  if (!doc["accepted"].as<bool>()) return false;

  JsonObject p = doc["policy"].as<JsonObject>();
  copyText(policy.mode, sizeof(policy.mode), p["mode"] | "live");
  copyText(policy.source, sizeof(policy.source), p["source"] | "default");
  copyText(policy.profileId, sizeof(policy.profileId), doc["assignment"]["profile_id"] | "");
  policy.counterIntervalMinutes = p["counter_interval_minutes"] | 5;
  policy.heartbeatIntervalMinutes = p["heartbeat_interval_minutes"] | 10;
  policy.configRefreshMinutes = p["config_refresh_minutes"] | 5;
  policy.immediateFaults = p["fault_reporting_immediate"] | true;
  policy.immediateRecovery = p["recovery_reporting_immediate"] | true;
  policy.counterDue = doc["actions"]["counter_due"] | false;
  policy.heartbeatDue = doc["actions"]["heartbeat_due"] | false;

  JsonObject control = doc["control"].as<JsonObject>();
  copyText(policy.transportPreference, sizeof(policy.transportPreference),
           control["transport_preference"] | "auto");
  policy.wifiEnabled = control["wifi_enabled"] | true;
  policy.cellularEnabled = control["cellular_enabled"] | true;
  JsonObject cellularProfile = control["cellular_profile"].as<JsonObject>();
  String remoteApn = cellularProfile["apn"] | "";
  remoteApn.trim();
  if (remoteApn.length() && remoteApn != apn) {
    apn = remoteApn;
    saveCoreSettings();
    cellReady = false;
    Serial.print(F("Remote cellular APN saved: "));
    Serial.println(apn);
  }
  JsonObject locationControl = control["location"].as<JsonObject>();
  policy.locationEnabled = locationControl["enabled"] | true;
  policy.locationIntervalMinutes = locationControl["interval_minutes"] | 15;
  policy.locationMinMoveM = locationControl["min_move_m"] | 50;
  policy.locationDue = doc["actions"]["location_due"] | false;

  counterUploadRequested |= policy.counterDue;
  heartbeatUploadRequested |= policy.heartbeatDue;
  lastConfigSuccessMs = millis();

  prefs.begin("dallmayr", false);
  prefs.putString("mode", policy.mode);
  prefs.putString("source", policy.source);
  prefs.putString("profile", policy.profileId);
  prefs.putString("transport", policy.transportPreference);
  prefs.putBool("wifi_on", policy.wifiEnabled);
  prefs.putBool("cell_on", policy.cellularEnabled);
  prefs.putBool("loc_on", policy.locationEnabled);
  prefs.putULong("loc_min", policy.locationIntervalMinutes);
  prefs.putULong("loc_move", policy.locationMinMoveM);
  prefs.putULong("ctrmin", policy.counterIntervalMinutes);
  prefs.putULong("hbmin", policy.heartbeatIntervalMinutes);
  prefs.putULong("cfgmin", policy.configRefreshMinutes);
  prefs.end();

  Serial.print(F("Remote control synced via "));
  Serial.print(usedTransport);
  Serial.print(F(": mode="));
  Serial.print(policy.mode);
  Serial.print(F(" transport="));
  Serial.print(policy.transportPreference);
  Serial.print(F(" wifi="));
  Serial.print(policy.wifiEnabled ? "on" : "off");
  Serial.print(F(" cellular="));
  Serial.println(policy.cellularEnabled ? "on" : "off");
  return true;
}

void loadCachedPolicy() {
  memset(&policy, 0, sizeof(policy));
  copyText(policy.mode, sizeof(policy.mode), "live");
  copyText(policy.source, sizeof(policy.source), "cached-default");
  copyText(policy.transportPreference, sizeof(policy.transportPreference), "auto");
  policy.counterIntervalMinutes = 5;
  policy.heartbeatIntervalMinutes = 10;
  policy.configRefreshMinutes = 5;
  policy.immediateFaults = true;
  policy.immediateRecovery = true;
  policy.wifiEnabled = true;
  policy.cellularEnabled = true;
  policy.locationEnabled = true;
  policy.locationIntervalMinutes = 15;
  policy.locationMinMoveM = 50;
  policy.locationDue = true;

  prefs.begin("dallmayr", true);
  String mode = prefs.getString("mode", "");
  if (mode.length()) copyText(policy.mode, sizeof(policy.mode), mode);
  String source = prefs.getString("source", "");
  if (source.length()) copyText(policy.source, sizeof(policy.source), source);
  String profile = prefs.getString("profile", "");
  if (profile.length()) copyText(policy.profileId, sizeof(policy.profileId), profile);
  String transport = prefs.getString("transport", "");
  if (transport.length()) copyText(policy.transportPreference, sizeof(policy.transportPreference), transport);
  policy.wifiEnabled = prefs.getBool("wifi_on", policy.wifiEnabled);
  policy.cellularEnabled = prefs.getBool("cell_on", policy.cellularEnabled);
  policy.locationEnabled = prefs.getBool("loc_on", policy.locationEnabled);
  policy.locationIntervalMinutes = prefs.getULong("loc_min", policy.locationIntervalMinutes);
  policy.locationMinMoveM = prefs.getULong("loc_move", policy.locationMinMoveM);
  policy.counterIntervalMinutes = prefs.getULong("ctrmin", policy.counterIntervalMinutes);
  policy.heartbeatIntervalMinutes = prefs.getULong("hbmin", policy.heartbeatIntervalMinutes);
  policy.configRefreshMinutes = prefs.getULong("cfgmin", policy.configRefreshMinutes);
  prefs.end();
}

void maintainRemotePolicy() {
  if (!deviceEnrolled()) return;
  if (!wifiReady() && !cellReady) return;
  uint32_t refreshMinutes = policy.configRefreshMinutes == 0 ? 1 : policy.configRefreshMinutes;
  uint32_t interval = refreshMinutes * 60000UL;
  bool due = lastConfigSuccessMs == 0 || millis() - lastConfigSuccessMs >= interval;
  if (!due) return;
  uint32_t retryMs = CONFIG_RETRY_MS;
  if (millis() - lastConfigAttemptMs < retryMs && lastConfigAttemptMs != 0) return;
  lastConfigAttemptMs = millis();
  syncRemotePolicy();
}

// -----------------------------------------------------------------------------
// DEX/UCS parser and capture
// -----------------------------------------------------------------------------

void appendDexByte(uint8_t b) {
  if (dexText.length() >= DEX_TEXT_MAX) return;
  if (b == '\r' || b == '\n' || b == '~' || (b >= 0x20 && b <= 0x7E)) {
    dexText += static_cast<char>(b == '~' ? '\n' : b);
  }
}

void sendDexBlockAck() {
  DexSerial.write(0x10); // DLE
  DexSerial.write(dexAckToggle ? '1' : '0');
  dexAckToggle = !dexAckToggle;
}

void requestDexAudit() {
  if (machineInterface != IFACE_DEX) return;
  dexText = "";
  dexRequestActive = true;
  dexSawDataThisRequest = false;
  dexRequestStartedMs = millis();
  dexAckToggle = true;
  dexInBlock = false;
  dexSawDle = false;
  dexCrcBytesRemaining = 0;
  while (DexSerial.available()) DexSerial.read();

  // Common DEX initiation attempt. Some VMC revisions use the opposite
  // master/slave role; processDexSerial() also responds to an incoming ENQ.
  DexSerial.write(0x05); // ENQ
  DexSerial.flush();
  Serial.println(F("DEX audit requested."));
}

void parseDexText(const String& text) {
  if (text.length() == 0) return;
  Serial.print(F("Parsing DEX payload bytes="));
  Serial.println(text.length());

  String currentSelection;
  String currentProduct;
  uint32_t currentPriceCents = 0;
  bool sawProductCounter = false;

  int start = 0;
  while (start < text.length()) {
    int end = text.indexOf('\n', start);
    if (end < 0) end = text.length();
    String line = text.substring(start, end);
    line.replace("\r", "");
    line.trim();
    start = end + 1;
    if (line.length() < 2) continue;

    if (line.startsWith("ID4*")) {
      dexDecimalPlaces = fieldAt(line, 1).toInt();
      if (dexDecimalPlaces < 0 || dexDecimalPlaces > 4) dexDecimalPlaces = 2;
      continue;
    }

    if (line.startsWith("PA1*")) {
      currentSelection = trimCopy(fieldAt(line, 1));
      currentPriceCents = static_cast<uint32_t>(dexValueToCents(toUInt64(fieldAt(line, 2))));
      currentProduct = trimCopy(fieldAt(line, 3));
      continue;
    }

    if (line.startsWith("PA2*") && currentSelection.length()) {
      // Common DEX/UCS product layout:
      // PA2*historical_paid_vends*historical_sales_value*interval_vends*interval_sales...
      uint64_t sold = toUInt64(fieldAt(line, 1));
      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 2)));
      setCumulativeCounter(currentSelection, sold, revenue, currentPriceCents, currentProduct);
      sawProductCounter = true;
      continue;
    }

    if (line.startsWith("VA1*") && !sawProductCounter) {
      // Aggregate fallback for machines that do not expose PA1/PA2 per-selection records.
      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 1)));
      uint64_t sold = toUInt64(fieldAt(line, 2));
      setCumulativeCounter("TOTAL", sold, revenue, 0, "Machine total");
      continue;
    }

    if (line.startsWith("EA2*")) {
      String eventCode = trimCopy(fieldAt(line, 1));
      String userData = trimCopy(fieldAt(line, 4));
      bool active = trimCopy(fieldAt(line, 5)) == "1";
      String detail = "DEX event " + eventCode;
      if (userData.length()) detail += ": " + userData;
      setLocalFaultState(eventCode, active, active ? "fault" : "info",
                         "dex", detail, line);
      continue;
    }
  }

  if (dexRequestActive) {
    dexRequestActive = false;
    if (dexSawDataThisRequest) {
      setLocalFaultState("DEX_NO_RESPONSE", false, "warning", "dex",
                         "DEX communication restored", "");
    }
  }

  if (counterUploadRequested && (cellReady || WiFi.status() == WL_CONNECTED)) uploadAllCounters();
}

void finishDexCapture() {
  if (dexText.length() == 0) return;
  String payload = dexText;
  dexText = "";
  parseDexText(payload);
}

void processDexSerial() {
  while (DexSerial.available()) {
    uint8_t b = DexSerial.read();
    lastDexByteMs = millis();
    dexSawDataThisRequest = true;

    // Reply to a VMC/data-carrier ENQ if it takes the opposite handshake role.
    if (!dexInBlock && b == 0x05) {
      DexSerial.write(0x06); // ACK
      continue;
    }

    if (dexCrcBytesRemaining > 0) {
      dexCrcBytesRemaining--;
      if (dexCrcBytesRemaining == 0) sendDexBlockAck();
      continue;
    }

    if (dexSawDle) {
      dexSawDle = false;
      if (b == 0x02) { // STX
        dexInBlock = true;
        continue;
      }
      if (b == 0x17 || b == 0x03) { // ETB / ETX
        dexInBlock = false;
        dexCrcBytesRemaining = 2;
        dexText += '\n';
        continue;
      }
      // DLE escaped / unknown: keep printable payload where useful.
      appendDexByte(b);
      continue;
    }

    if (b == 0x10) {
      dexSawDle = true;
      continue;
    }

    if (b == 0x04) { // EOT
      finishDexCapture();
      continue;
    }

    appendDexByte(b);
  }

  if (dexText.length() > 0 && millis() - lastDexByteMs > DEX_FRAME_IDLE_MS) {
    finishDexCapture();
  }

  if (dexRequestActive && millis() - dexRequestStartedMs > DEX_REQUEST_TIMEOUT_MS) {
    dexRequestActive = false;
    if (dexText.length()) finishDexCapture();
    if (!dexSawDataThisRequest) {
      setLocalFaultState("DEX_NO_RESPONSE", true, "warning", "dex",
                         "No DEX response within the audit request window", "");
      Serial.println(F("DEX audit timed out."));
    }
  }
}

// -----------------------------------------------------------------------------
// Normalized UART fallback
// -----------------------------------------------------------------------------
// If a machine-specific adapter outputs normalized CSV/JSON on the DEX UART,
// the same hardware port can be switched to NORMALIZED_UART mode.

String normalizedLine;

void parseNormalizedLine(String line) {
  line.trim();
  if (!line.length()) return;

  if (line.startsWith("{")) {
    JsonDocument doc;
    if (deserializeJson(doc, line)) return;
    String type = doc["type"] | "";
    if (type.equalsIgnoreCase("vend")) {
      String selection = doc["selection"] | "UNKNOWN";
      uint32_t price = doc["price_cents"] | 0;
      String result = doc["result"] | "OK";
      bool success = result.equalsIgnoreCase("OK");
      if (!doc["counter"].isNull()) {
        uint64_t count = doc["counter"].as<uint64_t>();
        setCumulativeCounter(selection, count, count * price, price, "");
      } else {
        incrementLocalVend(selection, price, success);
      }
    } else if (type.equalsIgnoreCase("fault")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", true, doc["severity"] | "fault",
                         "normalized_uart", doc["detail"] | "", line);
    } else if (type.equalsIgnoreCase("recovery")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", false, "info",
                         "normalized_uart", doc["detail"] | "", line);
    }
    return;
  }

  // CSV: VEND,A1,1500,CARD,OK,123
  if (line.startsWith("VEND,")) {
    int p1 = line.indexOf(',');
    int p2 = line.indexOf(',', p1 + 1);
    int p3 = line.indexOf(',', p2 + 1);
    int p4 = line.indexOf(',', p3 + 1);
    int p5 = line.indexOf(',', p4 + 1);
    String selection = line.substring(p1 + 1, p2);
    uint32_t price = line.substring(p2 + 1, p3).toInt();
    String result = p4 >= 0 ? line.substring(p4 + 1, p5 >= 0 ? p5 : line.length()) : "OK";
    if (p5 >= 0) {
      uint64_t count = toUInt64(line.substring(p5 + 1));
      setCumulativeCounter(selection, count, count * price, price, "");
    } else {
      incrementLocalVend(selection, price, result.equalsIgnoreCase("OK"));
    }
  }
}

void processNormalizedSerial() {
  while (DexSerial.available()) {
    char c = static_cast<char>(DexSerial.read());
    if (c == '\r' || c == '\n') {
      if (normalizedLine.length()) {
        parseNormalizedLine(normalizedLine);
        normalizedLine = "";
      }
    } else if (normalizedLine.length() < 512) {
      normalizedLine += c;
    }
  }
}

// -----------------------------------------------------------------------------
// MDB placeholder / safeguard
// -----------------------------------------------------------------------------

void beginMdbPins() {
  pinMode(MDB_RX_PIN, INPUT);
  pinMode(MDB_TX_PIN, OUTPUT);
  digitalWrite(MDB_TX_PIN, LOW);
}

void processMdb() {
  // Intentionally not implemented as ordinary UART. MDB requires a 9th mode
  // bit and tight response timing. Fit/test the opto-isolated MDB physical
  // layer, then add the dedicated 9-bit software/bridge driver here.
}

// -----------------------------------------------------------------------------
// Machine interface control
// -----------------------------------------------------------------------------

void restartMachineInterface() {
  DexSerial.end();
  delay(20);

  if (machineInterface == IFACE_DEX || machineInterface == IFACE_NORMALIZED_UART) {
    DexSerial.begin(dexBaud, SERIAL_8N1, DEX_RX_PIN, DEX_TX_PIN);
  }
  if (machineInterface == IFACE_MDB) beginMdbPins();
}

void serviceMachineInterface() {
  switch (machineInterface) {
    case IFACE_DEX: processDexSerial(); break;
    case IFACE_NORMALIZED_UART: processNormalizedSerial(); break;
    case IFACE_MDB: processMdb(); break;
    default: break;
  }
}

// -----------------------------------------------------------------------------
// Upload orchestration
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// Location upload
// -----------------------------------------------------------------------------

bool uploadLocationUpdate() {
  if (!deviceEnrolled() || !policy.locationEnabled || !anyDataTransportReady()) return false;
  bool useGnss = gnssFix.valid;
  bool useFallback = !useGnss && fallbackLocationConfigured();
  if (!useGnss && !useFallback) return false;

  JsonDocument doc;
  addCommonPayload(doc, "location_update");
  JsonObject location = doc["location"].to<JsonObject>();
  if (useGnss) {
    location["latitude"] = gnssFix.latitude;
    location["longitude"] = gnssFix.longitude;
    location["source"] = "gnss";
    if (!isnan(gnssFix.accuracyM)) location["accuracy_m"] = gnssFix.accuracyM;
    if (!isnan(gnssFix.altitudeM)) location["altitude_m"] = gnssFix.altitudeM;
    if (!isnan(gnssFix.speedMps)) location["speed_mps"] = gnssFix.speedMps;
    if (gnssFix.satellites > 0) location["satellites"] = gnssFix.satellites;
    if (!isnan(gnssFix.hdop)) location["hdop"] = gnssFix.hdop;
    if (gnssFix.utcIso[0]) location["fix_at"] = gnssFix.utcIso;
  } else {
    location["latitude"] = DALLMAYR_FALLBACK_LATITUDE;
    location["longitude"] = DALLMAYR_FALLBACK_LONGITUDE;
    location["source"] = "manual";
  }

  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    lastLocationUploadMs = millis();
    policy.locationDue = false;
    Serial.print(F("Location uploaded source=")); Serial.println(useGnss ? "gnss" : "manual");
  }
  return ok;
}

void serviceLocation() {
  if (!deviceEnrolled() || !policy.locationEnabled || !anyDataTransportReady()) return;
  uint32_t intervalMinutes = policy.locationIntervalMinutes == 0 ? 15 : policy.locationIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;
  bool due = policy.locationDue || lastLocationUploadMs == 0 || millis() - lastLocationUploadMs >= intervalMs;
  if (due) uploadLocationUpdate();
}

// -----------------------------------------------------------------------------
// Production upload orchestration
// -----------------------------------------------------------------------------

void serviceUploads() {
  if (!anyDataTransportReady()) return;
  flushPendingFaults();

  if (heartbeatUploadRequested) uploadHeartbeat();

  if (counterUploadRequested) {
    if (machineInterface == IFACE_DEX) {
      if (!dexRequestActive) requestDexAudit();
    } else {
      uploadAllCounters();
    }
  }
}

// -----------------------------------------------------------------------------
// Serial console
// -----------------------------------------------------------------------------

void printWiringMap() {
  Serial.println(F("--- C130001 WORKING WIRING MAP ---"));
  Serial.println(F("VERIFY EACH COLOUR BY CONTINUITY BEFORE CONNECTING."));
  Serial.println(F("RED    : machine +24..34V -> BMT DC/DC IN+ (NO ESP32 GPIO)"));
  Serial.println(F("GREY   : machine 0V/return -> BMT DC/DC IN- (NO ESP32 GPIO)"));
  Serial.println(F("YELLOW : working map N/C -> leave disconnected until verified"));
  Serial.print  (F("PURPLE : MDB data -> isolated MDB bridge -> ESP32 GPIO")); Serial.println(MDB_RX_PIN);
  Serial.print  (F("BLUE   : MDB data <- isolated MDB bridge <- ESP32 GPIO")); Serial.println(MDB_TX_PIN);
  Serial.println(F("BLACK  : MDB communications common -> MDB interface COM/reference"));
  Serial.print  (F("ORANGE : DEX TX from machine -> SP3232 R1IN/R1OUT -> ESP32 GPIO")); Serial.println(DEX_RX_PIN);
  Serial.print  (F("BROWN  : DEX RX to machine <- SP3232 T1OUT/T1IN <- ESP32 GPIO")); Serial.println(DEX_TX_PIN);
  Serial.println(F("GREEN  : DEX GND -> SP3232 GND/reference"));
  Serial.println(F("WHITE  : shield/drain/spare working map -> verify before use"));
  Serial.print  (F("Air780 TX -> ESP32 GPIO")); Serial.print(CELL_RX_PIN); Serial.println(F(" (not C130001)"));
  Serial.print  (F("Air780 RX <- ESP32 GPIO")); Serial.print(CELL_TX_PIN); Serial.println(F(" (not C130001)"));
  Serial.println(F("MDB wires must NOT connect directly to ESP32; use isolated 9-bit MDB interface."));
  Serial.println(F("DEX ORANGE/BROWN must NOT connect directly to ESP32; use SP3232."));
}

void printStatus() {
  Serial.println(F("--- Dallmayr Telemetry V6.1 VODACOM DATA TEST ---"));
  Serial.print(F("Firmware: ")); Serial.println(FIRMWARE_VERSION);
  Serial.print(F("Device: ")); Serial.println(deviceId.length() ? deviceId : "<identity not initialized>");
  Serial.print(F("Hardware UID: ")); Serial.println(hardwareUid.length() ? hardwareUid : "<unknown>");
  Serial.print(F("Enrollment: ")); Serial.println(deviceEnrolled() ? "enrolled" : "not enrolled");
  Serial.print(F("Supabase gateway JWT: ")); Serial.println(supabaseAnonKey.length() ? "provisioned" : "missing");
  Serial.print(F("Simulation data test enabled: ")); Serial.println(DALLMAYR_SIM_DATA_TEST_ENABLED ? "yes" : "no");
  Serial.print(F("Machine I/O enabled: ")); Serial.println(DALLMAYR_MACHINE_IO_ENABLED ? "yes" : "no - locked pending MDB/DEX verification");
  Serial.print(F("Reported machine S/N: ")); Serial.println(reportedMachineSerial.length() ? reportedMachineSerial : "<not set>");
  Serial.print(F("Interface: ")); Serial.println(interfaceName(machineInterface));
  Serial.print(F("DEX baud: ")); Serial.println(dexBaud);
  Serial.print(F("Wi-Fi configured: ")); Serial.println(wifiSsid.length() ? "yes" : "no");
  Serial.print(F("Wi-Fi connected: ")); Serial.println(wifiReady() ? "yes" : "no");
  Serial.print(F("Wi-Fi status code: ")); Serial.println(static_cast<int>(WiFi.status()));
  Serial.print(F("Wi-Fi begin issued: ")); Serial.println(wifiBeginIssued ? "yes" : "no");
  if (wifiReady()) {
    Serial.print(F("Wi-Fi RSSI: ")); Serial.println(WiFi.RSSI());
  }
  Serial.print(F("Cellular ready: ")); Serial.println(cellReady ? "yes" : "no");
  Serial.print(F("Cellular model: ")); Serial.println(cellularModel.length() ? cellularModel : "<unknown>");
  Serial.print(F("Cellular operator: ")); Serial.println(cellularOperator.length() ? cellularOperator : "<unknown>");
  Serial.print(F("APN: ")); Serial.println(apn.length() ? apn : "<automatic>");
  char usageBuffer[24] = {0};
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
  Serial.print(F("Cellular application TX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
  Serial.print(F("Cellular application RX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationTxBytes + wifiApplicationRxBytes));
  Serial.print(F("Wi-Fi application total: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  Serial.println(F("Usage counters exclude TLS/TCP/IP/radio overhead; Vodacom billing is authoritative."));
  Serial.print(F("Remote transport preference: ")); Serial.println(policy.transportPreference);
  Serial.print(F("Remote Wi-Fi enabled: ")); Serial.println(policy.wifiEnabled ? "yes" : "no");
  Serial.print(F("Remote cellular enabled: ")); Serial.println(policy.cellularEnabled ? "yes" : "no");
  Serial.print(F("Remote location enabled: ")); Serial.println(policy.locationEnabled ? "yes" : "no");
  Serial.print(F("Location interval min: ")); Serial.println(policy.locationIntervalMinutes);
  Serial.print(F("Movement threshold m: ")); Serial.println(policy.locationMinMoveM);
  Serial.print(F("GNSS configured: ")); Serial.println(DALLMAYR_GNSS_ENABLED ? "yes" : "no");
  Serial.print(F("GNSS valid fix: ")); Serial.println(gnssFix.valid ? "yes" : "no");
  if (gnssFix.valid) {
    Serial.print(F("GNSS lat/lng: ")); Serial.print(gnssFix.latitude, 6); Serial.print(F(", ")); Serial.println(gnssFix.longitude, 6);
    Serial.print(F("GNSS satellites: ")); Serial.println(gnssFix.satellites);
  }
  Serial.print(F("Policy: ")); Serial.print(policy.mode);
  Serial.print(F(" source=")); Serial.println(policy.source);
  Serial.print(F("Profile: ")); Serial.println(policy.profileId);
  Serial.print(F("Counters: ")); Serial.println(counterCount);
  Serial.print(F("Counter epoch: ")); Serial.println(counterEpoch);
  if (machineInterface == IFACE_MDB) {
    Serial.println(F("MDB status: physical pins reserved; 9-bit driver not enabled."));
  }
}

void printHelp() {
  Serial.println(F("Commands:"));
  Serial.println(F("  STATUS"));
  Serial.println(F("  SYNC CONFIG"));
  Serial.println(F("  HEARTBEAT NOW"));
  Serial.println(F("  LOCATION NOW"));
  Serial.println(F("  WIFI SET <ssid>|<password>"));
  Serial.println(F("  WIFI CLEAR"));
  Serial.println(F("  WIFI TEST"));
  Serial.println(F("  APN <name>        (blank value = automatic APN)"));
  Serial.println(F("  CELL TEST"));
  Serial.println(F("  SIM DATA TEST     (two safe simulation uploads over cellular only)"));
  Serial.println(F("  DATA USAGE        (local per-transport application byte counters)"));
  Serial.println(F("  CELL AT <command>"));
  Serial.println(F("  MACHINE SERIAL <serial>"));
  Serial.println(F("  SUPABASE ANON KEY <JWT>  (stored in NVS; never echoed)"));
  Serial.println(F("  ENROLL TOKEN <one-time-token>"));
  Serial.println(F("Machine MDB/DEX interface is compile-time locked until verified."));
}


void handleConsoleLine(String line) {
  line.trim();
  if (!line.length()) return;

  if (line.equalsIgnoreCase("STATUS")) { printStatus(); return; }
  if (line.equalsIgnoreCase("WIRING")) { printWiringMap(); return; }
  if (line.equalsIgnoreCase("HELP")) { printHelp(); return; }
  if (line.equalsIgnoreCase("SYNC CONFIG")) {
    lastConfigAttemptMs = 0;
    lastConfigSuccessMs = 0;
    syncRemotePolicy();
    return;
  }
  if (line.equalsIgnoreCase("UPLOAD NOW")) {
    counterUploadRequested = true;
    return;
  }
  if (line.equalsIgnoreCase("HEARTBEAT NOW")) {
    heartbeatUploadRequested = true;
    return;
  }
  if (line.equalsIgnoreCase("SIM DATA TEST")) {
    runVodacomSimDataTest();
    return;
  }
  if (line.equalsIgnoreCase("DATA USAGE")) {
    char usageBuffer[24] = {0};
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
    Serial.print(F("Cellular TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
    Serial.print(F("Cellular RX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationTxBytes));
    Serial.print(F("Wi-Fi TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationRxBytes));
    Serial.print(F("Wi-Fi RX JSON bytes: ")); Serial.println(usageBuffer);
    Serial.println(F("Carrier usage is higher because protocol and radio overhead are excluded."));
    return;
  }
  if (line.equalsIgnoreCase("DEX READ") || line.startsWith("DEX BAUD ") || line.startsWith("INTERFACE ")) {
    Serial.println(F("Machine I/O is locked in this production build until the MDB/DEX hardware interface is verified."));
    return;
  }
  if (line.equalsIgnoreCase("WIFI CLEAR")) {
    wifiSsid = "";
    wifiPassword = "";
    saveNetworkProvisioning();
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(true, false);
    wifiBeginIssued = false;
    wifiRadioDisabled = false;
    Serial.println(F("Stored Wi-Fi credentials cleared."));
    return;
  }
  if (line.startsWith("WIFI SET ")) {
    String value = line.substring(9);
    int separator = value.indexOf('|');
    if (separator <= 0) {
      Serial.println(F("Format: WIFI SET <ssid>|<password>"));
      return;
    }
    wifiSsid = value.substring(0, separator);
    wifiPassword = value.substring(separator + 1);
    wifiSsid.trim();
    if (!wifiSsid.length()) {
      Serial.println(F("SSID cannot be empty."));
      return;
    }
    saveNetworkProvisioning();
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(true, false);
    wifiBeginIssued = false;
    wifiRadioDisabled = false;
    Serial.println(F("Wi-Fi credentials stored in NVS. Password is not echoed."));
    return;
  }
  if (line.startsWith("ENROLL TOKEN ")) {
    if (deviceEnrolled()) {
      Serial.println(F("Device is already enrolled; token was not stored."));
      return;
    }
    enrollmentToken = line.substring(13);
    enrollmentToken.trim();
    if (enrollmentToken.length() < 16) {
      Serial.println(F("Enrollment token is too short / empty."));
      enrollmentToken = "";
      return;
    }
    saveEnrollmentToken();
    Serial.println(F("One-time enrollment token stored in NVS. It will be erased after successful enrollment."));
    lastEnrollmentAttemptMs = 0;
    return;
  }
  if (line.startsWith("SUPABASE ANON KEY ")) {
    supabaseAnonKey = line.substring(18);
    supabaseAnonKey.trim();
    if (supabaseAnonKey.length() < 80) {
      Serial.println(F("Supabase anon JWT is too short / empty."));
      supabaseAnonKey = "";
      return;
    }
    saveSupabaseAnonKey();
    Serial.println(F("Supabase anon JWT stored in NVS. The value is not echoed."));
    lastEnrollmentAttemptMs = 0;
    return;
  }

  if (line.startsWith("MACHINE SERIAL ")) {
    reportedMachineSerial = line.substring(15);
    reportedMachineSerial.trim();
    saveCoreSettings();
    Serial.print(F("Reported machine S/N saved: "));
    Serial.println(reportedMachineSerial);
    return;
  }
  if (line.equalsIgnoreCase("LOCATION NOW")) {
    if (!policy.locationEnabled) Serial.println(F("Location reporting is disabled by remote policy."));
    else if (!gnssFix.valid && !fallbackLocationConfigured()) Serial.println(F("No valid GNSS fix and no manual fallback coordinates configured."));
    else uploadLocationUpdate();
    return;
  }

  if (line.equalsIgnoreCase("WIFI TEST")) {
    if (!policy.wifiEnabled) {
      Serial.println(F("Wi-Fi is currently disabled by remote policy."));
    } else if (!wifiSsid.length()) {
      Serial.println(F("Wi-Fi is not provisioned. Use: WIFI SET <ssid>|<password>"));
    } else if (wifiReady()) {
      Serial.print(F("Wi-Fi connected. IP: "));
      Serial.println(WiFi.localIP());
      Serial.print(F("RSSI: "));
      Serial.println(WiFi.RSSI());
    } else if (!wifiBeginIssued) {
      maintainWiFi();
      Serial.println(F("Wi-Fi connection started."));
    } else {
      Serial.print(F("Wi-Fi is already connecting / auto-reconnecting. status="));
      Serial.println(static_cast<int>(WiFi.status()));
      Serial.println(F("No second WiFi.begin() was issued."));
    }
    return;
  }
  if (line.startsWith("APN")) {
    apn = line.length() > 3 ? line.substring(3) : "";
    apn.trim();
    saveCoreSettings();
    cellReady = false;
    Serial.println(F("APN saved; cellular bearer will reconnect."));
    return;
  }
  if (line.equalsIgnoreCase("CELL TEST")) {
    cellReady = initializeCellular();
    return;
  }
  if (line.startsWith("CELL AT ")) {
    String cmd = line.substring(8);
    cellDrain();
    CellSerial.print(cmd); CellSerial.print("\r\n");
    Serial.println(cellReadUntil(5000, "OK", "ERROR", true));
    return;
  }
  if (line.startsWith("TEST FAULT ") || line.startsWith("TEST RECOVERY ")) {
    Serial.println(F("Synthetic fault injection is disabled in production firmware."));
    return;
  }

  Serial.println(F("Unknown command. Type HELP."));
}

void serviceConsole() {
  static String line;
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      if (line.length()) {
        handleConsoleLine(line);
        line = "";
      }
    } else if (line.length() < 512) {
      line += c;
    }
  }
}

// -----------------------------------------------------------------------------
// Arduino setup / loop
// -----------------------------------------------------------------------------

void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(800);
  Serial.println();
  Serial.println(F("Dallmayr Telemetry V6.1 - VODACOM SIM DATA TEST + USAGE ACCOUNTING"));

  initializeDeviceIdentity();
  makeRandomId(bootId, sizeof(bootId));
  loadCoreSettings();
  loadCachedPolicy();
  loadCounters();
  memset(faults, 0, sizeof(faults));

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  CellSerial.begin(CELL_BAUD, SERIAL_8N1, CELL_RX_PIN, CELL_TX_PIN);
  if (!DALLMAYR_MACHINE_IO_ENABLED) {
    machineInterface = IFACE_DISABLED;
    Serial.println(F("PRODUCTION SAFETY: MDB/DEX machine I/O locked pending physical/protocol verification."));
  } else {
    restartMachineInterface();
  }
  startGnss();

  // Always publish a genuine device heartbeat after the first available transport comes up.
  heartbeatUploadRequested = true;
  lastWifiAttemptMs = millis();
  lastCellAttemptMs = millis() - CELL_RETRY_MS;
  lastCounterSaveMs = millis();
  lastDataUsageSaveMs = millis();
  printStatus();
  printHelp();
}

void loop() {
  serviceConsole();
  if (DALLMAYR_MACHINE_IO_ENABLED) serviceMachineInterface();
  serviceGnss();
  maintainCounterStorage();
  maintainDataUsageStorage();
  maintainWiFi();
  maintainCellular();
  maintainEnrollment();
  maintainRemotePolicy();
  serviceLocation();
  serviceUploads();
  delay(2);
}
