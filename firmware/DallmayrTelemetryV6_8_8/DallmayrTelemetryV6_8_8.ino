/*
  Dallmayr South Africa - Telemetry V6.8.8 DB-POLICY NATIVE MDB + DEX
  Production-oriented cellular/Wi-Fi telemetry build

  PRIMARY TARGET
  --------------
  - ESP32-S3 WROOM-1 N16R8 development board
  - DFRobot Gravity Air780E / Air780EU 4G Cat-1 module (UART + external 5 V supply)
  - SP3232EET RS-232 transceiver for DEX/UCS
  - Galvanically isolated MDB electrical interface between the vending machine
    and GPIO4/GPIO5. The ESP32-S3 performs MDB 9-bit framing/decoding itself.
  - Wide-input protected DC/DC supply: vending-machine rail -> regulated 5 V

  MDB PRODUCTION ARCHITECTURE
  ---------------------------
  - GPIO4: passive monitor of MDB Master Transmit (confirmed GREEN / MDB pin 5)
  - GPIO5: passive monitor of MDB Master Receive  (confirmed YELLOW / MDB pin 4)
  - WHITE / MDB pin 6: communications common on the MACHINE SIDE of the isolated
    interface; never connect it directly to an ESP32 GPIO.
  - Both ESP32 MDB pins stay INPUT-ONLY in normal production operation.
  - ESP32 RMT captures the waveform and software reconstructs:
      start + 8 data + mode bit + stop
  - Address/mode semantics and MDB checksums are validated before data is used.
  - A 9-bit encoder and block builder are included for diagnostics/future active
    interfaces, but ACTIVE MDB TRANSMISSION IS COMPILE-TIME DISABLED by default.
  - No external Nano/9-bit decoder is required.

  BACKEND
  -------
  - Supabase telemetry-config: remote live/daily/monthly policy control
  - Supabase telemetry-ingest: cumulative counter, heartbeat and fault-state ingest
  - Per-transport application and Air780E modem byte counters are included.
  - Production build does NOT auto-generate dummy sales/simulation telemetry.
  - No database row is created for every vend; cumulative counters are uploaded.

  SAFETY
  ------
  NEVER connect the vending-machine power rail, raw MDB bus, DEX/RS-232 levels,
  or any 24-45 V machine signal directly to ESP32 GPIO. GPIO4/GPIO5 must only
  see protected 3.3 V logic from the isolated MDB electrical interface.

  REQUIRED ARDUINO ENVIRONMENT
  ----------------------------
  - ArduinoJson 7.x
  - Arduino-ESP32 3.x (RMT API used by this sketch)
  - Preferences/WiFi/HTTPClient are supplied by the ESP32 Arduino core.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_mac.h>
#include <math.h>
#include <stdlib.h>
#include "esp32-hal-rmt.h"
#include <esp_arduino_version.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "Dallmayr V6.8 native MDB requires Arduino-ESP32 core 3.x or newer."
#endif

// -----------------------------------------------------------------------------
// Native MDB types
// -----------------------------------------------------------------------------
// These declarations intentionally live before the first sketch function.
// Arduino generates function prototypes during .ino preprocessing; keeping
// custom MDB types here ensures those generated prototypes can see the types.

struct MdbWord {
  uint8_t value;
  bool mode;
  bool framingValid;
};

struct MdbCashlessState {
  uint8_t scaleFactor = 1;
  uint8_t decimalPlaces = 2;
  bool scaleKnown = false;
  uint8_t featureLevel = 1;
  uint32_t supportedFeatureBits = 0;

  // MDB Level 3 Expansion Options. When either the 32-bit monetary-format bit
  // or the multi-currency bit is enabled, monetary fields use the expanded
  // 32-bit representation. This is learned from the VMC's checksum-valid
  // EXPANSION / ENABLE OPTIONS command instead of guessing from packet length.
  uint32_t enabledFeatureBits = 0;
  bool expandedCurrency = false;

  bool vendPending = false;
  bool vendApproved = false;
  uint16_t selection = 0xFFFF;
  uint32_t requestedScaledPrice = 0;
  uint32_t approvedScaledPrice = 0;
  uint32_t vendStartedMs = 0;

  uint8_t activeErrorCode = 0;
  bool errorActive = false;
  bool outOfSequenceActive = false;
};

struct MdbLastMasterContext {
  uint8_t address = 0;
  uint8_t command = 0;
  uint8_t subcommand = 0xFF;
  uint32_t atMs = 0;
};

struct MdbVendDedup {
  uint16_t selection = 0xFFFF;
  uint32_t priceCents = 0;
  bool success = false;
  uint32_t atMs = 0;
};

enum MdbTelemetryEventType : uint8_t {
  MDB_EVENT_VEND = 1,
  MDB_EVENT_CASHLESS_ERROR_SET = 2,
  MDB_EVENT_CASHLESS_ERROR_CLEAR = 3,
  MDB_EVENT_OUT_OF_SEQUENCE_SET = 4,
  MDB_EVENT_OUT_OF_SEQUENCE_CLEAR = 5
};

enum MdbVendReason : uint8_t {
  MDB_VEND_CASHLESS_SUCCESS = 1,
  MDB_VEND_CASHLESS_FAILURE = 2,
  MDB_VEND_CASH_SALE = 3,
  MDB_VEND_RESET_AFTER_APPROVAL = 4,
  MDB_VEND_BASKET_SUCCESS = 5,
  MDB_VEND_BASKET_FAILURE = 6
};

struct MdbTelemetryEvent {
  MdbTelemetryEventType type;
  uint8_t readerIndex;
  uint8_t code;
  uint8_t status;
  uint8_t reason;
  uint16_t selection;
  uint32_t priceCents;
  bool success;
};

// -----------------------------------------------------------------------------
// Explicit MDB prototypes - Arduino .ino preprocessor workaround
// -----------------------------------------------------------------------------
// Arduino generates prototypes automatically for functions in .ino sketches.
// Its prototype generator can place a generated prototype before a custom type
// declaration, which causes errors such as "MdbWord has not been declared".
// Declaring these prototypes ourselves after the MDB types prevents that.

size_t mdbEncodeMasterBlock(uint8_t address,
                            const uint8_t* data,
                            size_t dataLength,
                            MdbWord* out,
                            size_t outCapacity);
bool mdbQueueTelemetryEvent(const MdbTelemetryEvent& event);
uint32_t mdbReadBigEndian(const MdbWord* words, size_t offset, size_t bytes);
size_t mdbDecodeRmtWords(const rmt_data_t* symbols,
                         size_t symbolCount,
                         bool invert,
                         MdbWord* outWords,
                         size_t outCapacity,
                         uint32_t& framingErrors);
bool mdbMasterSegmentChecksumValid(const MdbWord* words,
                                   size_t start,
                                   size_t endInclusive,
                                   size_t& checksumIndex);
int mdbScoreMasterWords(const MdbWord* words, size_t count);
int mdbScoreSlaveWords(const MdbWord* words, size_t count);
size_t mdbDecodeWithPolarity(const rmt_data_t* symbols,
                             size_t symbolCount,
                             bool masterDirection,
                             int8_t& learnedInvert,
                             MdbWord* outWords,
                             size_t outCapacity);
void mdbHandleMasterBlock(const MdbWord* block, size_t count);
size_t mdbCashlessMessageLength(const MdbCashlessState& cashless,
                                const MdbWord* data,
                                size_t remaining);
void mdbHandleSlaveMessage(int cashlessIdx, const MdbWord* data, size_t dataCount);
void mdbHandleSlaveData(int cashlessIdx, const MdbWord* data, size_t dataCount);
void mdbProcessMasterWords(const MdbWord* words, size_t count);
void mdbProcessSlaveWords(const MdbWord* words, size_t count);
void mdbProcessCapture(const rmt_data_t* symbols,
                       size_t symbolCount,
                       bool masterDirection,
                       int8_t& learnedInvert);



// -----------------------------------------------------------------------------
// Firmware identity / backend preset
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// PRODUCTION SETTINGS
// -----------------------------------------------------------------------------
// This build embeds the Supabase public anon JWT. An enrolled unit loads its
// private per-device credential from ESP32 NVS, so uploading a new sketch must
// be done WITHOUT "Erase All Flash". A brand-new unit automatically retries
// zero-touch enrollment until an Administrator opens an enrollment window in
// DallmayrERP. A single-use token remains available as an emergency fallback.
// Configure Wi-Fi at runtime with:
//   WIFI SET <ssid>|<password>
// The credentials are stored in ESP32 NVS and are never printed back.
//
// If this ESP32 is already enrolled, its per-device credential remains in NVS.
// For another new unit or after erasing NVS, provision a fresh one-time token with:
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
// Simulation telemetry is available for this controlled commissioning build.
// It remains isolated from production sales and only runs from the console
// unless the explicit auto-run flag below is enabled.
#define DALLMAYR_SIM_DATA_TEST_ENABLED  true
// Keep automatic execution off: run SIM DATA TEST manually after cellular
// registration so the technician controls when dummy traffic is sent.
#define DALLMAYR_SIM_DATA_TEST_AUTO_RUN false
// Prefer the SIM for first-boot enrollment so the cellular path is proven.
// Wi-Fi remains available as a fallback and for normal remote operation.
#define DALLMAYR_ZERO_TOUCH_CELL_FIRST  true
//
// Machine-interface support is compiled in. Native MDB is the production
// default and is PASSIVE: GPIO4/GPIO5 are both RMT inputs.
//   INTERFACE MDB          (native passive 9-bit decoder on GPIO4/GPIO5)
//   INTERFACE DEX          (SP3232 on GPIO17/GPIO18)
//   INTERFACE DISABLED     (all machine capture off)
// Legacy MDB_BRIDGE NVS settings are migrated automatically to native MDB.
#define DALLMAYR_MACHINE_IO_ENABLED     true
// Prevent console-generated fake faults/recoveries in production.
#define DALLMAYR_ALLOW_TEST_COMMANDS    false
#define DALLMAYR_MDB_ACTIVE_TX_ENABLED  false   // must remain false for passive production telemetry
#define DALLMAYR_MDB_AUTO_POLARITY      true    // learns electrical-interface inversion from valid frames
#define DALLMAYR_DEFAULT_INTERFACE      2       // IFACE_MDB; passive native decoder

#if DALLMAYR_MDB_ACTIVE_TX_ENABLED
#error "Active MDB bus driving is intentionally not supported by this passive telemetry build."
#endif
//
// Generic NMEA GNSS receiver. Keep this OFF unless a physical GNSS module is
// fitted. UART0 is normally the ESP32-S3 programming/debug console and must
// never be reassigned while it is being used by Serial Monitor.
#define DALLMAYR_GNSS_ENABLED           0
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

static const char* FIRMWARE_VERSION = "6.8.8-esp32s3-air780eu-split-http-headers";
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
  CONFIRMED MDB 6-PIN CABLE MAP — MALE CONNECTOR FACE VIEW
  --------------------------------------------------------
  User-confirmed occupied-wire positions:
    MDB pin 4 = YELLOW = Master Receive
    MDB pin 5 = GREEN  = Master Transmit
    MDB pin 6 = WHITE  = Communications Common
    MDB pin 3 = empty / N.C.

  Production telemetry connection:
    GREEN / pin 5  -> MACHINE SIDE isolated MDB receiver -> 3.3 V logic -> GPIO4
    YELLOW / pin 4 -> MACHINE SIDE isolated MDB receiver -> 3.3 V logic -> GPIO5
    WHITE / pin 6  -> MACHINE SIDE communications reference for the isolated interface

  IMPORTANT:
  GPIO4 and GPIO5 are BOTH passive INPUTS in native MDB mode. The labels RX/TX
  describe MDB bus direction relative to the VMC, not ESP32 UART direction.
  Do not connect GREEN, YELLOW or WHITE directly to the ESP32.

  DEX wiring remains through the SP3232EET and must be verified independently.
  Cellular wiring is independent of the machine cable:
    Air780E/Air780EU TX -> ESP32 CELL_RX_PIN
    Air780E/Air780EU RX <- ESP32 CELL_TX_PIN
*/

#if CONFIG_IDF_TARGET_ESP32S3
// ---------------- ESP32-S3 WROOM-1 N16R8 prototype pin assignment ----------------
static const int CELL_RX_PIN = 1;   // GPIO1 <- Air780 TX (confirmed prototype wiring)
static const int CELL_TX_PIN = 2;   // GPIO2 -> Air780 RX (confirmed prototype wiring)

static const int DEX_RX_PIN  = 17;  // GPIO17 <- SP3232 R1OUT <- C130001 ORANGE (DEX TX from machine)
static const int DEX_TX_PIN  = 18;  // GPIO18 -> SP3232 T1IN  -> C130001 BROWN  (DEX RX to machine)

static const int MDB_VMC_TX_MONITOR_PIN = 4; // GPIO4 <- isolated logic copy of GREEN, MDB pin 5 / Master Transmit
static const int MDB_VMC_RX_MONITOR_PIN = 5; // GPIO5 <- isolated logic copy of YELLOW, MDB pin 4 / Master Receive
// Backward-compatible aliases used by a few status/wiring helpers.
static const int MDB_RX_PIN = MDB_VMC_TX_MONITOR_PIN;
static const int MDB_TX_PIN = MDB_VMC_RX_MONITOR_PIN;
#elif CONFIG_IDF_TARGET_ESP32
// Classic ESP32-WROOM compatibility for bench development.
// Same C130001 signal paths as above; only the ESP32 GPIO numbers differ.
static const int CELL_RX_PIN = 26;  // GPIO26 <- Air780E/Air780EU TX
static const int CELL_TX_PIN = 27;  // GPIO27 -> Air780E/Air780EU RX
static const int DEX_RX_PIN  = 32;  // GPIO32 <- SP3232 R1OUT <- C130001 ORANGE
static const int DEX_TX_PIN  = 33;  // GPIO33 -> SP3232 T1IN  -> C130001 BROWN
static const int MDB_VMC_TX_MONITOR_PIN = 34; // isolated logic copy of MDB Master Transmit
static const int MDB_VMC_RX_MONITOR_PIN = 25; // isolated logic copy of MDB Master Receive
static const int MDB_RX_PIN = MDB_VMC_TX_MONITOR_PIN;
static const int MDB_TX_PIN = MDB_VMC_RX_MONITOR_PIN;
#else
#error "This quoted-hardware sketch targets ESP32-S3 or classic ESP32."
#endif

static const uint32_t DEBUG_BAUD = 115200;
static const uint32_t CELL_BAUD  = 115200;
static const uint32_t DEFAULT_DEX_BAUD = 9600;
static const uint32_t DEFAULT_MDB_BRIDGE_BAUD = 115200; // legacy only; retained for NVS compatibility
static const uint32_t MDB_BAUD = 9600;
static const uint32_t MDB_RMT_HZ = 1000000UL;       // 1 us RMT tick
static const uint32_t MDB_BIT_US = 104;              // 1 / 9600 ≈ 104.17 us
static const uint16_t MDB_RX_IDLE_US = 2500;         // > 1 ms max inter-byte; < 5 ms response window
static const uint8_t MDB_NOISE_FILTER_US = 15;
static const uint32_t MDB_SIGNAL_LOSS_MS = 60000UL;
static const uint32_t MDB_RESPONSE_CONTEXT_MAX_MS = 25UL;
static const uint32_t MDB_DUPLICATE_VEND_WINDOW_MS = 2500UL;

HardwareSerial CellSerial(1);
HardwareSerial DexSerial(2);
#if DALLMAYR_GNSS_ENABLED
HardwareSerial GnssSerial0(0);
#endif
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
static const uint32_t CELL_RETRY_MS = 10000UL;
static const uint32_t DEX_REQUEST_TIMEOUT_MS = 15000UL;
static const uint32_t DEX_FRAME_IDLE_MS = 1800UL;
static const uint32_t COUNTER_SAVE_DEBOUNCE_MS = 5000UL;
static const uint32_t DATA_USAGE_SAVE_INTERVAL_MS = 300000UL;
static const uint32_t SERIAL_ALIVE_INTERVAL_MS = 5000UL;
// Network upload failures must never become a tight retry loop. A rejected
// MDB-derived record previously monopolised the Air780EU and starved config/heartbeat.
static const uint32_t FAULT_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t COUNTER_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t HEARTBEAT_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t CONFIG_ACK_RETRY_MS = 30000UL;
static const uint32_t TRANSPORT_COMMIT_RETRY_MS = 15000UL;

// -----------------------------------------------------------------------------
// Runtime configuration / state
// -----------------------------------------------------------------------------

enum MachineInterface : uint8_t {
  IFACE_DEX = 1,
  IFACE_MDB = 2,
  IFACE_NORMALIZED_UART = 3,
  IFACE_PULSE = 4,
  IFACE_DISABLED = 5,
  IFACE_MDB_BRIDGE = 6
};

struct RuntimePolicy {
  char mode[12];
  char source[16];
  char policyCode[24];
  char policyUpdatedAt[40];
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
uint64_t cellularModemTxBytes = 0;
uint64_t cellularModemRxBytes = 0;
bool cellularModemUsageAvailable = false;
uint32_t lastCellularModemUsageSampleMs = 0;
uint64_t wifiApplicationTxBytes = 0;
uint64_t wifiApplicationRxBytes = 0;
bool dataUsageStorageDirty = false;
uint32_t lastDataUsageSaveMs = 0;
MachineInterface machineInterface = static_cast<MachineInterface>(DALLMAYR_DEFAULT_INTERFACE);
uint32_t dexBaud = DEFAULT_DEX_BAUD;
uint32_t mdbBridgeBaud = DEFAULT_MDB_BRIDGE_BAUD;
String apn = DEFAULT_APN;
String cellularModel;
String cellularFirmware;
String cellularOperator;
uint32_t lastWifiAttemptMs = 0;
uint32_t wifiConnectionStartedMs = 0;
bool wifiBeginIssued = false;   // Prevent repeated WiFi.begin() while STA is still connecting.
bool wifiRadioDisabled = false;
static const uint32_t WIFI_STATUS_LOG_MS = 60000UL;
static const uint32_t WIFI_PRIMARY_GRACE_MS = 20000UL;

uint32_t lastConfigAttemptMs = 0;
uint32_t lastConfigSuccessMs = 0;
uint32_t lastCellAttemptMs = 0;
uint32_t lastCounterSaveMs = 0;
bool counterStorageDirty = false;
bool cellReady = false;
bool automaticSimulationTestCompleted = false;
bool counterUploadRequested = false;
bool heartbeatUploadRequested = false;
uint32_t lastEnrollmentAttemptMs = 0;
uint32_t lastSimulationUploadMs = 0;
uint32_t lastSerialAliveMs = 0;
uint32_t lastFaultUploadAttemptMs = 0;
uint32_t lastCounterUploadAttemptMs = 0;
uint32_t lastCounterUploadSuccessMs = 0;
uint32_t counterScheduleStartMs = 0;
uint32_t lastHeartbeatUploadAttemptMs = 0;
uint32_t lastHeartbeatUploadSuccessMs = 0;
uint32_t lastConfigAckAttemptMs = 0;
bool configAckPending = false;
// When a newly downloaded policy disables the connection that carried the
// configuration, keep that physical link alive until the config ACK and one
// heartbeat have both reached Supabase. This prevents the device from cutting
// off the only proven-good transport before the control change is committed.
bool transportTransitionPending = false;
char transportTransitionSource[12] = {0};
uint32_t lastTransportTransitionAttemptMs = 0;
uint8_t simulationSelectionCursor = 0;
uint64_t simulationSold[3] = { 100, 75, 50 };
uint64_t simulationRevenue[3] = { 250000, 187500, 125000 };
uint32_t lastMachineByteMs = 0;
uint32_t acceptedMachineRecords = 0;
uint32_t rejectedMachineRecords = 0;

static const uint32_t ENROLL_RETRY_MS = 15000UL;
static const uint32_t AUTOMATIC_SIM_TEST_RETRY_MS = 30000UL;

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
    case IFACE_MDB_BRIDGE: return "mdb_bridge_legacy";
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
  if (value == "MDB_BRIDGE" || value == "BRIDGE") return IFACE_MDB_BRIDGE;
  return static_cast<MachineInterface>(0);
}

bool selectableMachineInterface(MachineInterface iface) {
  return iface == IFACE_DEX || iface == IFACE_NORMALIZED_UART ||
         iface == IFACE_MDB || iface == IFACE_DISABLED;
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
  prefs.putULong("mdbbaud", mdbBridgeBaud);
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

void saveAutomaticSimulationTestCompleted(bool completed) {
  prefs.begin("dallmayr", false);
  prefs.putBool("sim_test_ok", completed);
  prefs.end();
  automaticSimulationTestCompleted = completed;
}

void invalidateStaleDeviceCredential() {
  if (!deviceKey.length()) return;
  Serial.println(F("DallmayrERP rejected the stored device credential; starting automatic re-enrollment."));
  deviceKey = "";
  enrollmentToken = DALLMAYR_ENROLLMENT_TOKEN;
  automaticSimulationTestCompleted = false;
  prefs.begin("dallmayr", false);
  prefs.remove("device_key");
  prefs.putString("enroll_token", enrollmentToken);
  prefs.putBool("sim_test_ok", false);
  prefs.end();
  lastEnrollmentAttemptMs = 0;
  lastSimulationUploadMs = 0;
}

void loadCoreSettings() {
  prefs.begin("dallmayr", true);
  apn = prefs.getString("apn", DEFAULT_APN);
  deviceKey = prefs.getString("device_key", "");
  wifiSsid = prefs.getString("wifi_ssid", DALLMAYR_WIFI_SSID);
  wifiPassword = prefs.getString("wifi_pass", DALLMAYR_WIFI_PASSWORD);
  enrollmentToken = prefs.getString("enroll_token", DALLMAYR_ENROLLMENT_TOKEN);
  supabaseAnonKey = prefs.getString("supabase_anon", DALLMAYR_SUPABASE_ANON_KEY);
  machineInterface = static_cast<MachineInterface>(prefs.getUChar("iface", DALLMAYR_DEFAULT_INTERFACE));
  dexBaud = prefs.getULong("dexbaud", DEFAULT_DEX_BAUD);
  mdbBridgeBaud = prefs.getULong("mdbbaud", DEFAULT_MDB_BRIDGE_BAUD);
  String epoch = prefs.getString("epoch", "");
  String usageEpoch = prefs.getString("usage_epoch", "");
  cellularApplicationTxBytes = prefs.getULong64("cell_app_tx", 0);
  cellularApplicationRxBytes = prefs.getULong64("cell_app_rx", 0);
  wifiApplicationTxBytes = prefs.getULong64("wifi_app_tx", 0);
  wifiApplicationRxBytes = prefs.getULong64("wifi_app_rx", 0);
  automaticSimulationTestCompleted = prefs.getBool("sim_test_ok", false);
  String storedMachineSerial = prefs.getString("machine_sn", "");
  prefs.end();

  reportedMachineSerial = String(DALLMAYR_MACHINE_SERIAL).length() ? String(DALLMAYR_MACHINE_SERIAL) : storedMachineSerial;
  // Automatic one-time migration from the old external MDB_BRIDGE mode.
  if (machineInterface == IFACE_MDB_BRIDGE) machineInterface = IFACE_MDB;
  if (!DALLMAYR_MACHINE_IO_ENABLED || !selectableMachineInterface(machineInterface)) {
    machineInterface = IFACE_DISABLED;
  }
  if (dexBaud < 1200 || dexBaud > 115200) dexBaud = DEFAULT_DEX_BAUD;
  if (mdbBridgeBaud < 1200 || mdbBridgeBaud > 921600) {
    mdbBridgeBaud = DEFAULT_MDB_BRIDGE_BAUD;
  }

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

void setCompleteCounter(const String& selection,
                        const String& product,
                        uint32_t priceCents,
                        uint64_t sold,
                        uint64_t failed,
                        uint64_t revenueCents) {
  CounterEntry* c = getCounter(selection);
  if (!c) {
    Serial.println(F("Counter table full; machine counter ignored."));
    return;
  }

  bool changed = c->soldTotal != sold || c->failedTotal != failed ||
                 c->revenueCentsTotal != revenueCents ||
                 c->priceCents != priceCents || product != c->product;
  c->soldTotal = sold;
  c->failedTotal = failed;
  c->revenueCentsTotal = revenueCents;
  c->priceCents = priceCents;
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

  // Production backoff: one deferred fault attempt per retry window. The old
  // implementation retried every pending fault on every loop iteration. A 4xx
  // response could therefore keep the modem busy continuously and prevent
  // heartbeat/config servicing.
  uint32_t now = millis();
  if (lastFaultUploadAttemptMs != 0 && now - lastFaultUploadAttemptMs < FAULT_UPLOAD_RETRY_MS) return;

  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    LocalFault& f = faults[i];
    if (!f.used || !f.pendingUpload) continue;
    lastFaultUploadAttemptMs = now;
    if (uploadFaultState(f.code, f.active, f.severity, "queued", "Deferred fault state", "")) {
      f.pendingUpload = false;
    } else {
      Serial.println(F("Deferred fault upload failed; backing off for 30 seconds."));
    }
    return; // Never drain multiple failed records in one application-loop pass.
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
  // Match a complete OK result line. With command echo still active, searching
  // for the two letters "OK" could accidentally match inside a URL or secret.
  String successToken = expected;
  if (strcmp(expected, "OK") == 0) successToken = "\r\nOK\r\n";
  String response = cellReadUntil(timeoutMs, successToken.c_str(), "ERROR\r\n");
  if (response.indexOf(successToken) >= 0) return true;
  if (tolerateError && response.indexOf("ERROR") >= 0) return true;
  Serial.print(F("CELL command failed: "));
  bool sensitive = command.startsWith("AT+HTTPPARA=\"USERDATA\"") ||
                   command.startsWith("AT+HTTPPARA=\"USER_DEFINED\"");
  if (sensitive) {
    Serial.println(F("AT+HTTPPARA=<redacted HTTP header>"));
    // The modem can echo the complete rejected AT command even after ATE0.
    // Never print that response because it may contain the private device key.
    int errorPos = response.lastIndexOf("+CME ERROR");
    if (errorPos < 0) errorPos = response.lastIndexOf("ERROR");
    if (errorPos >= 0) {
      String errorLine = response.substring(errorPos);
      int lineEnd = errorLine.indexOf('\n');
      if (lineEnd >= 0) errorLine = errorLine.substring(0, lineEnd);
      errorLine.trim();
      Serial.println(errorLine);
    } else {
      Serial.println(F("Sensitive modem response redacted."));
    }
  } else {
    Serial.println(command);
    Serial.println(response);
  }
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

bool parseUnsigned64(const String& value, uint64_t& parsed) {
  String clean = value;
  clean.trim();
  if (!clean.length()) return false;
  for (size_t i = 0; i < clean.length(); ++i) {
    if (!isDigit(clean.charAt(i))) return false;
  }
  parsed = strtoull(clean.c_str(), nullptr, 10);
  return true;
}

bool readCellModemDataUsage(bool printResult = false) {
  String response = cellQueryText("AT^DATAINFO", 4000);
  int marker = response.indexOf("^DATAINFO:");
  if (marker < 0) {
    cellularModemUsageAvailable = false;
    if (printResult) Serial.println(F("Air780E modem data counter is unavailable."));
    return false;
  }

  int comma = response.indexOf(',', marker);
  int lineEnd = response.indexOf('\n', comma + 1);
  if (comma < 0) {
    cellularModemUsageAvailable = false;
    return false;
  }
  if (lineEnd < 0) lineEnd = response.length();

  uint64_t tx = 0;
  uint64_t rx = 0;
  String txText = response.substring(marker + 10, comma);
  String rxText = response.substring(comma + 1, lineEnd);
  rxText.replace("OK", "");
  if (!parseUnsigned64(txText, tx) || !parseUnsigned64(rxText, rx)) {
    cellularModemUsageAvailable = false;
    if (printResult) Serial.println(F("Air780E modem data counter response could not be parsed."));
    return false;
  }

  cellularModemTxBytes = tx;
  cellularModemRxBytes = rx;
  cellularModemUsageAvailable = true;
  lastCellularModemUsageSampleMs = millis();
  if (printResult) {
    char valueBuffer[24] = {0};
    snprintf(valueBuffer, sizeof(valueBuffer), "%llu", static_cast<unsigned long long>(tx));
    Serial.print(F("Air780E network TX total: ")); Serial.print(valueBuffer); Serial.println(F(" B"));
    snprintf(valueBuffer, sizeof(valueBuffer), "%llu", static_cast<unsigned long long>(rx));
    Serial.print(F("Air780E network RX total: ")); Serial.print(valueBuffer); Serial.println(F(" B"));
  }
  return true;
}

bool enableCellModemDataUsage() {
  // Air780E AT^DATAINFO counters include cellular protocol traffic and persist
  // in the modem. A 30-second save period is the module's supported minimum.
  if (!cellCommand("AT^DATAINFO=1,30", "OK", 3000)) {
    Serial.println(F("WARNING: Air780E firmware did not enable AT^DATAINFO counters."));
    cellularModemUsageAvailable = false;
    return false;
  }
  return readCellModemDataUsage(true);
}

String readCellModel() {
  String response = cellQueryText("AT+CGMM");
  response.replace("AT+CGMM", "");
  response.replace("OK", "");
  response.trim();
  int firstNl = response.indexOf('\n');
  if (firstNl >= 0) response = response.substring(0, firstNl);
  response.trim();
  return response;
}

String readCellFirmware() {
  String response = cellQueryText("AT+CGMR", 4000);
  response.replace("AT+CGMR", "");
  response.replace("OK", "");
  response.trim();
  int firstNl = response.indexOf('\n');
  if (firstNl >= 0) response = response.substring(0, firstNl);
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
  cellCommand("AT+CMEE=2", "OK", 1500, true);
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
  cellularFirmware = readCellFirmware();
  if (cellularFirmware.length()) {
    Serial.print(F("Cellular firmware: "));
    Serial.println(cellularFirmware);
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
  String epsRegistration = cellQueryText("AT+CEREG?", 2500);
  String packetRegistration = cellQueryText("AT+CGREG?", 2500);
  Serial.print(F("EPS registration: ")); Serial.println(epsRegistration);
  Serial.print(F("Packet registration: ")); Serial.println(packetRegistration);

  cellCommand("AT+SAPBR=0,1", "OK", 2500, true);
  if (!cellCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 2500)) return false;
  String apnCmd = "AT+SAPBR=3,1,\"APN\",\"" + apn + "\"";
  if (!cellCommand(apnCmd, "OK", 2500)) return false;
  if (!cellCommand("AT+SAPBR=1,1", "OK", 15000, true)) return false;
  String bearerStatus = cellQueryText("AT+SAPBR=2,1", 4000);
  if (bearerStatus.indexOf("+SAPBR: 1,1") < 0) {
    Serial.println(F("Cellular bearer opened without a usable IPv4 address."));
    Serial.println(bearerStatus);
    return false;
  }
  Serial.print(F("Cellular bearer: ")); Serial.println(bearerStatus);

  cellReady = true;
  cellularOperator = readCellOperator();
  int csq = readCellCsq();
  Serial.print(F("Air780E/Air780EU online. CSQ="));
  Serial.println(csq);
  enableCellModemDataUsage();
  return true;
}

void maintainCellular() {
  String preferredTransport = policy.transportPreference;
  preferredTransport.toLowerCase();
  bool wifiIsPrimary = policy.wifiEnabled
    && wifiSsid.length()
    && preferredTransport != "cellular";

  // When the DB policy says Wi-Fi should be used, give an already-provisioned
  // Wi-Fi station a clean startup window before bringing up the modem. This
  // makes a Wi-Fi test unambiguous while retaining cellular as a control-plane
  // recovery path if Wi-Fi cannot connect.
  if (wifiIsPrimary) {
    if (wifiReady() && !policy.cellularEnabled) return;
    if (!cellReady && wifiBeginIssued && wifiConnectionStartedMs != 0
        && millis() - wifiConnectionStartedMs < WIFI_PRIMARY_GRACE_MS) {
      return;
    }
  }

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

bool air780HttpsStateIsEnabled(String response) {
  response.replace(" ", "");
  return response.indexOf("+HTTPSSL:1") >= 0;
}

bool beginAir780HttpsSession() {
  // Use the same HTTPINIT -> HTTPSSL sequence that previously completed
  // cellular uploads against DallmayrERP. Air780EU V1180 can retain HTTPSSL
  // across HTTPTERM and then return +CME ERROR when HTTPSSL=1 is repeated.
  // Querying after HTTPINIT lets us accept that valid persistent state without
  // cycling SSL or applying extra SSLCFG values that can upset the TLS session.
  cellCommand("AT+HTTPTERM", "OK", 2500, true);
  delay(350);

  if (!cellCommand("AT+HTTPINIT", "OK", 3500)) return false;

  String sslState = cellQueryText("AT+HTTPSSL?", 3000);
  bool sslEnabled = air780HttpsStateIsEnabled(sslState);
  if (sslEnabled) {
    Serial.println(F("Air780E HTTPS was already enabled."));
  } else {
    if (cellCommand("AT+HTTPSSL=1", "OK", 3500)) {
      sslEnabled = true;
    } else {
      // A rejected set command is non-fatal only when the follow-up query
      // proves the modem did enable/retain HTTPS.
      delay(350);
      sslState = cellQueryText("AT+HTTPSSL?", 3000);
      sslEnabled = air780HttpsStateIsEnabled(sslState);
      if (sslEnabled) Serial.println(F("Air780E HTTPS verified enabled after a non-standard command response."));
    }
  }

  if (!sslEnabled) {
    Serial.println(F("Air780E HTTPS unavailable. Modem firmware/status follows:"));
    Serial.println(cellQueryText("AT+CGMR", 4000));
    Serial.println(cellQueryText("AT+HTTPSSL=?", 3000));
    Serial.println(cellQueryText("AT+HTTPSSL?", 3000));
    cellCommand("AT+HTTPTERM", "OK", 2000, true);
    return false;
  }

  return true;
}

bool setAir780HttpHeader(const String& name, const String& value) {
  if (!name.length() || !value.length() || name.indexOf('"') >= 0 ||
      value.indexOf('"') >= 0 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
    Serial.println(F("Refusing invalid Air780E HTTP header."));
    return false;
  }

  // Air780E/Air780EU supports repeated USER_DEFINED commands and accumulates
  // them. Sending each header separately avoids the V1180 parser rejecting one
  // oversized USERDATA command containing two JWTs plus the device credential.
  String command = "AT+HTTPPARA=\"USER_DEFINED\",\"" + name + ": " + value + "\"";
  return cellCommand(command, "OK", 3500);
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

  if (!beginAir780HttpsSession()) return false;
  if (!cellCommand("AT+HTTPPARA=\"CID\",1", "OK", 2500)) return false;

  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + String(url) + "\"";
  if (!cellCommand(urlCmd, "OK", 4000)) return false;
  if (!cellCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2500)) return false;
  // Keep Supabase gateway JWT verification enabled, then add the independent
  // per-device credential for config/ingest calls. Air780EU V1180 rejects the
  // combined header block, so use the modem's documented accumulating
  // USER_DEFINED form and submit each header as its own short AT command.
  if (!setAir780HttpHeader("Authorization", "Bearer " + supabaseAnonKey)) return false;
  if (!setAir780HttpHeader("apikey", supabaseAnonKey)) return false;
  if (withDeviceAuth) {
    if (!deviceEnrolled()) return false;
    if (!setAir780HttpHeader("X-Device-ID", deviceId)) return false;
    if (!setAir780HttpHeader("X-Device-Key", deviceKey)) return false;
    if (!setAir780HttpHeader("X-Firmware-Version", FIRMWARE_VERSION)) return false;
  }

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
  String action = cellReadUntil(65000, "+HTTPACTION:", "ERROR");
  if (action.indexOf("+HTTPACTION:") < 0) {
    Serial.println(F("No HTTPACTION result from Air780E/Air780EU."));
    if (action.length()) Serial.println(action);
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
  if (withDeviceAuth && statusCode == 401) invalidateStaleDeviceCredential();
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
#if !DALLMAYR_GNSS_ENABLED
  gnssSerial = nullptr;
  Serial.println(F("GNSS disabled; no optional receiver is fitted and the debug UART remains untouched."));
  return;
#else
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
#endif
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
  bool holdForConfigCommit = transportTransitionPending
    && strcmp(transportTransitionSource, "wifi") == 0
    && wifiReady();

  // A policy change is not allowed to tear down the connection that carried
  // the config until the ACK + commit heartbeat have completed.
  if (!policy.wifiEnabled && holdForConfigCommit) {
    return;
  }

  // Remote control can disable Wi-Fi per telemetry device.
  if (!policy.wifiEnabled || !wifiSsid.length()) {
    if (wifiBeginIssued && !wifiRadioDisabled) {
      Serial.println(F("Wi-Fi disabled by remote policy/config."));
      WiFi.setAutoReconnect(false);
      WiFi.disconnect(true, false);
      wifiBeginIssued = false;
      wifiRadioDisabled = true;
      wifiConnectionStartedMs = 0;
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
    wifiConnectionStartedMs = lastWifiAttemptMs;
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

  if (withDeviceAuth && statusCode == 401) invalidateStaleDeviceCredential();
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
  usage["sample_uptime_ms"] = millis();
  if (strcmp(transport, "cellular") == 0) {
    // A heartbeat refreshes this immediately before upload. Other telemetry
    // reuses that fresh sample for up to five seconds to avoid two back-to-back
    // AT^DATAINFO requests during the same transmission.
    if (cellReady && (lastCellularModemUsageSampleMs == 0 ||
        millis() - lastCellularModemUsageSampleMs > 5000UL)) {
      readCellModemDataUsage(false);
    }
    usage["application_tx_bytes_total"] = cellularApplicationTxBytes;
    usage["application_rx_bytes_total"] = cellularApplicationRxBytes;
    usage["application_bytes_total"] = cellularApplicationTxBytes + cellularApplicationRxBytes;
    if (cellularModemUsageAvailable) {
      usage["modem_tx_bytes_total"] = cellularModemTxBytes;
      usage["modem_rx_bytes_total"] = cellularModemRxBytes;
      usage["modem_bytes_total"] = cellularModemTxBytes + cellularModemRxBytes;
    }
  } else if (strcmp(transport, "wifi") == 0) {
    usage["application_tx_bytes_total"] = wifiApplicationTxBytes;
    usage["application_rx_bytes_total"] = wifiApplicationRxBytes;
    usage["application_bytes_total"] = wifiApplicationTxBytes + wifiApplicationRxBytes;
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
  // An empty token requests the secure administrator-controlled enrollment
  // window. A stored token selects the legacy one-time-token fallback.
  if (enrollmentToken.length()) doc["enrollment_token"] = enrollmentToken;
  doc["hardware_uid"] = hardwareUid;
  doc["firmware"] = FIRMWARE_VERSION;
  if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;

  String payload;
  serializeJson(doc, payload);

  if (DALLMAYR_ZERO_TOUCH_CELL_FIRST
      && cellReady && airHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "cellular";
    return true;
  }
  if (wifiReady() && wifiHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "wifi";
    return true;
  }
  if (!DALLMAYR_ZERO_TOUCH_CELL_FIRST
      && cellReady && airHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "cellular";
    return true;
  }
  return false;
}

bool performEnrollment() {
  if (deviceEnrolled()) return true;
  if (!hardwareUid.length()) return false;
  if (!wifiReady() && !cellReady) return false;

  Serial.print(F("Automatic enrollment attempt method="));
  Serial.print(enrollmentToken.length() ? "one_time_token" : "administrator_window");
  Serial.print(F(" device="));
  Serial.println(deviceId);
  String body;
  String usedTransport;
  int status = 0;
  if (!enrollOverAvailableNetwork(body, status, usedTransport)) {
    Serial.print(F("Enrollment failed HTTP="));
    Serial.println(status);
    if (body.length()) Serial.println(body);
    if (status == 403 && !enrollmentToken.length()) {
      Serial.println(F("Waiting for an Administrator to select 'Allow next device' in DallmayrERP."));
    } else if (status == 409) {
      Serial.println(F("This hardware UID already exists. Recommission it from DallmayrERP if NVS was erased."));
    }
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
  Serial.print(F("Enrollment method: "));
  Serial.println(String(doc["enrollment_method"] | (enrollmentToken.length() ? "one_time_token" : "automatic_window")));
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

bool sendDocumentToIngestViaTransport(JsonDocument& doc, const char* transport) {
  if (!deviceEnrolled() || !transport) return false;

  bool isWifi = strcmp(transport, "wifi") == 0;
  bool isCellular = strcmp(transport, "cellular") == 0;
  if (!isWifi && !isCellular) return false;
  if (isWifi && !wifiReady()) return false;
  if (isCellular && !cellReady) return false;

  addTransportMetadata(doc, transport);
  addDataUsageMetadata(doc, transport);

  String payload;
  serializeJson(doc, payload);
  String body;
  int status = 0;
  bool ok = isWifi
    ? wifiHttpPost(INGEST_URL, payload, body, status)
    : airHttpPost(INGEST_URL, payload, body, status);

  if (ok) {
    Serial.print(F("Telemetry uploaded via forced config-commit transport "));
    Serial.println(transport);
    return true;
  }

  Serial.print(F("Forced config-commit telemetry failed via "));
  Serial.print(transport);
  Serial.print(F(" HTTP="));
  Serial.println(status);
  return false;
}

bool uploadHeartbeatViaTransport(const char* transport) {
  bool modemSampleFresh = false;
  if (transport && strcmp(transport, "cellular") == 0 && cellReady) {
    modemSampleFresh = readCellModemDataUsage(false);
  }

  JsonDocument doc;
  addCommonPayload(doc, "heartbeat");
  doc["data_usage_requested"] = true;
  doc["cellular_modem_usage_available"] = cellularModemUsageAvailable;
  doc["cellular_modem_sample_fresh"] = modemSampleFresh;
  doc["config_commit"] = true;

  bool ok = sendDocumentToIngestViaTransport(doc, transport);
  if (ok) {
    heartbeatUploadRequested = false;
    lastHeartbeatUploadSuccessMs = millis();
    saveDataUsageNow();
    Serial.println(F("Config-commit heartbeat accepted."));
  }
  return ok;
}

bool uploadHeartbeat() {
  // Refresh the Air780E carrier counters before every pulse check. The normal
  // data_usage object is then attached by sendDocumentToIngest() for whichever
  // transport actually carries the heartbeat. Supabase also measures the exact
  // request and response byte lengths for this individual heartbeat.
  bool modemSampleFresh = false;
  if (cellReady) modemSampleFresh = readCellModemDataUsage(false);

  JsonDocument doc;
  addCommonPayload(doc, "heartbeat");
  doc["data_usage_requested"] = true;
  doc["cellular_modem_usage_available"] = cellularModemUsageAvailable;
  doc["cellular_modem_sample_fresh"] = modemSampleFresh;
  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    heartbeatUploadRequested = false;
    lastHeartbeatUploadSuccessMs = millis();
    // The HTTP request/response counters are incremented during transmission.
    // Persist those new totals immediately instead of waiting for the normal
    // five-minute NVS debounce window.
    saveDataUsageNow();
    Serial.println(F("Heartbeat pulse accepted with current data-usage totals."));
  }
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
  policy.counterDue = false;
  lastCounterUploadSuccessMs = millis();
  counterScheduleStartMs = lastCounterUploadSuccessMs;
  return true;
}

bool sendCellularSimulationSnapshot(const char* testBootId, uint64_t soldTotal,
                                    uint64_t revenueCentsTotal, JsonDocument& responseDoc,
                                    size_t& requestBytes, size_t& responseBytes) {
  JsonDocument doc;
  addCommonPayload(doc, "simulation_snapshot");
  doc["schema"] = 3;
  doc["simulation"] = true;
  doc["test_mode"] = "automatic_power_on";
  doc["boot_id"] = testBootId;
  doc["counter_epoch"] = String("SIM-") + hardwareUid;
  doc["machine_status"] = "online";
  doc["active_fault_count"] = 0;
  doc["telemetry_source"] = "database_field_test";
  addTransportMetadata(doc, "cellular");
  addDataUsageMetadata(doc, "cellular");

  JsonArray items = doc["items"].to<JsonArray>();
  JsonObject item = items.add<JsonObject>();
  item["selection"] = "TEST-A1";
  item["product"] = "Automatic telemetry test product";
  item["configured_price_cents"] = 1500;
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

  bool modemUsageAtStart = readCellModemDataUsage(true);
  if (!modemUsageAtStart) modemUsageAtStart = enableCellModemDataUsage();
  uint64_t modemTxBefore = cellularModemTxBytes;
  uint64_t modemRxBefore = cellularModemRxBytes;

  char testBootId[33] = {0};
  makeRandomId(testBootId, sizeof(testBootId));
  uint64_t applicationTxBefore = cellularApplicationTxBytes;
  uint64_t applicationRxBefore = cellularApplicationRxBytes;
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

  // Refresh the modem counters, then send the same cumulative snapshot once
  // more. Its delta is zero, but it reports the usage totals from both test
  // uploads to DallmayrERP over cellular. The backend also independently
  // counts all three HTTP request/response bodies.
  readCellModemDataUsage(false);
  JsonDocument usageReportResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 1, 1500, usageReportResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED while reporting final data usage."));
    return false;
  }
  long usageReportUnits = usageReportResponse["daily_delta_units"] | -1;
  long usageReportRevenue = usageReportResponse["daily_delta_revenue_cents"] | -1;
  if (usageReportUnits != 0 || usageReportRevenue != 0) {
    Serial.println(F("SIM DATA TEST FAILED: final usage snapshot was not idempotent."));
    return false;
  }

  bool modemUsageAtEnd = readCellModemDataUsage(false);
  saveDataUsageNow();
  saveAutomaticSimulationTestCompleted(true);
  lastSimulationUploadMs = millis();

  uint64_t applicationTxDelta = cellularApplicationTxBytes >= applicationTxBefore
    ? cellularApplicationTxBytes - applicationTxBefore : 0;
  uint64_t applicationRxDelta = cellularApplicationRxBytes >= applicationRxBefore
    ? cellularApplicationRxBytes - applicationRxBefore : 0;
  char byteBuffer[24] = {0};
  Serial.println(F("SIM DATA TEST PASSED: DallmayrERP accepted the cellular-only dummy telemetry."));
  snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(applicationTxDelta));
  Serial.print(F("Test application TX JSON bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
  snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(applicationRxDelta));
  Serial.print(F("Test application RX JSON bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
  if (modemUsageAtStart && modemUsageAtEnd
      && cellularModemTxBytes >= modemTxBefore && cellularModemRxBytes >= modemRxBefore) {
    uint64_t modemTxDelta = cellularModemTxBytes - modemTxBefore;
    uint64_t modemRxDelta = cellularModemRxBytes - modemRxBefore;
    snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(modemTxDelta));
    Serial.print(F("Test Air780E network TX bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
    snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(modemRxDelta));
    Serial.print(F("Test Air780E network RX bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
    if (modemTxDelta == 0 && modemRxDelta == 0) {
      Serial.println(F("WARNING: modem counters did not move; wait 30 seconds and run SIM DATA TEST again."));
    }
  } else {
    Serial.println(F("Air780E network byte delta unavailable; DallmayrERP HTTP acceptance still proves cellular transfer."));
  }
  Serial.println(F("Vodacom's portal remains authoritative because carrier accounting can include additional overhead."));
  return true;
}

void serviceAutomaticSimDataTest() {
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED || !DALLMAYR_SIM_DATA_TEST_AUTO_RUN) return;
  if (automaticSimulationTestCompleted) return;
  if (!deviceEnrolled() || !cellReady) return;
  if (lastSimulationUploadMs != 0
      && millis() - lastSimulationUploadMs < AUTOMATIC_SIM_TEST_RETRY_MS) return;
  lastSimulationUploadMs = millis();
  Serial.println(F("Starting automatic cellular database-field test..."));
  if (!runVodacomSimDataTest()) {
    Serial.println(F("Automatic test did not pass; firmware will retry without user input."));
  }
}

bool uploadConfigAck() {
  if (!deviceEnrolled()) return false;
  if (!wifiReady() && !cellReady) return false;

  JsonDocument doc;
  addCommonPayload(doc, "config_ack");
  JsonObject applied = doc["applied_config"].to<JsonObject>();
  applied["policy_code"] = policy.policyCode;
  applied["policy_source"] = policy.source;
  if (strlen(policy.policyUpdatedAt)) applied["policy_updated_at"] = policy.policyUpdatedAt;
  applied["mode"] = policy.mode;
  applied["counter_interval_minutes"] = policy.counterIntervalMinutes;
  applied["heartbeat_interval_minutes"] = policy.heartbeatIntervalMinutes;
  applied["config_refresh_minutes"] = policy.configRefreshMinutes;
  applied["fault_reporting_immediate"] = policy.immediateFaults;
  applied["recovery_reporting_immediate"] = policy.immediateRecovery;
  applied["profile_id"] = policy.profileId;
  applied["transport_preference"] = policy.transportPreference;
  applied["wifi_enabled"] = policy.wifiEnabled;
  applied["cellular_enabled"] = policy.cellularEnabled;
  applied["location_enabled"] = policy.locationEnabled;
  applied["location_interval_minutes"] = policy.locationIntervalMinutes;
  applied["location_min_move_m"] = policy.locationMinMoveM;

  String payload;
  serializeJson(doc, payload);
  String responseBody;
  String usedTransport;
  int status = 0;

  // Config acknowledgement is control-plane traffic. It may use either
  // physically available transport even if the newly-applied policy disables
  // that transport, preventing a remote setting from hiding its own ACK.
  bool ok = postRawWithFailover(
    INGEST_URL, payload, responseBody, status, usedTransport, true
  );
  if (!ok) {
    Serial.print(F("Config ACK failed HTTP="));
    Serial.println(status);
    return false;
  }

  JsonDocument response;
  DeserializationError err = deserializeJson(response, responseBody);
  if (!err && response["accepted"].is<bool>() && !response["accepted"].as<bool>()) {
    Serial.println(F("Config ACK was not accepted by Supabase."));
    return false;
  }

  configAckPending = false;
  // Every applied configuration is followed by a heartbeat. If the config
  // disables the current transport, serviceTransportTransitionCommit() sends
  // that pulse over the proven config transport before it is released.
  heartbeatUploadRequested = true;
  saveDataUsageNow();
  Serial.print(F("Applied DB configuration acknowledged via "));
  Serial.println(usedTransport);
  return true;
}

void serviceConfigAck() {
  if (!configAckPending || !deviceEnrolled()) return;
  if (!wifiReady() && !cellReady) return;
  uint32_t now = millis();
  if (lastConfigAckAttemptMs != 0 &&
      now - lastConfigAckAttemptMs < CONFIG_ACK_RETRY_MS) return;
  lastConfigAckAttemptMs = now;
  uploadConfigAck();
}

void serviceTransportTransitionCommit() {
  if (!transportTransitionPending) return;
  if (configAckPending) return;

  uint32_t now = millis();
  if (lastTransportTransitionAttemptMs != 0
      && now - lastTransportTransitionAttemptMs < TRANSPORT_COMMIT_RETRY_MS) return;
  lastTransportTransitionAttemptMs = now;

  Serial.print(F("Committing transport change with final heartbeat over "));
  Serial.println(transportTransitionSource);

  if (!uploadHeartbeatViaTransport(transportTransitionSource)) {
    Serial.println(F("Transport change commit heartbeat failed; keeping the proven transport alive and retrying."));
    return;
  }

  transportTransitionPending = false;
  transportTransitionSource[0] = '\0';
  lastTransportTransitionAttemptMs = 0;
  Serial.println(F("Transport change committed. New DB transport policy may now take effect."));
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
  copyText(policy.policyCode, sizeof(policy.policyCode), p["code"] | "live");
  copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), p["updated_at"] | "");
  copyText(policy.profileId, sizeof(policy.profileId), doc["assignment"]["profile_id"] | "");
  policy.counterIntervalMinutes = p["counter_interval_minutes"] | 5;
  policy.heartbeatIntervalMinutes = p["heartbeat_interval_minutes"] | 1;
  policy.configRefreshMinutes = p["config_refresh_minutes"] | 5;
  if (policy.counterIntervalMinutes == 0) policy.counterIntervalMinutes = 1;
  if (policy.heartbeatIntervalMinutes == 0) policy.heartbeatIntervalMinutes = 1;
  if (policy.configRefreshMinutes == 0) policy.configRefreshMinutes = 1;
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
  prefs.putString("pcode", policy.policyCode);
  prefs.putString("pupdated", policy.policyUpdatedAt);
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

  configAckPending = true;
  lastConfigAckAttemptMs = 0;

  transportTransitionPending = false;
  transportTransitionSource[0] = '\0';
  bool configTransportWillBeDisabled =
    (usedTransport == "wifi" && !policy.wifiEnabled)
    || (usedTransport == "cellular" && !policy.cellularEnabled);
  if (configTransportWillBeDisabled) {
    transportTransitionPending = true;
    copyText(transportTransitionSource, sizeof(transportTransitionSource), usedTransport);
    lastTransportTransitionAttemptMs = 0;
    Serial.print(F("Transport change staged: keeping "));
    Serial.print(usedTransport);
    Serial.println(F(" alive until config ACK + heartbeat commit."));
  }

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
  Serial.print(F("DB intervals min: heartbeat="));
  Serial.print(policy.heartbeatIntervalMinutes);
  Serial.print(F(" counters="));
  Serial.print(policy.counterIntervalMinutes);
  Serial.print(F(" config="));
  Serial.println(policy.configRefreshMinutes);
  return true;
}

void loadCachedPolicy() {
  memset(&policy, 0, sizeof(policy));
  copyText(policy.mode, sizeof(policy.mode), "live");
  copyText(policy.source, sizeof(policy.source), "cached-default");
  copyText(policy.policyCode, sizeof(policy.policyCode), "live");
  copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), "");
  copyText(policy.transportPreference, sizeof(policy.transportPreference), "auto");
  policy.counterIntervalMinutes = 5;
  policy.heartbeatIntervalMinutes = 1;
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
  String policyCode = prefs.getString("pcode", "");
  if (policyCode.length()) copyText(policy.policyCode, sizeof(policy.policyCode), policyCode);
  String policyUpdatedAt = prefs.getString("pupdated", "");
  if (policyUpdatedAt.length()) copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), policyUpdatedAt);
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


bool runWifiDatabaseTest() {
  Serial.println(F("--- WIFI DB TEST: Wi-Fi only, cellular fallback disabled ---"));
  if (!deviceEnrolled()) {
    Serial.println(F("WIFI DB TEST FAILED: device is not enrolled."));
    return false;
  }
  if (!wifiSsid.length()) {
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi is not provisioned. Use WIFI SET <ssid>|<password>."));
    return false;
  }
  if (!wifiReady()) {
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi is not connected."));
    Serial.println(F("Run WIFI TEST and wait for an IP address first."));
    return false;
  }

  // Temporarily hide the modem from the generic control-plane failover helpers.
  // This guarantees every request in this diagnostic is actually carried by
  // Wi-Fi; a successful test can therefore not be a silent cellular fallback.
  bool savedCellReady = cellReady;
  cellReady = false;

  lastConfigAttemptMs = 0;
  lastConfigSuccessMs = 0;
  bool configOk = syncRemotePolicy();
  if (!configOk) {
    cellReady = savedCellReady;
    Serial.println(F("WIFI DB TEST FAILED at CONFIG READ."));
    return false;
  }

  if (!wifiReady()) {
    cellReady = savedCellReady;
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi dropped after config read."));
    return false;
  }

  bool ackOk = uploadConfigAck();
  if (!ackOk) {
    cellReady = savedCellReady;
    Serial.println(F("WIFI DB TEST FAILED at CONFIG ACK."));
    return false;
  }

  if (!policy.wifiEnabled) {
    Serial.println(F("WIFI DB TEST: downloaded policy disables Wi-Fi; transport switch is deferred until the test heartbeat completes."));
  }

  heartbeatUploadRequested = true;
  bool heartbeatOk = uploadHeartbeatViaTransport("wifi");
  cellReady = savedCellReady;

  if (heartbeatOk && transportTransitionPending
      && strcmp(transportTransitionSource, "wifi") == 0) {
    transportTransitionPending = false;
    transportTransitionSource[0] = '\0';
    lastTransportTransitionAttemptMs = 0;
    Serial.println(F("WIFI DB TEST committed the pending transport change after the Wi-Fi heartbeat."));
  }

  if (!heartbeatOk) {
    Serial.println(F("WIFI DB TEST FAILED at HEARTBEAT WRITE."));
    return false;
  }

  Serial.println(F("WIFI DB TEST PASS: config read, config ACK and heartbeat all completed over Wi-Fi only."));
  Serial.print(F("Applied DB intervals min: heartbeat="));
  Serial.print(policy.heartbeatIntervalMinutes);
  Serial.print(F(" counters="));
  Serial.print(policy.counterIntervalMinutes);
  Serial.print(F(" config="));
  Serial.println(policy.configRefreshMinutes);
  return true;
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

  // Counter values are retained locally. Upload timing is controlled by the
  // effective database telemetry policy in serviceCounterSchedule().
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
// Normalized machine-record UART
// -----------------------------------------------------------------------------
// NORMALIZED_UART reads a machine-specific adapter on the DEX/SP3232 pins.
// Native MDB no longer uses this JSON/CSV bridge path; it is decoded directly
// from GPIO4/GPIO5 by the RMT-based MDB parser below.
//
// JSON examples:
//   {"type":"vend","selection":"A1","price_cents":1500,"result":"OK"}
//   {"type":"counter","selection":"A1","product":"Coffee","price_cents":1500,
//    "sold_total":123,"failed_total":2,"revenue_cents_total":184500}
//   {"type":"fault","code":"MDB_NO_RESPONSE","severity":"warning","detail":"..."}
//   {"type":"recovery","code":"MDB_NO_RESPONSE","detail":"..."}
//   {"type":"machine","machine_serial":"VM-12345"}
//
// CSV examples:
//   VEND,A1,1500,CARD,OK,123
//   COUNTER,A1,Coffee,1500,123,2,184500
//   FAULT,MDB_NO_RESPONSE,warning,No VMC reply
//   RECOVERY,MDB_NO_RESPONSE,Communication restored
//   MACHINE,VM-12345

String normalizedLine;
bool normalizedLineOverflow = false;

const char* normalizedRecordSource() {
  return "normalized_uart";
}

String csvFieldAt(const String& line, uint8_t wantedIndex) {
  uint8_t fieldIndex = 0;
  int start = 0;
  for (int i = 0; i <= line.length(); ++i) {
    if (i == line.length() || line.charAt(i) == ',') {
      if (fieldIndex == wantedIndex) return trimCopy(line.substring(start, i));
      fieldIndex++;
      start = i + 1;
    }
  }
  return "";
}

uint8_t csvFieldCount(const String& line) {
  if (!line.length()) return 0;
  uint8_t count = 1;
  for (int i = 0; i < line.length(); ++i) {
    if (line.charAt(i) == ',' && count < 255) count++;
  }
  return count;
}

void acceptMachineSerial(const String& serial) {
  String value = trimCopy(serial);
  if (!value.length() || value == reportedMachineSerial) return;
  reportedMachineSerial = value;
  saveCoreSettings();
  heartbeatUploadRequested = true;
  Serial.print(F("Machine serial received from interface: "));
  Serial.println(reportedMachineSerial);
}

bool parseNormalizedLine(String line) {
  line.trim();
  if (!line.length()) return false;

  if (line.startsWith("{")) {
    JsonDocument doc;
    if (deserializeJson(doc, line)) return false;
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
      return true;
    } else if (type.equalsIgnoreCase("counter") || type.equalsIgnoreCase("counter_snapshot")) {
      String selection = doc["selection"] | "UNKNOWN";
      String product = doc["product"] | "";
      uint32_t price = doc["price_cents"] | 0;
      uint64_t sold = doc["sold_total"].isNull() ? 0 : doc["sold_total"].as<uint64_t>();
      uint64_t failed = doc["failed_total"].isNull() ? 0 : doc["failed_total"].as<uint64_t>();
      uint64_t revenue = doc["revenue_cents_total"].isNull() ? 0 : doc["revenue_cents_total"].as<uint64_t>();
      setCompleteCounter(selection, product, price, sold, failed, revenue);
      return true;
    } else if (type.equalsIgnoreCase("fault")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", true, doc["severity"] | "fault",
                         normalizedRecordSource(), doc["detail"] | "", line);
      return true;
    } else if (type.equalsIgnoreCase("recovery")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", false, "info",
                         normalizedRecordSource(), doc["detail"] | "", line);
      return true;
    } else if (type.equalsIgnoreCase("machine")) {
      acceptMachineSerial(doc["machine_serial"] | "");
      return true;
    }
    return false;
  }

  uint8_t fields = csvFieldCount(line);
  String recordType = csvFieldAt(line, 0);
  recordType.toUpperCase();

  if (recordType == "VEND" && fields >= 5) {
    String selection = csvFieldAt(line, 1);
    uint32_t price = static_cast<uint32_t>(csvFieldAt(line, 2).toInt());
    String result = csvFieldAt(line, 4);
    if (fields >= 6 && csvFieldAt(line, 5).length()) {
      uint64_t count = toUInt64(csvFieldAt(line, 5));
      setCumulativeCounter(selection, count, count * price, price, "");
    } else {
      incrementLocalVend(selection, price, result.equalsIgnoreCase("OK"));
    }
    return true;
  }

  if ((recordType == "COUNTER" || recordType == "COUNTER_SNAPSHOT") && fields >= 7) {
    setCompleteCounter(csvFieldAt(line, 1), csvFieldAt(line, 2),
                       static_cast<uint32_t>(csvFieldAt(line, 3).toInt()),
                       toUInt64(csvFieldAt(line, 4)),
                       toUInt64(csvFieldAt(line, 5)),
                       toUInt64(csvFieldAt(line, 6)));
    return true;
  }

  if (recordType == "FAULT" && fields >= 3) {
    setLocalFaultState(csvFieldAt(line, 1), true, csvFieldAt(line, 2),
                       normalizedRecordSource(), csvFieldAt(line, 3), line);
    return true;
  }

  if (recordType == "RECOVERY" && fields >= 2) {
    setLocalFaultState(csvFieldAt(line, 1), false, "info",
                       normalizedRecordSource(), csvFieldAt(line, 2), line);
    return true;
  }

  if (recordType == "MACHINE" && fields >= 2) {
    acceptMachineSerial(csvFieldAt(line, 1));
    return true;
  }

  return false;
}

void processNormalizedSerial() {
  while (DexSerial.available()) {
    char c = static_cast<char>(DexSerial.read());
    lastMachineByteMs = millis();
    if (c == '\r' || c == '\n') {
      if (normalizedLine.length()) {
        if (!normalizedLineOverflow && parseNormalizedLine(normalizedLine)) {
          acceptedMachineRecords++;
        } else {
          rejectedMachineRecords++;
          Serial.println(F("Machine UART record rejected; check bridge format and baud."));
        }
        normalizedLine = "";
        normalizedLineOverflow = false;
      }
    } else if (normalizedLine.length() < 512) {
      normalizedLine += c;
    } else {
      normalizedLineOverflow = true;
    }
  }
}

// -----------------------------------------------------------------------------
// Native passive MDB/ICP 9-bit capture / decoder
// -----------------------------------------------------------------------------
// MDB/ICP: 9600 NRZ, 1 start, 8 data (LSB first), 1 mode bit, 1 stop.
// Production mode is deliberately passive: BOTH MDB GPIOs are RMT RX inputs.
// The encoder below exists so framing is complete and unit-testable. This
// passive production build has no active bus-driving path by design.

static const size_t MDB_RMT_SYMBOL_CAPACITY =
    RMT_MEM_NUM_BLOCKS_2 * RMT_SYMBOLS_PER_CHANNEL_BLOCK;
static const size_t MDB_MAX_DECODED_BITS = 768;
static const size_t MDB_MAX_WORDS_PER_CAPTURE = 64;

static QueueHandle_t mdbEventQueue = nullptr;
static TaskHandle_t mdbCaptureTaskHandle = nullptr;
static volatile bool mdbCaptureTaskRun = false;
static volatile bool mdbMasterCaptureFault = false;
static volatile bool mdbSlaveCaptureFault = false;
static volatile uint32_t mdbEventQueueOverflows = 0;

static rmt_data_t mdbMasterRmt[MDB_RMT_SYMBOL_CAPACITY];
static rmt_data_t mdbSlaveRmt[MDB_RMT_SYMBOL_CAPACITY];
static size_t mdbMasterRmtCount = MDB_RMT_SYMBOL_CAPACITY;
static size_t mdbSlaveRmtCount = MDB_RMT_SYMBOL_CAPACITY;
static bool mdbMasterReadArmed = false;
static bool mdbSlaveReadArmed = false;
static bool mdbRmtReady = false;

// -1 unknown, 0 normal, 1 inverted. Polarity is learned only from valid MDB blocks.
static int8_t mdbMasterInvert = -1;
static int8_t mdbSlaveInvert = -1;

static uint32_t mdbValidMasterBlocks = 0;
static uint32_t mdbValidSlaveBlocks = 0;
static uint32_t mdbInvalidMasterBlocks = 0;
static uint32_t mdbInvalidSlaveBlocks = 0;
static uint32_t mdbFramingErrors = 0;
static uint32_t mdbChecksumErrors = 0;
static uint32_t mdbDecodedWords = 0;
static uint32_t lastMdbValidMasterMs = 0;
static uint32_t lastMdbValidSlaveMs = 0;
static uint32_t mdbStartedMs = 0;

static MdbCashlessState mdbCashless[2];
static MdbLastMasterContext mdbLastMaster;
static MdbVendDedup mdbLastVend;

uint8_t mdbChecksum(const uint8_t* bytes, size_t count) {
  uint8_t sum = 0;
  for (size_t i = 0; i < count; ++i) sum = static_cast<uint8_t>(sum + bytes[i]);
  return sum;
}

// Complete 9-bit encoder for one MDB word. Bit positions:
// [0]=start, [1..8]=data LSB-first, [9]=mode, [10]=stop.
void mdbEncode9BitWord(uint8_t value, bool mode, bool outBits[11]) {
  outBits[0] = false;
  for (uint8_t bit = 0; bit < 8; ++bit) outBits[1 + bit] = ((value >> bit) & 0x01) != 0;
  outBits[9] = mode;
  outBits[10] = true;
}

// Build a complete Master->Peripheral MDB block, including the 8-bit checksum.
// The first byte is an ADDRESS byte (mode=1). Data and checksum use mode=0.
// This is not transmitted by production passive mode.
size_t mdbEncodeMasterBlock(uint8_t address,
                           const uint8_t* data,
                           size_t dataLength,
                           MdbWord* out,
                           size_t outCapacity) {
  if (!out || outCapacity < dataLength + 2 || dataLength > 34) return 0;

  out[0] = { address, true, true };
  uint8_t sum = address;
  for (size_t i = 0; i < dataLength; ++i) {
    out[i + 1] = { data[i], false, true };
    sum = static_cast<uint8_t>(sum + data[i]);
  }
  out[dataLength + 1] = { sum, false, true };
  return dataLength + 2;
}

uint32_t mdbScaledToCents(uint32_t scaled, uint8_t scaleFactor, uint8_t decimals) {
  uint64_t value = static_cast<uint64_t>(scaled) * (scaleFactor ? scaleFactor : 1);
  if (decimals < 2) {
    for (uint8_t i = decimals; i < 2; ++i) value *= 10ULL;
  } else if (decimals > 2) {
    for (uint8_t i = 2; i < decimals; ++i) value = (value + 5ULL) / 10ULL;
  }
  return value > 0xFFFFFFFFULL ? 0xFFFFFFFFUL : static_cast<uint32_t>(value);
}

String mdbSelectionText(uint16_t selection) {
  if (selection == 0xFFFF) return "MDB-UNKNOWN";
  char buf[20] = {0};
  snprintf(buf, sizeof(buf), "MDB-%u", static_cast<unsigned>(selection));
  return String(buf);
}

int mdbCashlessIndexForAddress(uint8_t address) {
  uint8_t base = address & 0xF8;
  if (base == 0x10) return 0;
  if (base == 0x60) return 1;
  return -1;
}

bool mdbIsCashlessAddress(uint8_t address) {
  return mdbCashlessIndexForAddress(address) >= 0;
}

bool mdbQueueTelemetryEvent(const MdbTelemetryEvent& event) {
  if (!mdbEventQueue) {
    mdbEventQueueOverflows++;
    return false;
  }
  if (xQueueSend(mdbEventQueue, &event, 0) != pdTRUE) {
    mdbEventQueueOverflows++;
    return false;
  }
  return true;
}

void mdbClearCashlessError(int idx, const char* detail) {
  (void)detail;
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (!s.errorActive) return;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_CASHLESS_ERROR_CLEAR;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.code = s.activeErrorCode;
  mdbQueueTelemetryEvent(event);

  s.errorActive = false;
  s.activeErrorCode = 0;
}

void mdbSetCashlessError(int idx, uint8_t errorCode) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];

  if (s.errorActive && s.activeErrorCode == errorCode) return;

  if (s.errorActive && s.activeErrorCode != errorCode) {
    mdbClearCashlessError(idx, "MDB cashless error code changed");
  }

  s.activeErrorCode = errorCode;
  s.errorActive = true;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_CASHLESS_ERROR_SET;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.code = errorCode;
  mdbQueueTelemetryEvent(event);
}

void mdbSetOutOfSequence(int idx, uint8_t status) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (s.outOfSequenceActive) return;
  s.outOfSequenceActive = true;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_OUT_OF_SEQUENCE_SET;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.status = status;
  mdbQueueTelemetryEvent(event);
}

void mdbClearOutOfSequence(int idx) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (!s.outOfSequenceActive) return;
  s.outOfSequenceActive = false;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_OUT_OF_SEQUENCE_CLEAR;
  event.readerIndex = static_cast<uint8_t>(idx);
  mdbQueueTelemetryEvent(event);
}

bool mdbVendIsDuplicate(uint16_t selection, uint32_t priceCents, bool success) {
  uint32_t now = millis();
  bool duplicate =
      mdbLastVend.selection == selection &&
      mdbLastVend.priceCents == priceCents &&
      mdbLastVend.success == success &&
      mdbLastVend.atMs != 0 &&
      now - mdbLastVend.atMs <= MDB_DUPLICATE_VEND_WINDOW_MS;

  if (!duplicate) {
    mdbLastVend.selection = selection;
    mdbLastVend.priceCents = priceCents;
    mdbLastVend.success = success;
    mdbLastVend.atMs = now;
  }
  return duplicate;
}

uint8_t mdbVendReasonFromText(const char* reason) {
  if (!reason) return 0;
  if (strcmp(reason, "cashless_vend_success") == 0) return MDB_VEND_CASHLESS_SUCCESS;
  if (strcmp(reason, "cashless_vend_failure") == 0) return MDB_VEND_CASHLESS_FAILURE;
  if (strcmp(reason, "cash_sale") == 0) return MDB_VEND_CASH_SALE;
  if (strcmp(reason, "cashless_reset_after_approval") == 0) return MDB_VEND_RESET_AFTER_APPROVAL;
  if (strcmp(reason, "cashless_basket_vend_success") == 0) return MDB_VEND_BASKET_SUCCESS;
  if (strcmp(reason, "cashless_basket_vend_failure") == 0) return MDB_VEND_BASKET_FAILURE;
  return 0;
}

void mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {
  if (mdbVendIsDuplicate(selection, priceCents, success)) return;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_VEND;
  event.selection = selection;
  event.priceCents = priceCents;
  event.success = success;
  event.reason = mdbVendReasonFromText(reason);
  mdbQueueTelemetryEvent(event);
}

const char* mdbVendReasonName(uint8_t reason) {
  switch (reason) {
    case MDB_VEND_CASHLESS_SUCCESS: return "cashless_vend_success";
    case MDB_VEND_CASHLESS_FAILURE: return "cashless_vend_failure";
    case MDB_VEND_CASH_SALE: return "cash_sale";
    case MDB_VEND_RESET_AFTER_APPROVAL: return "cashless_reset_after_approval";
    case MDB_VEND_BASKET_SUCCESS: return "cashless_basket_vend_success";
    case MDB_VEND_BASKET_FAILURE: return "cashless_basket_vend_failure";
    default: return "mdb";
  }
}

void serviceMdbTelemetryEvents(uint8_t maxEvents = 24) {
  if (!mdbEventQueue) return;

  MdbTelemetryEvent event = {};
  uint8_t handled = 0;
  while (handled < maxEvents && xQueueReceive(mdbEventQueue, &event, 0) == pdTRUE) {
    handled++;

    if (event.type == MDB_EVENT_VEND) {
      String selectionText = mdbSelectionText(event.selection);
      incrementLocalVend(selectionText, event.priceCents, event.success);
      Serial.print(F("MDB vend "));
      Serial.print(event.success ? F("success") : F("failure"));
      Serial.print(F(" selection="));
      Serial.print(selectionText);
      Serial.print(F(" price_cents="));
      Serial.print(event.priceCents);
      Serial.print(F(" source="));
      Serial.println(mdbVendReasonName(event.reason));
      continue;
    }

    if (event.readerIndex > 1) continue;
    int reader = event.readerIndex + 1;
    char code[48] = {0};

    if (event.type == MDB_EVENT_CASHLESS_ERROR_SET) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_ERROR_%02X", reader, event.code);
      String detail = "Cashless reader ";
      detail += String(reader);
      detail += " reported MDB malfunction/error 0x";
      if (event.code < 16) detail += "0";
      detail += String(event.code, HEX);
      detail.toUpperCase();
      setLocalFaultState(code, true, "fault", "mdb", detail, "");
    } else if (event.type == MDB_EVENT_CASHLESS_ERROR_CLEAR) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_ERROR_%02X", reader, event.code);
      setLocalFaultState(code, false, "info", "mdb", "MDB cashless error cleared", "");
    } else if (event.type == MDB_EVENT_OUT_OF_SEQUENCE_SET) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_OUT_OF_SEQUENCE", reader);
      String detail = "MDB cashless command out of sequence";
      if (event.status) {
        detail += " status=";
        detail += String(event.status);
      }
      setLocalFaultState(code, true, "warning", "mdb", detail, "");
    } else if (event.type == MDB_EVENT_OUT_OF_SEQUENCE_CLEAR) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_OUT_OF_SEQUENCE", reader);
      setLocalFaultState(code, false, "info", "mdb", "MDB cashless sequence restored", "");
    }
  }
}

uint32_t mdbReadBigEndian(const MdbWord* words, size_t offset, size_t bytes) {
  uint32_t value = 0;
  for (size_t i = 0; i < bytes; ++i) {
    value = (value << 8) | words[offset + i].value;
  }
  return value;
}

// Convert RMT pulse durations to an MDB serial bit stream, then reconstruct
// 11-bit MDB words. RMT starts on the first edge, so searching for start=0
// and validating stop=1 is safer than assuming symbol alignment.
size_t mdbDecodeRmtWords(const rmt_data_t* symbols,
                         size_t symbolCount,
                         bool invert,
                         MdbWord* outWords,
                         size_t outCapacity,
                         uint32_t& framingErrors) {
  bool bits[MDB_MAX_DECODED_BITS];
  size_t bitCount = 0;

  auto appendPulse = [&](uint8_t rawLevel, uint16_t duration) {
    if (duration == 0 || bitCount >= MDB_MAX_DECODED_BITS) return;
    bool logicalLevel = (rawLevel != 0) ^ invert;

    // Round to the nearest 9600-baud bit period. Reject pulses that are too
    // short to represent a stable MDB bit after the hardware noise filter.
    if (duration < MDB_BIT_US / 2) return;
    uint32_t repeat = (static_cast<uint32_t>(duration) + MDB_BIT_US / 2) / MDB_BIT_US;
    if (repeat == 0) repeat = 1;
    // Long idle or bus-reset levels need not consume the whole scratch buffer.
    if (repeat > 32) repeat = 32;
    while (repeat-- && bitCount < MDB_MAX_DECODED_BITS) bits[bitCount++] = logicalLevel;
  };

  for (size_t i = 0; i < symbolCount && bitCount < MDB_MAX_DECODED_BITS; ++i) {
    appendPulse(symbols[i].level0, symbols[i].duration0);
    appendPulse(symbols[i].level1, symbols[i].duration1);
  }

  size_t wordCount = 0;
  for (size_t i = 0; i + 10 < bitCount && wordCount < outCapacity;) {
    // UART start bit must be low. Prefer a low preceded by idle/high.
    if (bits[i] || (i > 0 && !bits[i - 1])) {
      ++i;
      continue;
    }

    if (!bits[i + 10]) {
      ++framingErrors;
      ++i;
      continue;
    }

    uint8_t value = 0;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if (bits[i + 1 + bit]) value |= static_cast<uint8_t>(1U << bit);
    }
    outWords[wordCount++] = { value, bits[i + 9], true };
    i += 11;
  }
  return wordCount;
}

bool mdbMasterSegmentChecksumValid(const MdbWord* words,
                                   size_t start,
                                   size_t endInclusive,
                                   size_t& checksumIndex) {
  if (!words || endInclusive <= start) return false;

  // Normal case: final word in this address segment is the checksum.
  auto checkCandidate = [&](size_t candidate) {
    if (candidate <= start || words[candidate].mode) return false;
    uint8_t sum = 0;
    for (size_t j = start; j < candidate; ++j) sum = static_cast<uint8_t>(sum + words[j].value);
    return sum == words[candidate].value;
  };

  if (checkCandidate(endInclusive)) {
    checksumIndex = endInclusive;
    return true;
  }

  // If a Master ACK/NAK/RET was captured immediately after the command,
  // allow one trailing non-address control byte after a valid checksum.
  if (endInclusive > start + 1 && checkCandidate(endInclusive - 1)) {
    uint8_t trailing = words[endInclusive].value;
    if (!words[endInclusive].mode && (trailing == 0x00 || trailing == 0xAA || trailing == 0xFF)) {
      checksumIndex = endInclusive - 1;
      return true;
    }
  }
  return false;
}

int mdbScoreMasterWords(const MdbWord* words, size_t count) {
  int score = 0;
  for (size_t i = 0; i < count;) {
    if (!words[i].mode) { ++i; continue; }

    size_t segmentEnd = i + 1;
    while (segmentEnd + 1 < count &&
           !words[segmentEnd + 1].mode &&
           segmentEnd + 1 <= i + 35) {
      ++segmentEnd;
    }

    size_t checksumIndex = 0;
    if (mdbMasterSegmentChecksumValid(words, i, segmentEnd, checksumIndex)) score += 10;
    else score += 1;

    i = segmentEnd + 1;
  }
  return score;
}

int mdbScoreSlaveWords(const MdbWord* words, size_t count) {
  int score = 0;
  uint8_t sum = 0;
  size_t dataCount = 0;
  for (size_t i = 0; i < count; ++i) {
    if (!words[i].mode) {
      sum = static_cast<uint8_t>(sum + words[i].value);
      dataCount++;
      continue;
    }

    if (dataCount == 0) {
      // Single mode-set ACK/NAK/RET style response.
      score += 5;
    } else if (words[i].value == sum) {
      score += 10;
    }
    sum = 0;
    dataCount = 0;
  }
  return score;
}

size_t mdbDecodeWithPolarity(const rmt_data_t* symbols,
                             size_t symbolCount,
                             bool masterDirection,
                             int8_t& learnedInvert,
                             MdbWord* outWords,
                             size_t outCapacity) {
  MdbWord normal[MDB_MAX_WORDS_PER_CAPTURE];
  MdbWord inverted[MDB_MAX_WORDS_PER_CAPTURE];
  uint32_t normalErrors = 0;
  uint32_t invertedErrors = 0;

  if (!DALLMAYR_MDB_AUTO_POLARITY && learnedInvert < 0) learnedInvert = 0;

  if (learnedInvert >= 0) {
    size_t n = mdbDecodeRmtWords(symbols, symbolCount, learnedInvert != 0,
                                 outWords, outCapacity, normalErrors);
    mdbFramingErrors += normalErrors;
    return n;
  }

  size_t normalCount = mdbDecodeRmtWords(symbols, symbolCount, false,
                                         normal, MDB_MAX_WORDS_PER_CAPTURE, normalErrors);
  size_t invertedCount = mdbDecodeRmtWords(symbols, symbolCount, true,
                                           inverted, MDB_MAX_WORDS_PER_CAPTURE, invertedErrors);
  int normalScore = masterDirection ? mdbScoreMasterWords(normal, normalCount)
                                    : mdbScoreSlaveWords(normal, normalCount);
  int invertedScore = masterDirection ? mdbScoreMasterWords(inverted, invertedCount)
                                      : mdbScoreSlaveWords(inverted, invertedCount);

  bool chooseInverted = invertedScore > normalScore;
  const MdbWord* chosen = chooseInverted ? inverted : normal;
  size_t chosenCount = chooseInverted ? invertedCount : normalCount;
  mdbFramingErrors += chooseInverted ? invertedErrors : normalErrors;

  // Only lock polarity after meaningful valid-block evidence.
  if (max(normalScore, invertedScore) >= 10) {
    learnedInvert = chooseInverted ? 1 : 0;
  }

  size_t copyCount = min(chosenCount, outCapacity);
  for (size_t i = 0; i < copyCount; ++i) outWords[i] = chosen[i];
  return copyCount;
}

void mdbHandleMasterBlock(const MdbWord* block, size_t count) {
  if (count < 2) return;
  uint8_t address = block[0].value;
  uint8_t command = address & 0x07;
  uint8_t subcommand = count >= 3 ? block[1].value : 0xFF;

  mdbLastMaster.address = address;
  mdbLastMaster.command = command;
  mdbLastMaster.subcommand = subcommand;
  mdbLastMaster.atMs = millis();

  int cashlessIdx = mdbCashlessIndexForAddress(address);
  if (cashlessIdx < 0) return;

  MdbCashlessState& cashless = mdbCashless[cashlessIdx];

  // RESET = 10h/60h. MDB specifies that a reset occurring after VEND
  // APPROVED but before VEND SUCCESS is interpreted as a successful vend.
  // Preserve that accounting before clearing the reader state.
  if (command == 0) {
    if (cashless.vendPending && cashless.vendApproved) {
      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      mdbRecordVend(cashless.selection, cents, true, "cashless_reset_after_approval");
    }
    cashless.vendPending = false;
    cashless.vendApproved = false;
    cashless.selection = 0xFFFF;
    cashless.requestedScaledPrice = 0;
    cashless.approvedScaledPrice = 0;
    cashless.enabledFeatureBits = 0;
    cashless.expandedCurrency = false;
    mdbClearOutOfSequence(cashlessIdx);
    return;
  }

  // EXPANSION = 17h/67h, subcommand 04h = ENABLE OPTIONS.
  // Y2..Y5 are the 32-bit optional-feature bitmap in network byte order.
  // Bit 1 enables 32-bit monetary fields and bit 2 enables multi-currency;
  // either feature causes the expanded monetary representation to be used.
  if (command == 7 && subcommand == 0x04 && count >= 7) {
    cashless.enabledFeatureBits = mdbReadBigEndian(block, 2, 4);
    cashless.expandedCurrency =
        (cashless.enabledFeatureBits & ((1UL << 1) | (1UL << 2))) != 0;
    return;
  }

  // VEND = 13h/63h
  if (command != 3 || count < 3) return;

  switch (subcommand) {
    case 0x00: { // VEND REQUEST
      // Standard: addr,00,priceHi,priceLo,itemHi,itemLo,chk
      // Expanded currency: addr,00,price[4],itemHi,itemLo,chk
      size_t payloadWithoutChecksum = count - 1;
      size_t priceBytes = cashless.expandedCurrency ? 4 : 2;
      size_t itemOffset = 2 + priceBytes;
      if (itemOffset + 1 >= payloadWithoutChecksum) break;

      cashless.requestedScaledPrice = mdbReadBigEndian(block, 2, priceBytes);
      cashless.selection = static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));
      cashless.approvedScaledPrice = 0;
      cashless.vendPending = true;
      cashless.vendApproved = false;
      cashless.vendStartedMs = millis();
      break;
    }

    case 0x01: // VEND CANCEL
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x02: { // VEND SUCCESS
      size_t payloadWithoutChecksum = count - 1;
      bool basketEnabled = (cashless.enabledFeatureBits & (1UL << 7)) != 0;
      bool enhancedItem = (cashless.enabledFeatureBits & (1UL << 10)) != 0;

      uint16_t selection = cashless.selection;
      if (payloadWithoutChecksum >= 4) {
        uint16_t selected = static_cast<uint16_t>(mdbReadBigEndian(block, 2, 2));
        if (selected != 0xFFFF) selection = selected;
      }

      // Enhanced Item Number Info adds a distinct dispensed item number at
      // Y4-Y5. Prefer the actual dispensed location when the VMC supplies it.
      if (enhancedItem && payloadWithoutChecksum >= 6) {
        uint16_t dispensed = static_cast<uint16_t>(mdbReadBigEndian(block, 4, 2));
        if (dispensed != 0xFFFF) selection = dispensed;
      }

      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t remainingItems = 0;

      // With Basket / Partial Refund enabled, VEND SUCCESS carries the
      // monetary amount for this individual dispensed item. This avoids
      // attributing the entire basket approval amount to every item.
      if (basketEnabled) {
        size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
        size_t amountOffset = enhancedItem ? 18 : 4;
        size_t itemCountOffset = amountOffset + amountBytes;
        if (itemCountOffset < payloadWithoutChecksum) {
          scaled = mdbReadBigEndian(block, amountOffset, amountBytes);
          remainingItems = block[itemCountOffset].value;
        }
      }

      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      if (cashless.vendPending || selection != 0xFFFF) {
        mdbRecordVend(selection, cents, true,
                      basketEnabled ? "cashless_basket_vend_success" : "cashless_vend_success");
      }

      // Basket mode can emit multiple SUCCESS/FAILURE commands after one
      // VEND REQUEST. Keep the transaction context only while items remain.
      cashless.vendPending = basketEnabled && remainingItems > 0;
      cashless.vendApproved = cashless.vendPending;
      if (!cashless.vendPending) {
        cashless.selection = 0xFFFF;
        cashless.requestedScaledPrice = 0;
        cashless.approvedScaledPrice = 0;
      }
      break;
    }

    case 0x03: { // VEND FAILURE
      size_t payloadWithoutChecksum = count - 1;
      bool basketEnabled = (cashless.enabledFeatureBits & (1UL << 7)) != 0;
      uint16_t selection = cashless.selection;
      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t remainingItems = 0;

      // Level-3 Basket / Partial Refund failure contains the failed item,
      // its amount and the number of products still awaiting disposition.
      if (basketEnabled && payloadWithoutChecksum >= 4) {
        uint16_t reported = static_cast<uint16_t>(mdbReadBigEndian(block, 2, 2));
        if (reported != 0xFFFF) selection = reported;
        size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
        size_t amountOffset = 4;
        size_t itemCountOffset = amountOffset + amountBytes;
        if (itemCountOffset < payloadWithoutChecksum) {
          scaled = mdbReadBigEndian(block, amountOffset, amountBytes);
          remainingItems = block[itemCountOffset].value;
        }
      }

      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      if (cashless.vendPending || (basketEnabled && selection != 0xFFFF)) {
        mdbRecordVend(selection, cents, false,
                      basketEnabled ? "cashless_basket_vend_failure" : "cashless_vend_failure");
      }

      cashless.vendPending = basketEnabled && remainingItems > 0;
      cashless.vendApproved = cashless.vendPending;
      if (!cashless.vendPending) {
        cashless.selection = 0xFFFF;
        cashless.requestedScaledPrice = 0;
        cashless.approvedScaledPrice = 0;
      }
      break;
    }

    case 0x04: // SESSION COMPLETE
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x05: { // CASH SALE (audit notification)
      // This may be sent to more than one reader. Global dedup suppresses the
      // common duplicate within the same transaction window.
      size_t payloadWithoutChecksum = count - 1;
      size_t priceBytes = cashless.expandedCurrency ? 4 : 2;
      size_t itemOffset = 2 + priceBytes;
      if (itemOffset + 1 >= payloadWithoutChecksum) break;
      uint32_t scaled = mdbReadBigEndian(block, 2, priceBytes);
      uint16_t selection = static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));
      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      mdbRecordVend(selection, cents, true, "cash_sale");
      break;
    }

    default:
      break;
  }
}

size_t mdbCashlessMessageLength(const MdbCashlessState& cashless,
                                const MdbWord* data,
                                size_t remaining) {
  if (!data || remaining == 0) return 0;
  switch (data[0].value) {
    case 0x00: return 1; // JUST RESET
    case 0x01: return remaining >= 8 ? 8 : remaining; // READER CONFIG
    case 0x02: return remaining; // DISPLAY REQUEST is VMC-display-size dependent
    case 0x03: { // BEGIN SESSION
      size_t n = cashless.expandedCurrency ? 17 : (cashless.featureLevel >= 2 ? 10 : 3);
      return min(n, remaining);
    }
    case 0x04: return 1; // SESSION CANCEL REQUEST
    case 0x05: { // VEND APPROVED
      size_t n = cashless.expandedCurrency ? 5 : 3;
      return min(n, remaining);
    }
    case 0x06: return 1; // VEND DENIED
    case 0x07: return 1; // END SESSION
    case 0x08: return 1; // CANCELLED
    case 0x09: { // PERIPHERAL ID
      size_t n = cashless.featureLevel >= 3 ? 34 : 30;
      return min(n, remaining);
    }
    case 0x0A: return min(static_cast<size_t>(2), remaining); // MALFUNCTION
    case 0x0B: { // COMMAND OUT OF SEQUENCE
      size_t n = cashless.featureLevel >= 2 ? 2 : 1;
      return min(n, remaining);
    }
    case 0x0D: return 1; // REVALUE APPROVED
    case 0x0E: return 1; // REVALUE DENIED
    case 0x0F: { // REVALUE LIMIT AMOUNT
      size_t n = cashless.expandedCurrency ? 5 : 3;
      return min(n, remaining);
    }
    case 0x11: return 1; // TIME/DATE REQUEST
    case 0x12: return min(static_cast<size_t>(2), remaining); // DATA ENTRY REQUEST
    case 0x13: return 1; // DATA ENTRY CANCEL
    case 0x14: { // SELECTION REQUEST
      size_t n = cashless.expandedCurrency ? 23 : 16;
      return min(n, remaining);
    }
    default:
      // Unknown/variable response: consume the remainder so payload bytes are
      // never guessed as independent response codes.
      return remaining;
  }
}

void mdbHandleSlaveMessage(int cashlessIdx, const MdbWord* data, size_t dataCount) {
  if (cashlessIdx < 0 || cashlessIdx > 1 || dataCount == 0) return;
  MdbCashlessState& cashless = mdbCashless[cashlessIdx];
  uint8_t response = data[0].value;

  switch (response) {
    case 0x00: // JUST RESET
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      cashless.enabledFeatureBits = 0;
      cashless.expandedCurrency = false;
      break;

    case 0x01: // READER CONFIGURATION DATA
      // Z1=01, Z2=feature level, Z3/Z4=country, Z5=scale, Z6=decimal...
      if (dataCount >= 8) {
        cashless.featureLevel = data[1].value ? data[1].value : 1;
        uint8_t scale = data[4].value;
        uint8_t decimals = data[5].value;
        if (scale != 0 && decimals <= 4) {
          cashless.scaleFactor = scale;
          cashless.decimalPlaces = decimals;
          cashless.scaleKnown = true;

        }
      }
      break;

    case 0x05: { // VEND APPROVED
      // Standard amount is 16-bit. Level-3 expanded currency uses 32-bit,
      // as negotiated by the VMC's ENABLE OPTIONS command.
      size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
      if (dataCount >= amountBytes + 1) {
        cashless.approvedScaledPrice = mdbReadBigEndian(data, 1, amountBytes);
      }
      cashless.vendApproved = true;
      break;
    }

    case 0x06: // VEND DENIED
      cashless.vendApproved = false;
      cashless.vendPending = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x07: // END SESSION
    case 0x08: // CANCELLED
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x09: // PERIPHERAL ID
      if (cashless.featureLevel >= 3 && dataCount >= 34) {
        cashless.supportedFeatureBits = mdbReadBigEndian(data, 30, 4);

      }
      break;

    case 0x0A: // MALFUNCTION / ERROR
      if (dataCount >= 2) mdbSetCashlessError(cashlessIdx, data[1].value);
      break;

    case 0x0B: // COMMAND OUT OF SEQUENCE
      mdbSetOutOfSequence(cashlessIdx, dataCount >= 2 ? data[1].value : 0);
      break;

    default:
      // Other cashless responses are valid MDB but do not change the telemetry
      // counters currently stored by DallmayrERP.
      break;
  }
}

void mdbHandleSlaveData(int cashlessIdx, const MdbWord* data, size_t dataCount) {
  if (cashlessIdx < 0 || cashlessIdx > 1 || !data || dataCount == 0) return;

  // MDB explicitly permits multiple cashless responses in one checksum block.
  // Walk all response messages whose lengths are unambiguous so a VEND DENIED
  // followed by MALFUNCTION, for example, does not hide the machine fault.
  size_t offset = 0;
  while (offset < dataCount) {
    MdbCashlessState& cashless = mdbCashless[cashlessIdx];
    size_t remaining = dataCount - offset;
    size_t messageLength = mdbCashlessMessageLength(cashless, &data[offset], remaining);
    if (messageLength == 0 || messageLength > remaining) messageLength = remaining;

    mdbHandleSlaveMessage(cashlessIdx, &data[offset], messageLength);
    offset += messageLength;
  }
}

void mdbProcessMasterWords(const MdbWord* words, size_t count) {
  size_t i = 0;
  while (i < count) {
    if (!words[i].mode) {
      // Master ACK/NAK/RET outside a command block. It is valid bus traffic,
      // but not telemetry content by itself.
      ++i;
      continue;
    }

    size_t segmentEnd = i + 1;
    while (segmentEnd + 1 < count &&
           !words[segmentEnd + 1].mode &&
           segmentEnd + 1 <= i + 35) {
      ++segmentEnd;
    }

    size_t checksumIndex = 0;
    if (!mdbMasterSegmentChecksumValid(words, i, segmentEnd, checksumIndex)) {
      mdbInvalidMasterBlocks++;
      mdbChecksumErrors++;
      rejectedMachineRecords++;
      i = segmentEnd + 1;
      continue;
    }

    mdbValidMasterBlocks++;
    lastMdbValidMasterMs = millis();
    lastMachineByteMs = lastMdbValidMasterMs;
    acceptedMachineRecords++;
    mdbHandleMasterBlock(&words[i], checksumIndex - i + 1);
    i = segmentEnd + 1;
  }
}

void mdbProcessSlaveWords(const MdbWord* words, size_t count) {
  MdbWord data[36];
  size_t dataCount = 0;
  uint8_t sum = 0;

  for (size_t i = 0; i < count; ++i) {
    if (!words[i].mode) {
      if (dataCount < 35) data[dataCount++] = words[i];
      sum = static_cast<uint8_t>(sum + words[i].value);
      continue;
    }

    // Associate a peripheral response only with a very recent checksum-valid
    // Master command. MDB peripherals respond in milliseconds; this prevents
    // stale state from misclassifying unrelated traffic after capture loss.
    bool contextFresh = mdbLastMaster.atMs != 0 &&
                        (millis() - mdbLastMaster.atMs) <= MDB_RESPONSE_CONTEXT_MAX_MS;
    int cashlessIdx = contextFresh
                    ? mdbCashlessIndexForAddress(mdbLastMaster.address)
                    : -1;

    if (dataCount == 0) {
      // Single byte with mode=1 is ACK/NAK style response.
      mdbValidSlaveBlocks++;
      lastMdbValidSlaveMs = millis();
      if (cashlessIdx >= 0 && words[i].value == 0x00 &&
          mdbLastMaster.command == 2) { // ACK to POLL
        mdbClearCashlessError(cashlessIdx, "MDB cashless reader returned to normal polling");
        mdbClearOutOfSequence(cashlessIdx);
      }
    } else if (words[i].value == sum) {
      mdbValidSlaveBlocks++;
      lastMdbValidSlaveMs = millis();
      if (cashlessIdx >= 0) mdbHandleSlaveData(cashlessIdx, data, dataCount);
    } else {
      mdbInvalidSlaveBlocks++;
      mdbChecksumErrors++;
      rejectedMachineRecords++;
    }

    dataCount = 0;
    sum = 0;
  }

  // A capture ending without a mode-set final byte is incomplete by MDB rules.
  if (dataCount) {
    mdbInvalidSlaveBlocks++;
    rejectedMachineRecords++;
  }
}

void mdbProcessCapture(const rmt_data_t* symbols,
                       size_t symbolCount,
                       bool masterDirection,
                       int8_t& learnedInvert) {
  if (!symbols || symbolCount == 0) return;
  MdbWord words[MDB_MAX_WORDS_PER_CAPTURE];
  size_t wordCount = mdbDecodeWithPolarity(symbols, symbolCount, masterDirection,
                                           learnedInvert, words, MDB_MAX_WORDS_PER_CAPTURE);
  if (!wordCount) return;
  mdbDecodedWords += wordCount;

  if (masterDirection) mdbProcessMasterWords(words, wordCount);
  else mdbProcessSlaveWords(words, wordCount);
}

bool mdbArmMasterCapture() {
  mdbMasterRmtCount = MDB_RMT_SYMBOL_CAPACITY;
  mdbMasterReadArmed = rmtReadAsync(MDB_VMC_TX_MONITOR_PIN, mdbMasterRmt, &mdbMasterRmtCount);
  return mdbMasterReadArmed;
}

bool mdbArmSlaveCapture() {
  mdbSlaveRmtCount = MDB_RMT_SYMBOL_CAPACITY;
  mdbSlaveReadArmed = rmtReadAsync(MDB_VMC_RX_MONITOR_PIN, mdbSlaveRmt, &mdbSlaveRmtCount);
  return mdbSlaveReadArmed;
}

void mdbCaptureTask(void* parameter) {
  (void)parameter;

  while (mdbCaptureTaskRun) {
    bool didWork = false;

    if (!mdbMasterReadArmed) {
      mdbMasterReadArmed = mdbArmMasterCapture();
      mdbMasterCaptureFault = !mdbMasterReadArmed;
      didWork = true;
    } else if (rmtReceiveCompleted(MDB_VMC_TX_MONITOR_PIN)) {
      mdbMasterReadArmed = false;
      size_t received = mdbMasterRmtCount;
      if (received > 0 && received <= MDB_RMT_SYMBOL_CAPACITY) {
        mdbProcessCapture(mdbMasterRmt, received, true, mdbMasterInvert);
      }
      // Re-arm immediately in the dedicated task. Network operations in the
      // Arduino loop therefore cannot create multi-second MDB blind spots.
      mdbMasterReadArmed = mdbArmMasterCapture();
      mdbMasterCaptureFault = !mdbMasterReadArmed;
      didWork = true;
    }

    if (!mdbSlaveReadArmed) {
      mdbSlaveReadArmed = mdbArmSlaveCapture();
      mdbSlaveCaptureFault = !mdbSlaveReadArmed;
      didWork = true;
    } else if (rmtReceiveCompleted(MDB_VMC_RX_MONITOR_PIN)) {
      mdbSlaveReadArmed = false;
      size_t received = mdbSlaveRmtCount;
      if (received > 0 && received <= MDB_RMT_SYMBOL_CAPACITY) {
        mdbProcessCapture(mdbSlaveRmt, received, false, mdbSlaveInvert);
      }
      mdbSlaveReadArmed = mdbArmSlaveCapture();
      mdbSlaveCaptureFault = !mdbSlaveReadArmed;
      didWork = true;
    }

    // Always block for at least one RTOS tick. RMT remains armed in hardware
    // during this delay. taskYIELD() only yields to equal/higher-priority tasks;
    // with continuous MDB traffic the former priority-4 task could starve the
    // lower-priority Arduino loop indefinitely.
    vTaskDelay(pdMS_TO_TICKS(1));
  }

  mdbCaptureTaskHandle = nullptr;
  vTaskDelete(nullptr);
}

void stopMdbCapture() {
  if (mdbCaptureTaskHandle) {
    mdbCaptureTaskRun = false;
    // The task normally exits within a few scheduler ticks. Do not deinitialize
    // RMT while the capture task is still inside an RMT call.
    uint32_t started = millis();
    while (mdbCaptureTaskHandle && millis() - started < 250UL) {
      vTaskDelay(pdMS_TO_TICKS(2));
    }
    if (mdbCaptureTaskHandle) {
      vTaskDelete(mdbCaptureTaskHandle);
      mdbCaptureTaskHandle = nullptr;
    }
  }

  if (mdbRmtReady) {
    rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
  }

  mdbRmtReady = false;
  mdbMasterReadArmed = false;
  mdbSlaveReadArmed = false;
  mdbMasterCaptureFault = false;
  mdbSlaveCaptureFault = false;

  if (mdbEventQueue) {
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
  }

  pinMode(MDB_VMC_TX_MONITOR_PIN, INPUT);
  pinMode(MDB_VMC_RX_MONITOR_PIN, INPUT);
}

bool beginMdbCapture() {
  stopMdbCapture();

  pinMode(MDB_VMC_TX_MONITOR_PIN, INPUT);
  pinMode(MDB_VMC_RX_MONITOR_PIN, INPUT);

  mdbEventQueue = xQueueCreate(96, sizeof(MdbTelemetryEvent));
  if (!mdbEventQueue) {
    Serial.println(F("FATAL: could not allocate MDB telemetry event queue."));
    return false;
  }

  bool masterOk = rmtInit(MDB_VMC_TX_MONITOR_PIN, RMT_RX_MODE,
                          RMT_MEM_NUM_BLOCKS_2, MDB_RMT_HZ);
  bool slaveOk = rmtInit(MDB_VMC_RX_MONITOR_PIN, RMT_RX_MODE,
                         RMT_MEM_NUM_BLOCKS_2, MDB_RMT_HZ);
  if (!masterOk || !slaveOk) {
    Serial.println(F("FATAL: could not allocate both MDB RMT RX channels."));
    if (masterOk) rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    if (slaveOk) rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
    return false;
  }

  bool thresholdsOk =
      rmtSetRxMinThreshold(MDB_VMC_TX_MONITOR_PIN, MDB_NOISE_FILTER_US) &&
      rmtSetRxMinThreshold(MDB_VMC_RX_MONITOR_PIN, MDB_NOISE_FILTER_US) &&
      rmtSetRxMaxThreshold(MDB_VMC_TX_MONITOR_PIN, MDB_RX_IDLE_US) &&
      rmtSetRxMaxThreshold(MDB_VMC_RX_MONITOR_PIN, MDB_RX_IDLE_US);
  if (!thresholdsOk) {
    Serial.println(F("FATAL: could not configure MDB RMT receive thresholds."));
    rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
    return false;
  }

  mdbRmtReady = true;
  mdbStartedMs = millis();
  lastMdbValidMasterMs = 0;
  lastMdbValidSlaveMs = 0;
  mdbMasterInvert = -1;
  mdbSlaveInvert = -1;
  mdbEventQueueOverflows = 0;
  mdbMasterCaptureFault = false;
  mdbSlaveCaptureFault = false;

  mdbMasterReadArmed = mdbArmMasterCapture();
  mdbSlaveReadArmed = mdbArmSlaveCapture();
  if (!mdbMasterReadArmed || !mdbSlaveReadArmed) {
    Serial.println(F("FATAL: MDB RMT channels initialized but capture could not be armed."));
    stopMdbCapture();
    return false;
  }

  mdbCaptureTaskRun = true;
#if CONFIG_FREERTOS_UNICORE
  BaseType_t taskOk = xTaskCreate(mdbCaptureTask, "mdb_capture", 8192, nullptr, 1,
                                  &mdbCaptureTaskHandle);
#else
  // RMT captures independently in hardware, so this worker does not need to
  // outrank Arduino loop(). Priority 1 plus an unconditional 1-tick sleep keeps
  // continuous MDB activity from starving cellular/config/heartbeat services.
  BaseType_t taskOk = xTaskCreatePinnedToCore(mdbCaptureTask, "mdb_capture", 8192,
                                             nullptr, 1, &mdbCaptureTaskHandle, 1);
#endif
  if (taskOk != pdPASS) {
    mdbCaptureTaskRun = false;
    mdbCaptureTaskHandle = nullptr;
    Serial.println(F("FATAL: could not start dedicated MDB capture task."));
    stopMdbCapture();
    return false;
  }

  Serial.print(F("Native passive MDB decoder active: GREEN/Master-TX -> GPIO"));
  Serial.print(MDB_VMC_TX_MONITOR_PIN);
  Serial.print(F(", YELLOW/Master-RX -> GPIO"));
  Serial.println(MDB_VMC_RX_MONITOR_PIN);
  Serial.println(F("MDB capture runs in a dedicated FreeRTOS task; both GPIOs remain INPUT-ONLY."));
  return true;
}

void beginMdbPins() {
  // Safe fallback state used whenever native MDB capture is stopped.
  stopMdbCapture();
}

void processMdb() {
  if (!mdbRmtReady) return;

  // Convert capture-task events into the existing telemetry/counter model on
  // the Arduino application task. This keeps Preferences/String/network work
  // out of the timing-sensitive MDB capture task.
  serviceMdbTelemetryEvents();

  if (mdbMasterCaptureFault) {
    setLocalFaultState("MDB_CAPTURE_MASTER", true, "fault", "mdb",
                       "Failed to arm MDB Master-TX RMT capture", "");
  } else {
    LocalFault* existing = findFault("MDB_CAPTURE_MASTER");
    if (existing && existing->active) {
      setLocalFaultState("MDB_CAPTURE_MASTER", false, "info", "mdb",
                         "MDB Master-TX capture restored", "");
    }
  }

  if (mdbSlaveCaptureFault) {
    setLocalFaultState("MDB_CAPTURE_SLAVE", true, "fault", "mdb",
                       "Failed to arm MDB Master-RX RMT capture", "");
  } else {
    LocalFault* existing = findFault("MDB_CAPTURE_SLAVE");
    if (existing && existing->active) {
      setLocalFaultState("MDB_CAPTURE_SLAVE", false, "info", "mdb",
                         "MDB Master-RX capture restored", "");
    }
  }

  if (mdbEventQueueOverflows != 0) {
    setLocalFaultState("MDB_EVENT_QUEUE_OVERFLOW", true, "warning", "mdb",
                       "MDB event queue overflowed; telemetry events may have been dropped", "");
  }

  // A healthy MDB VMC polls peripherals frequently. No valid Master traffic for
  // a full minute is treated as a telemetry-link fault, not as a machine fault.
  uint32_t now = millis();
  bool graceExpired = mdbStartedMs && now - mdbStartedMs >= MDB_SIGNAL_LOSS_MS;
  bool masterSilent = lastMdbValidMasterMs == 0
                    ? graceExpired
                    : now - lastMdbValidMasterMs >= MDB_SIGNAL_LOSS_MS;
  if (graceExpired && masterSilent) {
    setLocalFaultState("MDB_NO_VALID_TRAFFIC", true, "warning", "mdb",
                       "No checksum-valid MDB Master traffic detected for 60 seconds", "");
  } else if (graceExpired) {
    LocalFault* existing = findFault("MDB_NO_VALID_TRAFFIC");
    if (existing && existing->active) {
      setLocalFaultState("MDB_NO_VALID_TRAFFIC", false, "info", "mdb",
                         "Checksum-valid MDB Master traffic restored", "");
    }
  }
}

// -----------------------------------------------------------------------------
// Machine interface control
// -----------------------------------------------------------------------------

void restartMachineInterface() {
  DexSerial.end();
  normalizedLine = "";
  normalizedLineOverflow = false;
  beginMdbPins();
  delay(20);

  if (machineInterface == IFACE_DEX || machineInterface == IFACE_NORMALIZED_UART) {
    DexSerial.begin(dexBaud, SERIAL_8N1, DEX_RX_PIN, DEX_TX_PIN);
    Serial.print(F("Machine UART started on DEX pins at "));
    Serial.print(dexBaud);
    Serial.print(F(" baud, mode="));
    Serial.println(interfaceName(machineInterface));
  } else if (machineInterface == IFACE_MDB) {
    if (!beginMdbCapture()) {
      Serial.println(F("MDB native decoder failed to start; interface moved to DISABLED."));
      machineInterface = IFACE_DISABLED;
      saveCoreSettings();
    }
  } else if (machineInterface == IFACE_DISABLED) {
    Serial.println(F("Machine interface disabled; MDB pins are high impedance."));
  }
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
// Local heartbeat scheduling
// -----------------------------------------------------------------------------

void serviceHeartbeatSchedule() {
  if (!deviceEnrolled()) return;

  uint32_t intervalMinutes = policy.heartbeatIntervalMinutes == 0
    ? 1 : policy.heartbeatIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;

  // The interval comes from the effective Supabase policy and is cached in NVS.
  // Startup still sends one immediate heartbeat so the device proves it is alive.
  if (lastHeartbeatUploadSuccessMs != 0 &&
      millis() - lastHeartbeatUploadSuccessMs >= intervalMs) {
    heartbeatUploadRequested = true;
  }
}

void serviceCounterSchedule() {
  if (!deviceEnrolled() || counterCount == 0) return;

  uint32_t intervalMinutes = policy.counterIntervalMinutes == 0
    ? 1 : policy.counterIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;
  uint32_t anchor = lastCounterUploadSuccessMs != 0
    ? lastCounterUploadSuccessMs : counterScheduleStartMs;

  // The server can explicitly mark counters due on config fetch. Otherwise the
  // cached DB interval schedules the next snapshot locally without waiting for
  // another config request.
  if (policy.counterDue ||
      (anchor != 0 && millis() - anchor >= intervalMs)) {
    counterUploadRequested = true;
  }
}

// -----------------------------------------------------------------------------
// Production upload orchestration
// -----------------------------------------------------------------------------

void serviceUploads() {
  if (!anyDataTransportReady()) return;
  uint32_t now = millis();

  // Control-plane health wins over machine-derived telemetry. A bad counter or
  // fault payload must never prevent a heartbeat from proving the unit is alive.
  if (heartbeatUploadRequested &&
      (lastHeartbeatUploadAttemptMs == 0 || now - lastHeartbeatUploadAttemptMs >= HEARTBEAT_UPLOAD_RETRY_MS)) {
    lastHeartbeatUploadAttemptMs = now;
    if (!uploadHeartbeat()) {
      Serial.println(F("Heartbeat upload failed; backing off for 30 seconds."));
    }
  }

  flushPendingFaults();

  if (counterUploadRequested &&
      (lastCounterUploadAttemptMs == 0 || now - lastCounterUploadAttemptMs >= COUNTER_UPLOAD_RETRY_MS)) {
    lastCounterUploadAttemptMs = now;
    if (machineInterface == IFACE_DEX) {
      if (!dexRequestActive) requestDexAudit();
    } else if (!uploadAllCounters()) {
      Serial.println(F("Counter upload failed; backing off for 30 seconds so config/heartbeat remain serviceable."));
    }
  }
}

// -----------------------------------------------------------------------------
// Serial console
// -----------------------------------------------------------------------------

void printWiringMap() {
  Serial.println(F("--- CONFIRMED MDB PRODUCTION WIRING ---"));
  Serial.println(F("RAW MDB WIRES MUST PASS THROUGH THE ISOLATED ELECTRICAL INTERFACE."));
  Serial.print  (F("GREEN  : MDB pin 5 / Master Transmit -> isolated receiver -> ESP32 GPIO"));
  Serial.println(MDB_VMC_TX_MONITOR_PIN);
  Serial.print  (F("YELLOW : MDB pin 4 / Master Receive  -> isolated receiver -> ESP32 GPIO"));
  Serial.println(MDB_VMC_RX_MONITOR_PIN);
  Serial.println(F("WHITE  : MDB pin 6 / Communications Common -> MACHINE SIDE of isolated interface only"));
  Serial.println(F("MDB pin 3: empty / N.C."));
  Serial.println(F("GPIO4 and GPIO5 are BOTH INPUT-ONLY in native production MDB mode."));
  Serial.println(F("Do NOT connect GREEN/YELLOW/WHITE directly to ESP32 pins."));
  Serial.print  (F("DEX TX from machine -> SP3232 R1IN/R1OUT -> ESP32 GPIO")); Serial.println(DEX_RX_PIN);
  Serial.print  (F("DEX RX to machine <- SP3232 T1OUT/T1IN <- ESP32 GPIO")); Serial.println(DEX_TX_PIN);
  Serial.print  (F("Air780 TX -> ESP32 GPIO")); Serial.print(CELL_RX_PIN); Serial.println(F(" (cellular UART)"));
  Serial.print  (F("Air780 RX <- ESP32 GPIO")); Serial.print(CELL_TX_PIN); Serial.println(F(" (cellular UART)"));
}
void printStatus() {
  Serial.println(F("--- Dallmayr Telemetry V6.8.8 SPLIT HTTP HEADERS DB-POLICY NATIVE MDB + DEX ---"));
  Serial.print(F("Firmware: ")); Serial.println(FIRMWARE_VERSION);
  Serial.print(F("Device: ")); Serial.println(deviceId.length() ? deviceId : "<identity not initialized>");
  Serial.print(F("Hardware UID: ")); Serial.println(hardwareUid.length() ? hardwareUid : "<unknown>");
  Serial.print(F("Enrollment: ")); Serial.println(deviceEnrolled() ? "enrolled" : "not enrolled");
  Serial.print(F("Enrollment mode: ")); Serial.println(enrollmentToken.length() ? "one-time token fallback" : "automatic administrator window");
  Serial.print(F("Supabase gateway JWT: ")); Serial.println(supabaseAnonKey.length() ? "provisioned" : "missing");
  Serial.print(F("Simulation data test enabled: ")); Serial.println(DALLMAYR_SIM_DATA_TEST_ENABLED ? "yes" : "no");
  Serial.print(F("Automatic SIM test completed: ")); Serial.println(automaticSimulationTestCompleted ? "yes" : "no");
  Serial.print(F("Enrollment cellular-first fallback: ")); Serial.println(DALLMAYR_ZERO_TOUCH_CELL_FIRST ? "yes" : "no");
  Serial.println(F("Runtime transport: DB policy; provisioned Wi-Fi receives a 20-second primary connection window before cellular recovery."));
  Serial.print(F("Machine I/O support compiled: ")); Serial.println(DALLMAYR_MACHINE_IO_ENABLED ? "yes" : "no");
  Serial.print(F("Reported machine S/N: ")); Serial.println(reportedMachineSerial.length() ? reportedMachineSerial : "<not set>");
  Serial.print(F("Interface: ")); Serial.println(interfaceName(machineInterface));
  Serial.print(F("DEX baud: ")); Serial.println(dexBaud);
  Serial.print(F("MDB native baud: ")); Serial.println(MDB_BAUD);
  Serial.print(F("MDB active TX compiled: ")); Serial.println(DALLMAYR_MDB_ACTIVE_TX_ENABLED ? "yes" : "no (passive)");
  Serial.print(F("Accepted machine records: ")); Serial.println(acceptedMachineRecords);
  Serial.print(F("Rejected machine records: ")); Serial.println(rejectedMachineRecords);
  if (lastMachineByteMs) {
    Serial.print(F("Last machine UART byte age ms: ")); Serial.println(millis() - lastMachineByteMs);
  } else {
    Serial.println(F("Last machine UART byte: none since boot"));
  }
  Serial.print(F("Wi-Fi configured: ")); Serial.println(wifiSsid.length() ? "yes" : "no");
  Serial.print(F("Wi-Fi connected: ")); Serial.println(wifiReady() ? "yes" : "no");
  Serial.print(F("Wi-Fi status code: ")); Serial.println(static_cast<int>(WiFi.status()));
  Serial.print(F("Wi-Fi begin issued: ")); Serial.println(wifiBeginIssued ? "yes" : "no");
  if (wifiReady()) {
    Serial.print(F("Wi-Fi RSSI: ")); Serial.println(WiFi.RSSI());
  }
  Serial.print(F("Cellular ready: ")); Serial.println(cellReady ? "yes" : "no");
  Serial.print(F("Cellular model: ")); Serial.println(cellularModel.length() ? cellularModel : "<unknown>");
  Serial.print(F("Cellular firmware: ")); Serial.println(cellularFirmware.length() ? cellularFirmware : "<unknown>");
  Serial.print(F("Cellular operator: ")); Serial.println(cellularOperator.length() ? cellularOperator : "<unknown>");
  Serial.print(F("APN: ")); Serial.println(apn.length() ? apn : "<automatic>");
  char usageBuffer[24] = {0};
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
  Serial.print(F("Cellular application TX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
  Serial.print(F("Cellular application RX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  if (cellularModemUsageAvailable) {
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemTxBytes));
    Serial.print(F("Air780E network TX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemRxBytes));
    Serial.print(F("Air780E network RX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  }
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
  Serial.print(F(" code=")); Serial.print(policy.policyCode);
  Serial.print(F(" source=")); Serial.println(policy.source);
  Serial.print(F("Policy updated at: ")); Serial.println(strlen(policy.policyUpdatedAt) ? policy.policyUpdatedAt : "<cached/no revision>");
  Serial.print(F("Profile: ")); Serial.println(policy.profileId);
  Serial.print(F("Counters: ")); Serial.println(counterCount);
  Serial.print(F("DB heartbeat interval: ")); Serial.print(policy.heartbeatIntervalMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("DB counter interval: ")); Serial.print(policy.counterIntervalMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("DB config refresh interval: ")); Serial.print(policy.configRefreshMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("Config ACK pending: ")); Serial.println(configAckPending ? "yes" : "no");
  Serial.print(F("Transport commit pending: ")); Serial.print(transportTransitionPending ? "yes" : "no");
  if (transportTransitionPending) { Serial.print(F(" via ")); Serial.print(transportTransitionSource); }
  Serial.println();
  Serial.print(F("Upload retry guard: heartbeat/fault/counter = "));
  Serial.print(HEARTBEAT_UPLOAD_RETRY_MS / 1000UL); Serial.print(F("/"));
  Serial.print(FAULT_UPLOAD_RETRY_MS / 1000UL); Serial.print(F("/"));
  Serial.print(COUNTER_UPLOAD_RETRY_MS / 1000UL); Serial.println(F(" sec"));
  Serial.print(F("Counter epoch: ")); Serial.println(counterEpoch);
  if (machineInterface == IFACE_MDB) {
    Serial.print(F("MDB RMT ready: ")); Serial.println(mdbRmtReady ? "yes" : "no");
    Serial.print(F("MDB valid master blocks: ")); Serial.println(mdbValidMasterBlocks);
    Serial.print(F("MDB valid slave blocks: ")); Serial.println(mdbValidSlaveBlocks);
    Serial.print(F("MDB invalid master blocks: ")); Serial.println(mdbInvalidMasterBlocks);
    Serial.print(F("MDB invalid slave blocks: ")); Serial.println(mdbInvalidSlaveBlocks);
    Serial.print(F("MDB checksum errors: ")); Serial.println(mdbChecksumErrors);
    Serial.print(F("MDB framing errors: ")); Serial.println(mdbFramingErrors);
    Serial.print(F("MDB decoded words: ")); Serial.println(mdbDecodedWords);
    Serial.print(F("MDB capture task: ")); Serial.println(mdbCaptureTaskHandle ? "running" : "stopped");
    Serial.print(F("MDB event queue overflows: ")); Serial.println(mdbEventQueueOverflows);
    Serial.print(F("MDB GPIO4/master-TX polarity: "));
    Serial.println(mdbMasterInvert < 0 ? "learning" : (mdbMasterInvert ? "inverted" : "normal"));
    Serial.print(F("MDB GPIO5/master-RX polarity: "));
    Serial.println(mdbSlaveInvert < 0 ? "learning" : (mdbSlaveInvert ? "inverted" : "normal"));
    for (int i = 0; i < 2; ++i) {
      Serial.print(F("Cashless ")); Serial.print(i + 1);
      Serial.print(F(" level=")); Serial.print(mdbCashless[i].featureLevel);
      Serial.print(F(" factor=")); Serial.print(mdbCashless[i].scaleFactor);
      Serial.print(F(" decimals=")); Serial.print(mdbCashless[i].decimalPlaces);
      Serial.print(F(" scale_learned=")); Serial.print(mdbCashless[i].scaleKnown ? "yes" : "no");
      Serial.print(F(" expanded_currency=")); Serial.print(mdbCashless[i].expandedCurrency ? "yes" : "no");
      Serial.print(F(" enabled_features=0x")); Serial.println(mdbCashless[i].enabledFeatureBits, HEX);
    }
  } else if (machineInterface == IFACE_DISABLED) {
    Serial.println(F("Machine status: disabled. Select MDB or DEX after checking interface hardware."));
  }
}

void printHelp() {
  Serial.println(F("Commands:"));
  Serial.println(F("  STATUS"));
  Serial.println(F("  SYNC CONFIG"));
  Serial.println(F("  UPLOAD NOW"));
  Serial.println(F("  HEARTBEAT NOW"));
  Serial.println(F("  LOCATION NOW"));
  Serial.println(F("  WIFI SET <ssid>|<password>"));
  Serial.println(F("  WIFI CLEAR"));
  Serial.println(F("  WIFI TEST"));
  Serial.println(F("  WIFI DB TEST     (Wi-Fi-only config read + ACK + commit heartbeat; no cellular fallback)"));
  Serial.println(F("  APN <name>        (blank value = automatic APN)"));
  Serial.println(F("  CELL TEST"));
  Serial.println(F("  SIM DATA TEST     (safe cellular-only simulation and usage verification)"));
  Serial.println(F("  SIM DATA TEST RESET (allow the automatic test to run again after reboot)"));
  Serial.println(F("  DATA USAGE        (local per-transport application byte counters)"));
  Serial.println(F("  CELL AT <command>"));
  Serial.println(F("  INTERFACE MDB|DEX|NORMALIZED_UART|DISABLED"));
  Serial.println(F("  DEX BAUD <baud>"));
  Serial.println(F("  DEX READ"));
  Serial.println(F("  MACHINE SERIAL <serial>"));
  Serial.println(F("  MACHINE SERIAL CLEAR"));
  Serial.println(F("  SUPABASE ANON KEY <JWT>  (stored in NVS; never echoed)"));
  Serial.println(F("  ENROLL TOKEN <one-time-token>  (optional emergency fallback)"));
  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only."));
}


void handleConsoleLine(String line) {
  line.trim();
  if (!line.length()) return;
  String upperLine = line;
  upperLine.toUpperCase();

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
  if (line.equalsIgnoreCase("SIM DATA TEST RESET")) {
    saveAutomaticSimulationTestCompleted(false);
    lastSimulationUploadMs = 0;
    Serial.println(F("Automatic SIM data test flag cleared. Reboot, or type SIM DATA TEST now."));
    return;
  }
  if (line.equalsIgnoreCase("SIM DATA TEST")) {
    runVodacomSimDataTest();
    return;
  }
  if (line.equalsIgnoreCase("DATA USAGE")) {
    if (cellReady) readCellModemDataUsage(false);
    char usageBuffer[24] = {0};
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
    Serial.print(F("Cellular TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
    Serial.print(F("Cellular RX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationTxBytes));
    Serial.print(F("Wi-Fi TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationRxBytes));
    Serial.print(F("Wi-Fi RX JSON bytes: ")); Serial.println(usageBuffer);
    if (cellularModemUsageAvailable) {
      snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemTxBytes));
      Serial.print(F("Air780E network TX bytes: ")); Serial.println(usageBuffer);
      snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemRxBytes));
      Serial.print(F("Air780E network RX bytes: ")); Serial.println(usageBuffer);
    } else {
      Serial.println(F("Air780E network byte counters unavailable."));
    }
    Serial.println(F("Vodacom billing may differ because carrier accounting is authoritative."));
    return;
  }
  if (line.equalsIgnoreCase("DEX READ")) {
    if (machineInterface != IFACE_DEX) {
      Serial.println(F("DEX is not selected. Use: INTERFACE DEX"));
    } else if (!dexRequestActive) {
      counterUploadRequested = true;
      requestDexAudit();
    } else {
      Serial.println(F("A DEX audit request is already active."));
    }
    return;
  }
  if (upperLine.startsWith("DEX BAUD ")) {
    uint32_t requestedBaud = static_cast<uint32_t>(line.substring(9).toInt());
    if (requestedBaud < 1200 || requestedBaud > 115200) {
      Serial.println(F("DEX baud must be between 1200 and 115200 (normally 9600)."));
      return;
    }
    dexBaud = requestedBaud;
    saveCoreSettings();
    if (machineInterface == IFACE_DEX || machineInterface == IFACE_NORMALIZED_UART) {
      restartMachineInterface();
    }
    Serial.print(F("DEX/normalized UART baud saved: "));
    Serial.println(dexBaud);
    return;
  }
  if (upperLine.startsWith("INTERFACE ") || upperLine.startsWith("MACHINE INTERFACE ")) {
    String requestedName = upperLine.startsWith("MACHINE INTERFACE ")
      ? line.substring(18) : line.substring(10);
    MachineInterface requested = parseInterface(requestedName);
    if (requested == IFACE_MDB_BRIDGE) {
      Serial.println(F("MDB_BRIDGE is obsolete in V6.8. Use: INTERFACE MDB"));
      requested = IFACE_MDB;
    }
    if (requested == IFACE_PULSE) {
      Serial.println(F("Pulse mode is not implemented in this hardware build."));
      return;
    }
    if (!selectableMachineInterface(requested)) {
      Serial.println(F("Use: INTERFACE MDB|DEX|NORMALIZED_UART|DISABLED"));
      return;
    }
    machineInterface = requested;
    saveCoreSettings();
    restartMachineInterface();
    heartbeatUploadRequested = true;
    Serial.print(F("Machine interface saved: "));
    Serial.println(interfaceName(machineInterface));
    if (machineInterface == IFACE_MDB) {
      Serial.println(F("Native MDB decoder selected. Both MDB GPIOs are passive RMT inputs."));
    }
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
    wifiConnectionStartedMs = 0;
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
    wifiConnectionStartedMs = 0;
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

  if (line.equalsIgnoreCase("MACHINE SERIAL CLEAR")) {
    reportedMachineSerial = "";
    saveCoreSettings();
    heartbeatUploadRequested = true;
    Serial.println(F("Reported machine S/N cleared."));
    return;
  }
  if (upperLine.startsWith("MACHINE SERIAL ")) {
    reportedMachineSerial = line.substring(15);
    reportedMachineSerial.trim();
    saveCoreSettings();
    heartbeatUploadRequested = true;
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

  if (line.equalsIgnoreCase("WIFI DB TEST")) {
    runWifiDatabaseTest();
    return;
  }
  if (line.equalsIgnoreCase("WIFI TEST")) {
    if (!wifiSsid.length()) {
      Serial.println(F("Wi-Fi is not provisioned. Use: WIFI SET <ssid>|<password>"));
    } else if (wifiReady()) {
      Serial.print(F("Wi-Fi connected. IP: "));
      Serial.println(WiFi.localIP());
      Serial.print(F("RSSI: "));
      Serial.println(WiFi.RSSI());
    } else if (!wifiBeginIssued) {
      if (!policy.wifiEnabled) {
        Serial.println(F("Wi-Fi is disabled by cached/remote policy; starting diagnostic Wi-Fi recovery without changing the saved DB policy."));
      }
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
      wifiBeginIssued = true;
      wifiRadioDisabled = false;
      lastWifiAttemptMs = millis();
      wifiConnectionStartedMs = lastWifiAttemptMs;
      Serial.println(F("Wi-Fi diagnostic connection started."));
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

void serviceSerialAlive() {
  uint32_t now = millis();
  if (lastSerialAliveMs != 0 && now - lastSerialAliveMs < SERIAL_ALIVE_INTERVAL_MS) return;
  lastSerialAliveMs = now;

  Serial.print(F("[ALIVE] firmware="));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F(" device="));
  Serial.print(deviceId.length() ? deviceId : "initialising");
  Serial.print(F(" cellular="));
  Serial.print(cellReady ? "ready" : "waiting");
  Serial.print(F(" enrolled="));
  Serial.print(deviceEnrolled() ? "yes" : "no");
  Serial.print(F(" sim_test="));
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED) Serial.print("disabled");
  else Serial.print(automaticSimulationTestCompleted ? "accepted" : "pending");
  Serial.print(F(" interface="));
  Serial.println(interfaceName(machineInterface));
}

// -----------------------------------------------------------------------------
// Arduino setup / loop
// -----------------------------------------------------------------------------

void setup() {
  Serial.begin(DEBUG_BAUD);
  // Give the ESP32-S3 native USB CDC port time to enumerate before the first
  // message. The repeating [ALIVE] line below also makes late monitor opens
  // visible instead of losing all evidence during boot.
  delay(2000);
  Serial.println();
  Serial.println(F("Dallmayr Telemetry V6.8.8 - DB-POLICY NATIVE PASSIVE MDB + DEX + WIFI/CELLULAR"));
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  Serial.println(F("Console transport: ESP32-S3 USB CDC (correct for the native USB connector)."));
#else
  Serial.println(F("Console transport: UART0. If using the ESP32-S3 native USB connector, enable Tools > USB CDC On Boot."));
#endif
  Serial.println(F("Power-on flow: DB transport policy -> Wi-Fi first when configured -> control recovery -> config ACK -> commit heartbeat -> telemetry."));

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
    Serial.println(F("Machine I/O support is not compiled in."));
  } else {
    restartMachineInterface();
    if (machineInterface == IFACE_DISABLED) {
      Serial.println(F("Machine interface is disabled. Use INTERFACE MDB or INTERFACE DEX after hardware checks."));
    }
  }
  startGnss();

  // Always publish a genuine device heartbeat after the first available transport comes up.
  heartbeatUploadRequested = true;
  lastWifiAttemptMs = millis();
  lastCellAttemptMs = millis() - CELL_RETRY_MS;
  lastCounterSaveMs = millis();
  counterScheduleStartMs = millis();
  lastDataUsageSaveMs = millis();
  printStatus();
  printHelp();
}

void loop() {
  serviceConsole();
  serviceSerialAlive();
  if (DALLMAYR_MACHINE_IO_ENABLED) serviceMachineInterface();
  serviceGnss();
  maintainCounterStorage();
  maintainDataUsageStorage();
  maintainWiFi();
  maintainCellular();
  maintainEnrollment();
  serviceAutomaticSimDataTest();
  maintainRemotePolicy();
  serviceConfigAck();
  serviceTransportTransitionCommit();
  serviceLocation();
  serviceHeartbeatSchedule();
  serviceCounterSchedule();
  serviceUploads();
  delay(2);
}
